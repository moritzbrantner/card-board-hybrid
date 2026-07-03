import { describe, expect, it } from "vitest";
import {
  BOARD_VISUAL_MODE_STORAGE_KEY,
  defaultBoardVisualMode,
  readLocalBoardVisualMode,
  resolveBoardVisualMode,
  saveLocalBoardVisualMode,
} from "./boardVisualMode";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

describe("board visual mode preferences", () => {
  it("uses the signed-in account preference before local fallback", () => {
    expect(
      resolveBoardVisualMode({
        accountMode: "3d",
        storedMode: "2d",
        prefersReducedMotion: true,
      }),
    ).toBe("3d");
  });

  it("uses a valid anonymous local preference before the default", () => {
    expect(
      resolveBoardVisualMode({
        accountMode: null,
        storedMode: "3d",
        prefersReducedMotion: true,
      }),
    ).toBe("3d");
  });

  it("defaults reduced-motion users to 2D until explicitly changed", () => {
    expect(defaultBoardVisualMode(true)).toBe("2d");
    expect(
      resolveBoardVisualMode({
        accountMode: null,
        storedMode: null,
        prefersReducedMotion: true,
      }),
    ).toBe("2d");
  });

  it("defaults to 3D when there is no account, local setting, or reduced-motion request", () => {
    expect(
      resolveBoardVisualMode({
        accountMode: null,
        storedMode: "cinematic",
        prefersReducedMotion: false,
      }),
    ).toBe("3d");
  });

  it("persists anonymous and seat-link fallback choices in local storage", () => {
    const storage = memoryStorage();

    saveLocalBoardVisualMode("2d", storage);

    expect(readLocalBoardVisualMode(storage)).toBe("2d");
    expect(storage.getItem(BOARD_VISUAL_MODE_STORAGE_KEY)).toBe("2d");
  });
});
