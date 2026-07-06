import { describe, expect, it } from "vitest";
import { clamp, coordKey, projectedPositionsEqual } from "./geometry";

describe("Board3D geometry helpers", () => {
  it("keys axial coordinates predictably", () => {
    expect(coordKey({ q: -2, r: 3 })).toBe("-2:3");
  });

  it("clamps values into the requested bounds", () => {
    expect(clamp(2, 4, 8)).toBe(4);
    expect(clamp(6, 4, 8)).toBe(6);
    expect(clamp(10, 4, 8)).toBe(8);
  });

  it("compares projected position maps with subpixel tolerance", () => {
    const current = new Map([
      ["0:0", { x: 10, y: 20, visible: true }],
    ]);

    expect(
      projectedPositionsEqual(
        current,
        new Map([["0:0", { x: 10.2, y: 19.9, visible: true }]]),
      ),
    ).toBe(true);
    expect(
      projectedPositionsEqual(
        current,
        new Map([["0:0", { x: 10.4, y: 20, visible: true }]]),
      ),
    ).toBe(false);
    expect(
      projectedPositionsEqual(
        current,
        new Map([["0:0", { x: 10, y: 20, visible: false }]]),
      ),
    ).toBe(false);
  });
});
