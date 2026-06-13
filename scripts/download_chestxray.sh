#!/usr/bin/env bash
# download_chestxray.sh — Fetch a small slice of the NIH ChestX-ray14 dataset
# into ml/data/chestxray14/ for local fine-tuning (make train-xray).
#
# Usage:   ./scripts/download_chestxray.sh [archive_count]   (default 1 archive)
#
# IMPORTANT — license: ChestX-ray14 is provided by the NIH Clinical Center for
# RESEARCH USE ONLY. We download at most a small slice, never commit any of it
# to this repository, and never redistribute it. ml/data/ is gitignored.
#
# Canonical source (browse + terms): https://nihcc.app.box.com/v/ChestXray-NIHCC
# The direct archive URLs below are the well-known Box "shared/static" links
# published in the NIH's own batch_download_zips.py helper.

set -euo pipefail

ARCHIVES="${1:-1}"
DEST_DIR="$PWD/ml/data/chestxray14"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

command -v curl >/dev/null 2>&1 || { err "curl is required"; exit 1; }

bold "================================================================"
bold " NIH ChestX-ray14 — RESEARCH USE ONLY"
bold "================================================================"
cat <<'NOTICE'
 This dataset is provided by the NIH Clinical Center and is available
 for research purposes only. By continuing you agree to the NIH terms:
   - cite: Wang et al., "ChestX-ray8: Hospital-scale Chest X-ray
     Database and Benchmarks..." (CVPR 2017)
   - do NOT redistribute the images; this script downloads to the
     gitignored ml/data/ directory and nothing is committed in-repo.
 Canonical source: https://nihcc.app.box.com/v/ChestXray-NIHCC
NOTICE
echo ""

# Well-known direct links from NIH's batch_download_zips.py (images_001..003).
# We only take the first $ARCHIVES (default 1, ~2 GB) — a slice is enough for
# the local DenseNet121 fine-tune demo.
URLS=(
  "https://nihcc.box.com/shared/static/vfk49d74nhbxq3nqjg0900w5nvkorp5c.gz"  # images_001.tar.gz
  "https://nihcc.box.com/shared/static/i28rlmbvmfjbl8p2n3ril0pptcmcu9d1.gz"  # images_002.tar.gz
  "https://nihcc.box.com/shared/static/f1t00wrtdk94satdfb9olcolqx20z2jp.gz"  # images_003.tar.gz
)

mkdir -p "$DEST_DIR"
downloaded=0

for i in $(seq 0 $((ARCHIVES - 1))); do
  [ "$i" -lt "${#URLS[@]}" ] || break
  url="${URLS[$i]}"
  out="$DEST_DIR/images_$(printf '%03d' $((i + 1))).tar.gz"
  if [ -f "$out" ]; then
    bold "==> $(basename "$out") already present — skipping download."
  else
    bold "==> Downloading $(basename "$out") (~2 GB, resumable) ..."
    if ! curl -fL --retry 3 --retry-delay 5 -C - -o "$out" "$url"; then
      err "    Download failed for $url"
      rm -f "$out"
      continue
    fi
  fi
  bold "==> Extracting $(basename "$out") into $DEST_DIR"
  if tar -xzf "$out" -C "$DEST_DIR"; then
    downloaded=$((downloaded + 1))
  else
    err "    Extraction failed — archive may be incomplete; delete it and re-run."
  fi
done

if [ "$downloaded" -eq 0 ]; then
  err ""
  err "Automatic download failed (the NIH Box mirror throttles or rotates links"
  err "occasionally). Manual steps:"
  err "  1. Open https://nihcc.app.box.com/v/ChestXray-NIHCC in a browser"
  err "  2. Download 'images/images_001.tar.gz' (and the Data_Entry_2017 CSV)"
  err "  3. Place + extract them under: $DEST_DIR"
  err "  4. Re-run: make train-xray"
  exit 1
fi

# Labels CSV pointer (small; lives alongside the images on Box).
if [ ! -f "$DEST_DIR/Data_Entry_2017.csv" ]; then
  bold "==> NOTE: also grab Data_Entry_2017_v2020.csv (labels) from the Box folder"
  bold "    and save it as $DEST_DIR/Data_Entry_2017.csv before training."
fi

bold ""
bold "Done. $downloaded archive(s) extracted to $DEST_DIR"
bold "Reminder: research use only — never commit or redistribute these images."
