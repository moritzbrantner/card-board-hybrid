import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Vector3 } from "three";
import { clamp } from "./geometry";

const BOARD_CAMERA_MIN_DISTANCE = 5.8;
const BOARD_CAMERA_MAX_DISTANCE = 16;
const BOARD_CAMERA_MIN_POLAR_ANGLE = Math.PI * 0.22;
const BOARD_CAMERA_MAX_POLAR_ANGLE = Math.PI * 0.43;

export function BoardCameraControls({ controlElement }: { controlElement: HTMLElement | null }) {
  const { camera, gl } = useThree();
  const orbitRef = useRef(cameraOrbitFromPosition(camera.position));

  useEffect(() => {
    const element = controlElement ?? gl.domElement;
    let dragStart: {
      x: number;
      y: number;
      azimuth: number;
      polar: number;
    } | null = null;

    function applyOrbit() {
      const orbit = orbitRef.current;
      const horizontalDistance = Math.sin(orbit.polar) * orbit.distance;
      camera.position.set(
        Math.sin(orbit.azimuth) * horizontalDistance,
        Math.cos(orbit.polar) * orbit.distance,
        Math.cos(orbit.azimuth) * horizontalDistance,
      );
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const orbit = orbitRef.current;
      orbit.distance = clamp(
        orbit.distance * Math.exp(event.deltaY * 0.001),
        BOARD_CAMERA_MIN_DISTANCE,
        BOARD_CAMERA_MAX_DISTANCE,
      );
      applyOrbit();
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) {
        return;
      }

      dragStart = {
        x: event.clientX,
        y: event.clientY,
        azimuth: orbitRef.current.azimuth,
        polar: orbitRef.current.polar,
      };
    }

    function handlePointerMove(event: PointerEvent) {
      if (!dragStart) {
        return;
      }

      const orbit = orbitRef.current;
      orbit.azimuth = dragStart.azimuth - (event.clientX - dragStart.x) * 0.006;
      orbit.polar = clamp(
        dragStart.polar + (event.clientY - dragStart.y) * 0.004,
        BOARD_CAMERA_MIN_POLAR_ANGLE,
        BOARD_CAMERA_MAX_POLAR_ANGLE,
      );
      applyOrbit();
    }

    function handlePointerEnd() {
      dragStart = null;
    }

    applyOrbit();
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [camera, controlElement, gl.domElement]);

  useFrame(() => {
    camera.updateMatrixWorld();
    gl.domElement.dataset.boardCameraDistance = camera.position.length().toFixed(3);
    gl.domElement.dataset.boardCameraX = camera.position.x.toFixed(3);
    gl.domElement.dataset.boardCameraY = camera.position.y.toFixed(3);
    gl.domElement.dataset.boardCameraZ = camera.position.z.toFixed(3);
  }, -1);

  return null;
}

function cameraOrbitFromPosition(position: Vector3) {
  const distance = clamp(position.length(), BOARD_CAMERA_MIN_DISTANCE, BOARD_CAMERA_MAX_DISTANCE);
  const polar = clamp(
    Math.acos(clamp(position.y / distance, -1, 1)),
    BOARD_CAMERA_MIN_POLAR_ANGLE,
    BOARD_CAMERA_MAX_POLAR_ANGLE,
  );

  return {
    distance,
    polar,
    azimuth: Math.atan2(position.x, position.z),
  };
}
