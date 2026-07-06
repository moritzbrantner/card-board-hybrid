import { Box3, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const gltfSceneCache = new Map<string, Promise<Object3D>>();

export function loadGltfScene(path: string) {
  const cached = gltfSceneCache.get(path);
  if (cached) {
    return cached;
  }

  const loader = new GLTFLoader();
  const promise = new Promise<Object3D>((resolve, reject) => {
    loader.load(
      path,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error),
    );
  });
  gltfSceneCache.set(path, promise);
  return promise;
}

export function normalizeModel(object: Object3D, scale: number) {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);

  if (Number.isFinite(maxAxis) && maxAxis > 0) {
    object.scale.setScalar(scale / maxAxis);
  }

  const center = box.getCenter(new Vector3());
  object.position.sub(center);
}
