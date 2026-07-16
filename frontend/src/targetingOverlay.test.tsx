// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createBoardProjection } from "./boardProjection";
import type { TargetingIndicator } from "./targetingIndicators";
import { TargetingOverlay } from "./targetingOverlay";

describe("targeting overlay", () => {
  it("omits indicators when either endpoint is hidden", () => {
    const { container } = render(
      <TargetingOverlay
        indicators={[stackIndicator()]}
        projection={createBoardProjection([
          { coord: { q: 0, r: 0 }, position: { x: 10, y: 20, visible: true } },
          { coord: { q: 1, r: 0 }, position: { x: 30, y: 40, visible: false } },
        ])}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders targeting lines, endpoint markers, stack metadata, and only visible footprint markers", () => {
    const { container } = render(
      <TargetingOverlay
        indicators={[stackIndicator()]}
        projection={createBoardProjection([
          { coord: { q: 0, r: 0 }, position: { x: 10, y: 20, visible: true } },
          { coord: { q: 1, r: 0 }, position: { x: 30, y: 40, visible: true } },
          { coord: { q: 1, r: -1 }, position: { x: 35, y: 25, visible: true } },
          { coord: { q: 2, r: -1 }, position: { x: 50, y: 25, visible: false } },
        ])}
      />,
    );

    const indicator = container.querySelector("[data-targeting-indicator='stack-spell']");
    expect(indicator).toHaveAttribute("data-stack-item-id", "stack-item-1");
    expect(indicator?.querySelector("line")).toHaveAttribute("x1", "10");
    expect(container.querySelector(".targeting-indicator-source")).toHaveStyle({
      left: "10px",
      top: "20px",
    });
    expect(container.querySelector("[data-targeting-primary='stack-spell']")).toHaveStyle({
      left: "30px",
      top: "40px",
    });
    expect(container.querySelectorAll("[data-targeting-footprint='stack-spell']")).toHaveLength(1);
  });
});

function stackIndicator(): TargetingIndicator {
  return {
    id: "stack-spell",
    source: { type: "stack", stackItemId: "stack-item-1", priority: 2 },
    actionType: "spell",
    tone: "damageSpell",
    label: "Cast Cinder Ring",
    sourcePieceId: "player-hero",
    sourceCoord: { q: 0, r: 0 },
    primaryTargetPieceId: "opponent-hero",
    primaryTargetCoord: { q: 1, r: 0 },
    secondaryFootprintCoords: [
      { q: 1, r: -1 },
      { q: 2, r: -1 },
    ],
  };
}
