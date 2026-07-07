#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="$SCRIPT_DIR/hero-models.json"
WORK_DIR="$REPO_ROOT/data/hero-models"
TRIPOSR_DIR="$WORK_DIR/vendor/TripoSR"
VENV_DIR="$WORK_DIR/.venv"
RAW_DIR="$WORK_DIR/raw"
TEXTURE_RESOLUTION="${TEXTURE_RESOLUTION:-512}"
BAKE_TEXTURE="${BAKE_TEXTURE:-1}"
MODEL_SAVE_FORMAT="${MODEL_SAVE_FORMAT:-obj}"
NO_REMOVE_BG="${NO_REMOVE_BG:-0}"

if [[ ! -f "$VENV_DIR/bin/activate" || ! -f "$TRIPOSR_DIR/run.py" ]]; then
  echo "TripoSR is not set up. Run: tools/hero-model-pipeline/setup_triposr.sh" >&2
  exit 1
fi

if [[ "$TEXTURE_RESOLUTION" -gt 512 ]]; then
  echo "TEXTURE_RESOLUTION must stay <= 512 for the 8GB VRAM pilot." >&2
  exit 1
fi

if [[ "$#" -gt 0 ]]; then
  HERO_IDS=("$@")
else
  mapfile -t HERO_IDS < <(python3 - "$CONFIG" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    config = json.load(f)
for hero in config["heroes"]:
    print(hero["id"])
PY
  )
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"

mkdir -p "$RAW_DIR"

for hero_id in "${HERO_IDS[@]}"; do
  mapfile -t HERO_FIELDS < <(python3 - "$CONFIG" "$hero_id" <<'PY'
import json
import sys
config_path, hero_id = sys.argv[1:]
with open(config_path, "r", encoding="utf-8") as f:
    config = json.load(f)
for hero in config["heroes"]:
    if hero["id"] == hero_id:
        print(hero["reference"])
        print(hero["rawDir"])
        break
else:
    raise SystemExit(f"Unknown hero id: {hero_id}")
PY
  )

  reference="$SCRIPT_DIR/${HERO_FIELDS[0]}"
  output_dir="$RAW_DIR/${HERO_FIELDS[1]}"

  if [[ ! -f "$reference" ]]; then
    echo "Missing reference image: $reference" >&2
    exit 1
  fi

  rm -rf "$output_dir"
  mkdir -p "$output_dir"
  mkdir -p "$output_dir/0"
  echo "Running TripoSR for $hero_id -> $output_dir"
  triposr_args=(
    "$reference"
    --output-dir "$output_dir"
    --model-save-format "$MODEL_SAVE_FORMAT"
  )
  if [[ "$BAKE_TEXTURE" == "1" ]]; then
    triposr_args+=(--bake-texture --texture-resolution "$TEXTURE_RESOLUTION")
  fi
  if [[ "$NO_REMOVE_BG" == "1" ]]; then
    triposr_args+=(--no-remove-bg)
  fi
  (
    cd "$TRIPOSR_DIR"
    python run.py "${triposr_args[@]}"
  )
done
