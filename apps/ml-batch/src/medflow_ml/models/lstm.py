"""PyTorch Lightning LSTM for the sepsis early-warning score.

A 2-layer LSTM (hidden 64, dropout 0.3) over the 24-step x 5-feature vitals
window produced by :mod:`medflow_ml.features.vitals`, with a single logit
head trained under ``BCEWithLogitsLoss`` and AUROC/AUPRC tracked via
torchmetrics. Torch/Lightning are imported lazily so this file imports
under plain CPython for ``py_compile`` and for tests that only inspect the
hyper-parameters.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LSTMConfig:
    input_size: int = 5
    hidden_size: int = 64
    num_layers: int = 2
    dropout: float = 0.3
    learning_rate: float = 1e-3
    weight_decay: float = 1e-5
    pos_weight: float = 1.0


def build_module(config: LSTMConfig) -> object:
    """Construct the LightningModule (imports torch lazily)."""
    import pytorch_lightning as pl  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from torch import nn  # noqa: PLC0415
    from torchmetrics.classification import BinaryAUROC, BinaryAveragePrecision  # noqa: PLC0415

    class SepsisLSTM(pl.LightningModule):
        """LSTM sequence classifier emitting a single per-window logit."""

        def __init__(self, cfg: LSTMConfig) -> None:
            super().__init__()
            self.save_hyperparameters(ignore=[])
            self.cfg = cfg
            self.lstm = nn.LSTM(
                input_size=cfg.input_size,
                hidden_size=cfg.hidden_size,
                num_layers=cfg.num_layers,
                batch_first=True,
                dropout=cfg.dropout,
            )
            self.head = nn.Sequential(
                nn.LayerNorm(cfg.hidden_size),
                nn.Dropout(cfg.dropout),
                nn.Linear(cfg.hidden_size, 1),
            )
            self.loss_fn = nn.BCEWithLogitsLoss(
                pos_weight=torch.tensor([cfg.pos_weight], dtype=torch.float32)
            )
            self.val_auroc = BinaryAUROC()
            self.val_auprc = BinaryAveragePrecision()

        def forward(self, x: torch.Tensor) -> torch.Tensor:  # type: ignore[name-defined]
            out, _ = self.lstm(x)
            last = out[:, -1, :]
            return self.head(last).squeeze(-1)

        def _step(self, batch: tuple[torch.Tensor, torch.Tensor]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:  # type: ignore[name-defined]
            x, y = batch
            logits = self(x)
            loss = self.loss_fn(logits, y.float())
            return loss, logits, y

        def training_step(self, batch: tuple[torch.Tensor, torch.Tensor], _: int) -> torch.Tensor:  # type: ignore[name-defined]
            loss, _, _ = self._step(batch)
            self.log("train_loss", loss, prog_bar=True, on_epoch=True, on_step=False)
            return loss

        def validation_step(self, batch: tuple[torch.Tensor, torch.Tensor], _: int) -> None:  # type: ignore[name-defined]
            loss, logits, y = self._step(batch)
            probs = torch.sigmoid(logits)
            self.val_auroc.update(probs, y.int())
            self.val_auprc.update(probs, y.int())
            self.log("val_loss", loss, prog_bar=True)

        def on_validation_epoch_end(self) -> None:
            self.log("val_auroc", self.val_auroc.compute(), prog_bar=True)
            self.log("val_auprc", self.val_auprc.compute(), prog_bar=True)
            self.val_auroc.reset()
            self.val_auprc.reset()

        def configure_optimizers(self) -> object:
            return torch.optim.Adam(
                self.parameters(), lr=self.cfg.learning_rate, weight_decay=self.cfg.weight_decay
            )

    return SepsisLSTM(config)
