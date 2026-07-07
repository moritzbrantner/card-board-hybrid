#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="$SCRIPT_DIR/hero-models.json"

if ! command -v blender >/dev/null 2>&1; then
  echo "Blender is required to validate GLB imports and triangle budgets." >&2
  exit 1
fi

blender --background --python-expr "
import json
import sys
from pathlib import Path
import bpy

config_path = Path('$CONFIG')
script_dir = Path('$SCRIPT_DIR')
with config_path.open('r', encoding='utf-8') as f:
    config = json.load(f)

max_bytes = int(config['budgets']['maxGlbBytes'])
max_triangles = int(config['budgets']['maxTriangles'])

def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

def triangle_count():
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            for poly in obj.data.polygons:
                total += max(1, len(poly.vertices) - 2)
    return total

failed = False
for hero in config['heroes']:
    path = (script_dir / hero['asset']).resolve()
    if not path.exists():
        print(f'MISSING {hero[\"id\"]}: {path}', file=sys.stderr)
        failed = True
        continue
    size = path.stat().st_size
    if size > max_bytes:
        print(f'OVERSIZE {hero[\"id\"]}: {size} > {max_bytes}', file=sys.stderr)
        failed = True

    reset()
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
    except Exception as exc:
        print(f'IMPORT-FAILED {hero[\"id\"]}: {exc}', file=sys.stderr)
        failed = True
        continue

    triangles = triangle_count()
    materials = len(bpy.data.materials)
    print(f'{hero[\"id\"]}: {size} bytes, {triangles} triangles, {materials} materials')
    if triangles > max_triangles:
        print(f'TRIANGLE-BUDGET {hero[\"id\"]}: {triangles} > {max_triangles}', file=sys.stderr)
        failed = True

if failed:
    raise SystemExit(1)
"
