// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TargetingIndicator } from "./targetingIndicators";
import {
  TargetingIndicatorLayer,
  targetingProjectionPositionsEqual,
  visibleTargetingIndicators,
} from "./targetingOverlay";

afterEach(() => cleanup());

describe("targeting overlay", () => {
  it("compares projected position maps with subpixel tolerance", () => {
    const current = new Map([
      ["0:0", { x: 10, y: 20, visible: true }],
    ]);

    expect(
      targetingProjectionPositionsEqual(
        current,
        new Map([["0:0", { x: 10.2, y: 19.9, visible: true }]]),
      ),
    ).toBe(true);
    expect(
      targetingProjectionPositionsEqual(
        current,
        new Map([["0:0", { x: 10.4, y: 20, visible: true }]]),
      ),
    ).toBe(false);
    expect(
      targetingProjectionPositionsEqual(
        current,
        new Map([["0:0", { x: 10, y: 20, visible: false }]]),
      ),
    ).toBe(false);
  });

  it("filters hidden endpoints while keeping visible footprints", () => {
    const visible = visibleTargetingIndicators(
      [
        indicator({
          id: "visible",
          secondaryFootprintCoords: [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
          ],
        }),
        indicator({ id: "hidden-target", primaryTargetCoord: { q: 3, r: 0 } }),
      ],
      new Map([
        ["0:0", { x: 10, y: 20, visible: true }],
        ["1:1", { x: 80, y: 90, visible: true }],
        ["1:0", { x: 60, y: 70, visible: true }],
        ["2:0", { x: 70, y: 80, visible: false }],
        ["3:0", { x: 90, y: 100, visible: false }],
      ]),
    );

    expect(visible).toHaveLength(1);
    expect(visible[0]?.indicator.id).toBe("visible");
    expect(visible[0]?.footprintPositions).toEqual([{ x: 60, y: 70, visible: true }]);
  });

  it("renders line, source, primary, footprint, and stack metadata markers", () => {
    const { container } = render(
      <TargetingIndicatorLayer
        indicators={[
          indicator({
            id: "stack-spell",
            source: { type: "stack", stackItemId: "stack-1", priority: 0 },
            actionType: "spell",
            tone: "damageSpell",
            secondaryFootprintCoords: [{ q: 1, r: 0 }],
          }),
        ]}
        positionsByCoordKey={
          new Map([
            ["0:0", { x: 10, y: 20, visible: true }],
            ["1:1", { x: 80, y: 90, visible: true }],
            ["1:0", { x: 60, y: 70, visible: true }],
          ])
        }
      />,
    );

    const line = container.querySelector("[data-targeting-indicator='stack-spell']");
    expect(line).toBeInTheDocument();
    expect(line).toHaveAttribute("data-stack-item-id", "stack-1");
    expect(container.querySelector(".targeting-indicator-source")).toBeInTheDocument();
    expect(container.querySelector("[data-targeting-primary='stack-spell']")).toBeInTheDocument();
    expect(container.querySelector("[data-targeting-footprint='stack-spell']")).toBeInTheDocument();
  });
});

function indicator(overrides: Partial<TargetingIndicator>): TargetingIndicator {
  return {
    id: "targeting",
    source: { type: "selection" },
    actionType: "attack",
    tone: "attack",
    label: "Attack",
    sourcePieceId: "player-hero",
    sourceCoord: { q: 0, r: 0 },
    primaryTargetPieceId: "opponent-hero",
    primaryTargetCoord: { q: 1, r: 1 },
    secondaryFootprintCoords: [],
    ...overrides,
  };
}
