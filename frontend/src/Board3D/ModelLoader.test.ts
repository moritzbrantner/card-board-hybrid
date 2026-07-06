import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from "three";

const loaderLoad = vi.hoisted(() => vi.fn());

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    load = loaderLoad;
  },
}));

import { loadGltfScene, normalizeModel } from "./ModelLoader";

describe("Board3D model loader", () => {
  it("caches GLTF scene loads by path", async () => {
    const scene = new Object3D();
    const path = `/models/test-${crypto.randomUUID()}.glb`;
    loaderLoad.mockImplementationOnce((_path, onLoad) => {
      onLoad({ scene });
    });

    const first = loadGltfScene(path);
    const second = loadGltfScene(path);

    await expect(first).resolves.toBe(scene);
    expect(second).toBe(first);
    expect(loaderLoad).toHaveBeenCalledTimes(1);
    expect(loaderLoad).toHaveBeenCalledWith(path, expect.any(Function), undefined, expect.any(Function));
  });

  it("normalizes model size and origin around its bounding box", () => {
    const object = new Object3D();
    const mesh = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
    mesh.position.set(1, 2, 3);
    object.add(mesh);

    normalizeModel(object, 3);

    expect(object.scale.x).toBeCloseTo(0.5);
    expect(object.scale.y).toBeCloseTo(0.5);
    expect(object.scale.z).toBeCloseTo(0.5);
    expect(object.position.x).toBeCloseTo(-1);
    expect(object.position.y).toBeCloseTo(-2);
    expect(object.position.z).toBeCloseTo(-3);
  });
});
