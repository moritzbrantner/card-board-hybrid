#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="$REPO_ROOT/data/hero-models"
VENDOR_DIR="$WORK_DIR/vendor"
TRIPOSR_DIR="$VENDOR_DIR/TripoSR"
VENV_DIR="$WORK_DIR/.venv"
BOOTSTRAP_PYTHON_DIR="$WORK_DIR/python"
TRIPOSR_REPO_URL="${TRIPOSR_REPO_URL:-https://github.com/VAST-AI-Research/TripoSR.git}"
PYTORCH_INDEX_URL="${PYTORCH_INDEX_URL:-https://download.pytorch.org/whl/cu121}"

find_python() {
  for candidate in "${PYTHON:-}" python3.12 python3.11 python3.10 python3.9 python3.8 python3; do
    if [[ -n "$candidate" ]] && command -v "$candidate" >/dev/null 2>&1; then
      "$candidate" - <<'PY' && return 0
import sys
major, minor = sys.version_info[:2]
if major == 3 and 8 <= minor <= 12:
    raise SystemExit(0)
raise SystemExit(1)
PY
    fi
  done
  return 1
}

PYTHON_BIN="$(find_python || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  CONDA_BIN="$(command -v conda || command -v /home/moenarch/miniconda3/condabin/conda || true)"
  if [[ -n "$CONDA_BIN" ]]; then
    mkdir -p "$WORK_DIR"
    if [[ ! -x "$BOOTSTRAP_PYTHON_DIR/bin/python" ]]; then
      "$CONDA_BIN" create -y -p "$BOOTSTRAP_PYTHON_DIR" python=3.11 pip
    fi
    PYTHON_BIN="$BOOTSTRAP_PYTHON_DIR/bin/python"
  else
    echo "No supported Python found. TripoSR needs Python 3.8-3.12; set PYTHON=/path/to/python3.11 and rerun." >&2
    exit 1
  fi
fi

mkdir -p "$VENDOR_DIR"

if [[ ! -d "$TRIPOSR_DIR/.git" ]]; then
  git clone "$TRIPOSR_REPO_URL" "$TRIPOSR_DIR"
else
  git -C "$TRIPOSR_DIR" fetch --depth=1 origin main
  git -C "$TRIPOSR_DIR" checkout main
  git -C "$TRIPOSR_DIR" pull --ff-only origin main
fi

"$PYTHON_BIN" -m venv "$VENV_DIR"
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

python -m pip install --upgrade pip setuptools wheel
python -m pip install torch torchvision torchaudio --index-url "$PYTORCH_INDEX_URL"
python -m pip install -r "$TRIPOSR_DIR/requirements.txt"

echo "GPU:"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
else
  echo "nvidia-smi not found"
fi

echo "Python CUDA:"
python - <<'PY'
import torch
print({
    "python": __import__("sys").version.split()[0],
    "torch": torch.__version__,
    "cuda_available": torch.cuda.is_available(),
    "cuda": torch.version.cuda,
    "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
})
PY
