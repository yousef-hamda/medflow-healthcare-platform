"""Train the 14-label chest X-ray classifier and register ``chest-xray-14``.

Research-use-only license
-------------------------
This job trains on the **NIH ChestX-ray14** dataset (Wang et al., 2017),
which is released by the NIH Clinical Center for *research use only*. It is
NOT cleared for clinical use and MUST NOT be used to make patient-care
decisions. Redistribution of the images is governed by the NIH terms; this
repository ships no images, only code that reads a local mirror pointed at
by the ``CHESTXRAY_DIR`` environment variable. The 14 finding labels are
derived from radiology report NLP and are themselves noisy.

Pipeline
--------
1. Read ``Data_Entry_2017.csv`` from ``CHESTXRAY_DIR``; parse the pipe
   ("|") delimited ``Finding Labels`` into a 14-dim multi-hot target.
2. ``torchvision`` DenseNet121 pre-trained on ImageNet, classifier replaced
   by a 14-unit linear (sigmoid) head.
3. ``BCEWithLogitsLoss`` with per-label ``pos_weight`` from label frequency.
4. Per-label AUROC on a patient-disjoint validation split.
5. Register as ``chest-xray-14``.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from medflow_ml.config import Settings, get_settings
from medflow_ml.logging_utils import configure_logging

# Canonical NIH ChestX-ray14 label order (matches serving NIH_LABELS).
NIH_LABELS: tuple[str, ...] = (
    "Atelectasis",
    "Cardiomegaly",
    "Effusion",
    "Infiltration",
    "Mass",
    "Nodule",
    "Pneumonia",
    "Pneumothorax",
    "Consolidation",
    "Edema",
    "Emphysema",
    "Fibrosis",
    "Pleural_Thickening",
    "Hernia",
)
IMAGE_SIZE = 224


def parse_labels(finding_labels: str) -> list[int]:
    """Multi-hot 14-vector from a ``|``-delimited ``Finding Labels`` cell.

    "No Finding" maps to the all-zero vector. Unknown tokens are ignored.
    """
    present = {tok.strip() for tok in finding_labels.split("|")}
    return [1 if label in present else 0 for label in NIH_LABELS]


def build_label_frame(chestxray_dir: str) -> object:
    """Read ``Data_Entry_2017.csv`` into a (image path, multi-hot) frame."""
    import numpy as np  # noqa: PLC0415
    import pandas as pd  # noqa: PLC0415

    root = Path(chestxray_dir)
    csv_path = root / "Data_Entry_2017.csv"
    df = pd.read_csv(csv_path)
    multi_hot = np.stack([parse_labels(str(v)) for v in df["Finding Labels"]]).astype("float32")
    out = pd.DataFrame(multi_hot, columns=list(NIH_LABELS))
    out.insert(0, "image", df["Image Index"].astype(str).to_numpy())
    out.insert(1, "patient_id", df["Patient ID"].astype(str).to_numpy())
    return out


def _resolve_image_path(root: Path, image: str) -> Path | None:
    """ChestX-ray14 ships images across images_001..012/images/ subdirs."""
    direct = root / "images" / image
    if direct.exists():
        return direct
    for sub in sorted(root.glob("images_*/images")):
        candidate = sub / image
        if candidate.exists():
            return candidate
    return None


def build_model(num_labels: int = 14) -> object:
    """DenseNet121 (ImageNet weights) with a ``num_labels`` linear head."""
    import torch  # noqa: PLC0415
    from torchvision import models  # noqa: PLC0415

    net = models.densenet121(weights=models.DenseNet121_Weights.IMAGENET1K_V1)
    in_features = net.classifier.in_features
    net.classifier = torch.nn.Linear(in_features, num_labels)
    return net


def _make_dataset(frame: object, root: Path) -> object:
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415
    from torch.utils.data import Dataset  # noqa: PLC0415
    from torchvision import transforms  # noqa: PLC0415

    tfm = transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=3),
            transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
            ),
        ]
    )

    class ChestXrayDataset(Dataset):  # type: ignore[misc]
        def __init__(self, df: object) -> None:
            self.df = df.reset_index(drop=True)

        def __len__(self) -> int:
            return len(self.df)

        def __getitem__(self, idx: int) -> tuple[object, object]:
            row = self.df.iloc[idx]
            path = _resolve_image_path(root, str(row["image"]))
            if path is None:
                image = Image.new("L", (IMAGE_SIZE, IMAGE_SIZE))
            else:
                image = Image.open(path).convert("L")
            target = torch.tensor(
                [float(row[label]) for label in NIH_LABELS], dtype=torch.float32
            )
            return tfm(image), target

    return ChestXrayDataset(frame)


def patient_disjoint_split(frame: object, val_fraction: float = 0.2, seed: int = 42) -> tuple[object, object]:
    """Split so no patient appears in both train and validation."""
    import numpy as np  # noqa: PLC0415

    patients = frame["patient_id"].unique()
    rng = np.random.default_rng(seed)
    rng.shuffle(patients)
    n_val = int(len(patients) * val_fraction)
    val_patients = set(patients[:n_val].tolist())
    is_val = frame["patient_id"].isin(val_patients)
    return frame[~is_val], frame[is_val]


def train(settings: Settings, max_epochs: int = 3, batch_size: int = 32) -> dict[str, float]:
    """Full training + MLflow registration. Heavy imports are local."""
    import mlflow  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from torch.utils.data import DataLoader  # noqa: PLC0415

    from medflow_ml.evaluation.metrics import auroc

    log = configure_logging("train_xray")
    log.warning("research_use_only", dataset="NIH ChestX-ray14", note="not for clinical use")
    torch.manual_seed(settings.random_seed)

    root = Path(settings.chestxray_dir)
    frame = build_label_frame(settings.chestxray_dir)
    train_df, val_df = patient_disjoint_split(frame, seed=settings.random_seed)

    pos = np.clip(train_df[list(NIH_LABELS)].to_numpy().sum(axis=0), 1.0, None)
    neg = len(train_df) - pos
    pos_weight = torch.tensor((neg / pos), dtype=torch.float32)

    train_loader = DataLoader(
        _make_dataset(train_df, root), batch_size=batch_size, shuffle=True, num_workers=2
    )
    val_loader = DataLoader(_make_dataset(val_df, root), batch_size=batch_size, num_workers=2)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_model(len(NIH_LABELS)).to(device)
    loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(device))
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-4, weight_decay=1e-5)

    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment("chest-xray-14")
    with mlflow.start_run(run_name="densenet121") as run:
        mlflow.log_params(
            {
                "backbone": "densenet121",
                "pretrained": "imagenet",
                "image_size": IMAGE_SIZE,
                "batch_size": batch_size,
                "max_epochs": max_epochs,
                "seed": settings.random_seed,
            }
        )
        for epoch in range(max_epochs):
            model.train()
            running = 0.0
            for images, targets in train_loader:
                images, targets = images.to(device), targets.to(device)
                optimizer.zero_grad()
                loss = loss_fn(model(images), targets)
                loss.backward()
                optimizer.step()
                running += float(loss.item())
            mlflow.log_metric("train_loss", running / max(len(train_loader), 1), step=epoch)
            log.info("epoch_done", epoch=epoch, train_loss=running / max(len(train_loader), 1))

        model.eval()
        all_logits, all_targets = [], []
        with torch.no_grad():
            for images, targets in val_loader:
                logits = model(images.to(device))
                all_logits.append(torch.sigmoid(logits).cpu().numpy())
                all_targets.append(targets.numpy())
        probs = np.concatenate(all_logits) if all_logits else np.zeros((0, len(NIH_LABELS)))
        truth = np.concatenate(all_targets) if all_targets else np.zeros((0, len(NIH_LABELS)))

        per_label = {}
        for i, label in enumerate(NIH_LABELS):
            score = auroc(truth[:, i], probs[:, i])
            if score == score:
                per_label[label] = score
                mlflow.log_metric(f"val_auroc__{label}", score)
        macro = float(np.mean(list(per_label.values()))) if per_label else float("nan")
        if macro == macro:
            mlflow.log_metric("val_auroc_macro", macro)

        mlflow.pytorch.log_model(
            model, artifact_path="model", registered_model_name=settings.xray_model_name
        )
        log.info("registered", model=settings.xray_model_name, run_id=run.info.run_id, macro_auroc=macro)
    return {"val_auroc_macro": macro, **per_label}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train chest-xray-14 DenseNet121.")
    parser.add_argument("--max-epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    train(get_settings(), max_epochs=args.max_epochs, batch_size=args.batch_size)


if __name__ == "__main__":
    main()
