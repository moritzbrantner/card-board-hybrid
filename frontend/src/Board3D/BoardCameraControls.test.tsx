// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardCameraControls } from "./BoardCameraControls";

const fiber = vi.hoisted(() => {
  const frameCallbacks: Array<() => void> = [];
  const position = {
    x: 0,
    y: 7.6,
    z: 7.9,
    length() {
      return Math.hypot(this.x, this.y, this.z);
    },
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
    },
  };
  return {
    frameCallbacks,
    camera: {
      position,
      lookAt: vi.fn(),
      updateMatrixWorld: vi.fn(),
    },
    state: {
      camera: null as unknown,
      gl: { domElement: null as unknown },
    },
  };
});

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn((callback: () => void) => {
    fiber.frameCallbacks.push(callback);
  }),
  useThree: vi.fn(() => fiber.state),
}));

beforeEach(() => {
  fiber.frameCallbacks.length = 0;
  fiber.camera.position.x = 0;
  fiber.camera.position.y = 7.6;
  fiber.camera.position.z = 7.9;
  fiber.camera.lookAt.mockClear();
  fiber.camera.updateMatrixWorld.mockClear();
  fiber.state.camera = fiber.camera;
  fiber.state.gl = { domElement: document.createElement("canvas") };
});

afterEach(() => cleanup());

describe("BoardCameraControls", () => {
  it("attaches orbit controls to the provided element and publishes camera diagnostics", () => {
    const controlElement = document.createElement("div");
    render(<BoardCameraControls controlElement={controlElement} />);

    controlElement.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, cancelable: true }));
    expect(fiber.camera.lookAt).toHaveBeenCalledWith(0, 0, 0);
    expect(fiber.camera.updateMatrixWorld).toHaveBeenCalled();

    fiber.frameCallbacks.at(-1)?.();
    expect((fiber.state.gl as { domElement: HTMLElement }).domElement.dataset.boardCameraDistance).toBeTruthy();
    expect((fiber.state.gl as { domElement: HTMLElement }).domElement.dataset.boardCameraX).toBeTruthy();
  });

  it("uses the canvas element when no external control element is provided", () => {
    render(<BoardCameraControls controlElement={null} />);

    const canvas = (fiber.state.gl as { domElement: HTMLElement }).domElement;
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -80, cancelable: true }));

    expect(fiber.camera.lookAt).toHaveBeenCalledWith(0, 0, 0);
  });

  it("allows zooming out to the board camera maximum distance", () => {
    render(<BoardCameraControls controlElement={null} />);

    const canvas = (fiber.state.gl as { domElement: HTMLElement }).domElement;
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 3000, cancelable: true }));
    fiber.frameCallbacks.at(-1)?.();

    expect(fiber.camera.position.length()).toBeCloseTo(16);
    expect(canvas.dataset.boardCameraDistance).toBe("16.000");
  });
});
