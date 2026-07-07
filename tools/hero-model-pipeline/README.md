# TripoSR Hero Model Pipeline

This pipeline creates board-ready `.glb` assets for the 3-hero pilot: Runekeeper, Pyromancer, and Warden.

## Requirements

- NVIDIA CUDA GPU with at least 8GB VRAM.
- Python 3.8-3.12 for the TripoSR virtualenv. If none is on `PATH`, `setup_triposr.sh` can bootstrap Python 3.11 under `data/hero-models/python` when conda is available.
- CUDA-compatible PyTorch wheel. Override `PYTORCH_INDEX_URL` if the default CUDA wheel does not match your machine.
- Blender on `PATH` for post-processing and validation.

The official TripoSR README documents `python run.py <image> --output-dir <dir>` and notes that the default single-image options take about 6GB VRAM. This repo runs one hero at a time and caps texture resolution at 512px.

## Paths

- Source reference PNGs: `tools/hero-model-pipeline/references/`
- Local TripoSR clone and virtualenv: `data/hero-models/`
- Raw TripoSR output: `data/hero-models/raw/<hero-id>/`
- Final committed app assets: `frontend/public/models/heroes/<hero-id>.glb`

`data/` is ignored by git. Do not commit the TripoSR clone, model weights, virtualenv, raw meshes, or intermediate output.

The checked-in GLBs are runtime assets for the app. If TripoSR has not been run yet, they may be lightweight seed assets; the Blender post-processing step overwrites them with TripoSR-derived GLBs.

## Setup

```bash
tools/hero-model-pipeline/setup_triposr.sh
```

By default this installs the command-line TripoSR dependencies and skips Gradio, because this pipeline uses `run.py` rather than the TripoSR demo app. Install the optional demo UI dependencies with:

```bash
INSTALL_GRADIO=1 tools/hero-model-pipeline/setup_triposr.sh
```

If Python auto-detection fails, provide a supported interpreter:

```bash
PYTHON=/path/to/python3.11 tools/hero-model-pipeline/setup_triposr.sh
```

If the CUDA wheel needs to change:

```bash
PYTORCH_INDEX_URL=https://download.pytorch.org/whl/cu124 tools/hero-model-pipeline/setup_triposr.sh
```

## Generate Raw Models

Generate all pilot heroes:

```bash
tools/hero-model-pipeline/run_triposr.sh
```

Generate one hero:

```bash
tools/hero-model-pipeline/run_triposr.sh runekeeper
```

The script runs one image at a time, sets `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`, keeps batch size at one by invoking TripoSR separately per hero, and uses `--bake-texture --texture-resolution 512`.

If the 8GB GPU runs out of memory, close browser/dev servers and retry one hero. If it still fails, retry with:

```bash
TEXTURE_RESOLUTION=256 tools/hero-model-pipeline/run_triposr.sh runekeeper
```

If TripoSR texture baking fails, export an unbaked GLB raw mesh and let Blender produce the final app GLB:

```bash
BAKE_TEXTURE=0 MODEL_SAVE_FORMAT=glb tools/hero-model-pipeline/run_triposr.sh runekeeper
```

For clean reference images that already have a simple background, skip TripoSR's background-removal step:

```bash
NO_REMOVE_BG=1 BAKE_TEXTURE=0 MODEL_SAVE_FORMAT=glb tools/hero-model-pipeline/run_triposr.sh runekeeper
```

## Post-Process

Run Blender post-processing for all heroes:

```bash
blender --background --python tools/hero-model-pipeline/postprocess_hero_model.py
```

Run it for one hero:

```bash
blender --background --python tools/hero-model-pipeline/postprocess_hero_model.py -- runekeeper
```

The Blender pass imports TripoSR output, centers the model, grounds it on the tile, scales it to the board target height, decimates to the triangle budget, and exports a self-contained GLB.

## Validate

```bash
tools/hero-model-pipeline/validate_assets.sh
```

Validation checks that every expected GLB exists, imports in Blender, stays under 2MB, and stays under 15,000 triangles.

## Add Another Hero

1. Add a generated reference PNG under `references/<hero-id>.png`.
2. Add a hero entry to `hero-models.json`.
3. Run `tools/hero-model-pipeline/run_triposr.sh <hero-id>`.
4. Run `blender --background --python tools/hero-model-pipeline/postprocess_hero_model.py -- <hero-id>`.
5. Add the resulting GLB path to `BOARD_HERO_APPEARANCE_MODEL_ASSETS` in `frontend/src/board3dModelManifest.ts`.
6. Run `tools/hero-model-pipeline/validate_assets.sh` and the frontend unit/type/build checks.
