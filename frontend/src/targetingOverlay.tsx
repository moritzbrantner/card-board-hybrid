import type { BoardProjectedPosition, BoardProjection } from "./boardProjection";
import type { TargetingIndicator } from "./targetingIndicators";

export type TargetingOverlayProps = {
  indicators: TargetingIndicator[];
  projection: BoardProjection;
};

export function TargetingOverlay({ indicators, projection }: TargetingOverlayProps) {
  const visibleIndicators = indicators
    .map((indicator) => ({
      indicator,
      sourcePosition: projection.positionAt(indicator.sourceCoord),
      targetPosition: projection.positionAt(indicator.primaryTargetCoord),
      footprintPositions: indicator.secondaryFootprintCoords
        .map((coord) => projection.positionAt(coord))
        .filter((position): position is BoardProjectedPosition => Boolean(position?.visible)),
    }))
    .filter(hasVisibleTargetingEndpoints);

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
            data-stack-item-id={
              indicator.source.type === "stack" ? indicator.source.stackItemId : undefined
            }
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
  sourcePosition?: BoardProjectedPosition;
  targetPosition?: BoardProjectedPosition;
  footprintPositions: BoardProjectedPosition[];
}): entry is {
  indicator: TargetingIndicator;
  sourcePosition: BoardProjectedPosition;
  targetPosition: BoardProjectedPosition;
  footprintPositions: BoardProjectedPosition[];
} {
  return Boolean(entry.sourcePosition?.visible && entry.targetPosition?.visible);
}
