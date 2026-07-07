#!/usr/bin/env python3
"""Post-process TripoSR output into board-ready GLB hero assets.

Run with Blender:
  blender --background --python tools/hero-model-pipeline/postprocess_hero_model.py -- runekeeper
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

try:
    import bpy
    from mathutils import Vector
except ModuleNotFoundError as exc:  # pragma: no cover - only runs inside Blender.
    raise SystemExit("This script must be run with Blender's Python: blender --background --python ...") from exc


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
WORK_DIR = REPO_ROOT / "data" / "hero-models"
RAW_ROOT = WORK_DIR / "raw"
CONFIG_PATH = SCRIPT_DIR / "hero-models.json"


def main() -> None:
    args = parse_args()
    config = read_config()
    requested = set(args.heroes) if args.heroes else {hero["id"] for hero in config["heroes"]}
    heroes = [hero for hero in config["heroes"] if hero["id"] in requested]
    unknown = requested - {hero["id"] for hero in heroes}
    if unknown:
        raise SystemExit(f"Unknown hero id(s): {', '.join(sorted(unknown))}")

    for hero in heroes:
        process_hero(hero, config["budgets"])


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("heroes", nargs="*", help="Hero ids to post-process; defaults to all configured heroes.")
    return parser.parse_args(argv)


def read_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def process_hero(hero: dict, budgets: dict) -> None:
    reset_scene()
    raw_model = find_raw_model(RAW_ROOT / hero["rawDir"])
    import_model(raw_model)

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise SystemExit(f"No mesh objects found in {raw_model}")

    apply_sibling_texture(meshes, raw_model)
    normalize_scene(meshes, float(hero["targetHeight"]), float(hero.get("rotationZDegrees", 0)))
    decimate_to_budget(meshes, int(budgets["maxTriangles"]))

    out_path = (SCRIPT_DIR / hero["asset"]).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_animations=False,
        export_skins=False,
    )

    if out_path.stat().st_size > int(budgets["maxGlbBytes"]):
        raise SystemExit(
            f"{out_path} is {out_path.stat().st_size} bytes, over budget {budgets['maxGlbBytes']} bytes"
        )

    print(f"Wrote {out_path}")


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def find_raw_model(raw_dir: Path) -> Path:
    if not raw_dir.exists():
        raise SystemExit(f"Missing raw TripoSR output directory: {raw_dir}")

    candidates = []
    for pattern in ("*.obj", "*.glb", "*.gltf", "*.ply"):
        candidates.extend(raw_dir.rglob(pattern))
    if not candidates:
        raise SystemExit(f"No supported raw model found under {raw_dir}")
    return sorted(candidates, key=lambda path: (path.suffix != ".obj", len(path.parts), path.name))[0]


def import_model(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=str(path))
        else:
            bpy.ops.import_scene.obj(filepath=str(path))
    elif suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".ply":
        bpy.ops.import_mesh.ply(filepath=str(path))
    else:
        raise SystemExit(f"Unsupported raw model format: {path}")


def apply_sibling_texture(meshes: list, raw_model: Path) -> None:
    texture_path = raw_model.parent / "texture.png"
    if not texture_path.exists():
        return

    material = bpy.data.materials.new(f"{raw_model.stem}_texture")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    texture = nodes.new(type="ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(texture_path))
    material.node_tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])

    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(material)


def normalize_scene(meshes: list, target_height: float, rotation_z_degrees: float) -> None:
    root = bpy.data.objects.new("hero-model-root", None)
    bpy.context.collection.objects.link(root)
    for obj in meshes:
        obj.parent = root

    root.rotation_euler[2] = math.radians(rotation_z_degrees)
    bpy.context.view_layer.update()

    bounds = scene_bounds(meshes)
    size = bounds[1] - bounds[0]
    if size.z <= 0:
        raise SystemExit("Model has zero height after import")

    scale = target_height / size.z
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()

    bounds = scene_bounds(meshes)
    center = (bounds[0] + bounds[1]) / 2
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= bounds[0].z
    bpy.context.view_layer.update()


def scene_bounds(meshes: list) -> tuple[Vector, Vector]:
    points = []
    for obj in meshes:
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    min_corner = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    max_corner = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return min_corner, max_corner


def decimate_to_budget(meshes: list, max_triangles: int) -> None:
    current = triangle_count(meshes)
    if current <= max_triangles:
        return

    ratio = max(0.05, max_triangles / current)
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        modifier = obj.modifiers.new("board_asset_decimate", "DECIMATE")
        modifier.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)


def triangle_count(meshes: list) -> int:
    count = 0
    for obj in meshes:
        mesh = obj.data
        for poly in mesh.polygons:
            count += max(1, len(poly.vertices) - 2)
    return count


if __name__ == "__main__":
    main()
