import { describe, expect, it } from "vitest";
import { clamp, coordKey } from "./geometry";

describe("Board3D geometry helpers", () => {
  it("keys axial coordinates predictably", () => {
    expect(coordKey({ q: -2, r: 3 })).toBe("-2:3");
  });

  it("clamps values into the requested bounds", () => {
    expect(clamp(2, 4, 8)).toBe(4);
    expect(clamp(6, 4, 8)).toBe(6);
    expect(clamp(10, 4, 8)).toBe(8);
  });
});
