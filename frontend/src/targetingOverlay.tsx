import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ProjectedBoardPosition } from "./boardRenderer";
import type { TargetingIndicator } from "./targetingIndicators";
import type { HexCoord } from "./types";
import { coordKey } from "./matchBoardHelpers";

export type TargetingProjectionPosition = ProjectedBoardPosition;

export type VisibleTargetingIndicator = {
  indicator: TargetingIndicator;
  sourcePosition: TargetingProjectionPosition;
  targetPosition: TargetingProjectionPosition;
  footprintPositions: TargetingProjectionPosition[];
};

export type TargetingIndicatorLayerProps = {
  indicators: TargetingIndicator[];
  positionsByCoordKey: Map<string, TargetingProjectionPosition>;
};

export function useDomTargetingProjection(
  boardFieldRef: RefObject<HTMLDivElement | null>,
  coords: HexCoord[],
) {
  const elementByKeyRef = useRef(new Map<string, HTMLButtonElement>());
  const [positions, setPositions] = useState<Map<string, TargetingProjectionPosition>>(
    () => new Map(),
  );
  const coordKeys = coords.map(coordKey).join("|");

  useLayoutEffect(() => {
    let frameId = 0;

    function measure() {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const boardField = boardFieldRef.current;
        if (!boardField) {
          setPositions(new Map());
          return;
        }

        const fieldRect = boardField.getBoundingClientRect();
        const nextPositions = new Map<string, TargetingProjectionPosition>();
        for (const key of coordKeys.split("|").filter(Boolean)) {
          const element = elementByKeyRef.current.get(key);
          if (!element) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          nextPositions.set(key, {
            x: rect.left - fieldRect.left + rect.width / 2,
            y: rect.top - fieldRect.top + rect.height / 2,
            visible: true,
          });
        }

        setPositions((current) =>
          targetingProjectionPositionsEqual(current, nextPositions) ? current : nextPositions,
        );
      });
    }

    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (boardFieldRef.current && resizeObserver) {
      resizeObserver.observe(boardFieldRef.current);
    }

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [boardFieldRef, coordKeys]);

  function registerTargetElement(coord: HexCoord, element: HTMLButtonElement | null) {
    const key = coordKey(coord);
    if (element) {
      elementByKeyRef.current.set(key, element);
    } else {
      elementByKeyRef.current.delete(key);
    }
  }

  return { positionsByCoordKey: positions, registerTargetElement };
}

export function targetingProjectionPositionsEqual(
  left: Map<string, TargetingProjectionPosition>,
  right: Map<string, TargetingProjectionPosition>,
) {
  if (left.size !== right.size) {
    return false;
  }

  for (const [key, nextPosition] of right) {
    const currentPosition = left.get(key);
    if (
      !currentPosition ||
      currentPosition.visible !== nextPosition.visible ||
      Math.abs(currentPosition.x - nextPosition.x) > 0.25 ||
      Math.abs(currentPosition.y - nextPosition.y) > 0.25
    ) {
      return false;
    }
  }

  return true;
}

export function visibleTargetingIndicators(
  indicators: TargetingIndicator[],
  positionsByCoordKey: Map<string, TargetingProjectionPosition>,
): VisibleTargetingIndicator[] {
  return indicators
    .map((indicator) => ({
      indicator,
      sourcePosition: positionsByCoordKey.get(coordKey(indicator.sourceCoord)),
      targetPosition: positionsByCoordKey.get(coordKey(indicator.primaryTargetCoord)),
      footprintPositions: indicator.secondaryFootprintCoords
        .map((coord) => positionsByCoordKey.get(coordKey(coord)))
        .filter((position): position is TargetingProjectionPosition => Boolean(position?.visible)),
    }))
    .filter(hasVisibleTargetingEndpoints);
}

export function TargetingIndicatorLayer({
  indicators,
  positionsByCoordKey,
}: TargetingIndicatorLayerProps) {
  const visibleIndicators = visibleTargetingIndicators(indicators, positionsByCoordKey);

  if (visibleIndicators.length === 0) {
    return null;
  }

  return (
    <div className="targeting-indicator-layer" aria-hidden="true">
      <svg className="targeting-indicator-svg">
        <defs>
          {visibleIndicators.map(({ indicator }, index) => (
            <marker
              id={`targeting-arrow-${index}`}
              key={indicator.id}
              markerWidth="12"
              markerHeight="12"
              refX="10"
              refY="6"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                className={`targeting-indicator-arrowhead targeting-indicator-${indicator.tone}`}
                d="M 0 0 L 12 6 L 0 12 z"
              />
            </marker>
          ))}
        </defs>
        {visibleIndicators.map(({ indicator, sourcePosition, targetPosition }, index) => (
          <g
            key={indicator.id}
            className={`targeting-indicator targeting-indicator-${indicator.tone}`}
            data-targeting-indicator={indicator.id}
            data-targeting-action={indicator.actionType}
            data-targeting-tone={indicator.tone}
            data-stack-item-id={indicator.source.type === "stack" ? indicator.source.stackItemId : undefined}
          >
            <line
              className="targeting-indicator-line"
              x1={sourcePosition.x}
              y1={sourcePosition.y}
              x2={targetPosition.x}
              y2={targetPosition.y}
              markerEnd={`url(#targeting-arrow-${index})`}
            />
          </g>
        ))}
      </svg>
      {visibleIndicators.map(({ indicator, sourcePosition, targetPosition, footprintPositions }) => (
        <div key={`${indicator.id}-markers`}>
          <span
            className={`targeting-indicator-source targeting-indicator-marker targeting-indicator-${indicator.tone}`}
            style={{ left: `${sourcePosition.x}px`, top: `${sourcePosition.y}px` }}
          />
          <span
            className={`targeting-indicator-primary targeting-indicator-marker targeting-indicator-${indicator.tone}`}
            style={{ left: `${targetPosition.x}px`, top: `${targetPosition.y}px` }}
            data-targeting-primary={indicator.id}
          />
          {footprintPositions.map((position, index) => (
            <span
              key={`${indicator.id}-footprint-${index}`}
              className={`targeting-indicator-footprint targeting-indicator-marker targeting-indicator-${indicator.tone}`}
              style={{ left: `${position.x}px`, top: `${position.y}px` }}
              data-targeting-footprint={indicator.id}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function hasVisibleTargetingEndpoints(entry: {
  indicator: TargetingIndicator;
  sourcePosition?: TargetingProjectionPosition;
  targetPosition?: TargetingProjectionPosition;
  footprintPositions: TargetingProjectionPosition[];
}): entry is VisibleTargetingIndicator {
  return Boolean(entry.sourcePosition?.visible && entry.targetPosition?.visible);
}
