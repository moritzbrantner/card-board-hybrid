import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import type { JSX } from "react";
import { pieceById } from "../matchBoardHelpers";
import { createMatchVisualCatalog } from "../matchVisualIdentity";
import { Board } from "../components/board";
import {
  evaluateDeckRecipeScene,
  wikiSceneCatalogCards,
  type DeckRecipeCounts,
  type WikiBoardScene,
  type WikiBoardSceneStep,
  type WikiDeckRulesScene,
  type WikiScene,
} from "./wikiScenes";

export function WikiScenePanel({ scene }: { scene: WikiScene }): JSX.Element {
  if (scene.type === "deckRules") {
    return <WikiDeckRulesScenePanel scene={scene} />;
  }

  return <WikiBoardScenePanel scene={scene} />;
}

function WikiBoardScenePanel({ scene }: { scene: WikiBoardScene }) {
  const [stepIndex, setStepIndex] = useState(0);
  const visualCatalog = useMemo(() => createMatchVisualCatalog(wikiSceneCatalogCards), []);
  const step = scene.steps[stepIndex];
  const selectedCard = step.selectedCardId
    ? step.match.player.hand.find((card) => card.id === step.selectedCardId) ?? null
    : null;
  const selectedPiece = step.selectedPieceId ? pieceById(step.match, step.selectedPieceId) : null;

  return (
    <section className="wiki-scene" aria-label={`${scene.title} interactive scene`}>
      <header className="wiki-scene-header">
        <div>
          <p className="eyebrow">Interactive Rule</p>
          <h2>{scene.title}</h2>
          <p>{scene.summary}</p>
        </div>
        <WikiSceneStepControls
          stepIndex={stepIndex}
          stepCount={scene.steps.length}
          onPrevious={() => setStepIndex((current) => Math.max(0, current - 1))}
          onNext={() => setStepIndex((current) => Math.min(scene.steps.length - 1, current + 1))}
          onReset={() => setStepIndex(0)}
        />
      </header>

      <div className="wiki-scene-body">
        <div className="wiki-scene-board">
          <Board
            match={step.match}
            animation={null}
            boardVisualMode="2d"
            viewerSide="player"
            visualCatalog={visualCatalog}
            selectedCard={selectedCard}
            selectedPiece={selectedPiece}
            focusedCoord={step.focusedCoord ?? null}
            disabled={false}
            readOnly
            tutorialHighlights={step.highlights}
          />
        </div>
        <WikiBoardStepPanel step={step} stepIndex={stepIndex} stepCount={scene.steps.length} />
      </div>
    </section>
  );
}

function WikiBoardStepPanel({
  step,
  stepIndex,
  stepCount,
}: {
  step: WikiBoardSceneStep;
  stepIndex: number;
  stepCount: number;
}) {
  return (
    <aside className="wiki-scene-panel">
      <span className="wiki-scene-step-count">
        Step {stepIndex + 1} of {stepCount}
      </span>
      <h3>{step.title}</h3>
      <p>{step.instruction}</p>
      <WikiSceneCallouts callouts={step.callouts} />
    </aside>
  );
}

function WikiSceneStepControls({
  stepIndex,
  stepCount,
  onPrevious,
  onNext,
  onReset,
}: {
  stepIndex: number;
  stepCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onReset: () => void;
}) {
  return (
    <div className="wiki-scene-controls" aria-label="Scene step controls">
      <button className="secondary-link" type="button" disabled={stepIndex === 0} onClick={onPrevious}>
        Previous
      </button>
      <button className="secondary-link" type="button" disabled={stepIndex === stepCount - 1} onClick={onNext}>
        Next
      </button>
      <button className="secondary-link" type="button" onClick={onReset}>
        <RotateCcw size={16} />
        Reset
      </button>
    </div>
  );
}

function WikiSceneCallouts({ callouts }: { callouts: Array<{ label: string; value: string }> }) {
  if (callouts.length === 0) {
    return null;
  }

  return (
    <dl className="wiki-scene-callouts" aria-label="Scene callouts">
      {callouts.map((callout) => (
        <div key={`${callout.label}:${callout.value}`}>
          <dt>{callout.label}</dt>
          <dd>{callout.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function WikiDeckRulesScenePanel({ scene }: { scene: WikiDeckRulesScene }) {
  const [counts, setCounts] = useState<DeckRecipeCounts>(scene.initialCounts);
  const legality = evaluateDeckRecipeScene(counts, scene.rules);

  function updateCount(key: keyof DeckRecipeCounts, delta: number) {
    setCounts((current) => ({
      ...current,
      [key]: Math.max(0, current[key] + delta),
    }));
  }

  return (
    <section className="wiki-scene wiki-deck-scene" aria-label={`${scene.title} interactive scene`}>
      <header className="wiki-scene-header">
        <div>
          <p className="eyebrow">Interactive Rule</p>
          <h2>{scene.title}</h2>
          <p>{scene.summary}</p>
        </div>
        <button className="secondary-link" type="button" onClick={() => setCounts(scene.initialCounts)}>
          <RotateCcw size={16} />
          Reset
        </button>
      </header>

      <div className="wiki-scene-body">
        <div className="wiki-deck-stepper" aria-label="Deck recipe count steppers">
          <DeckCountStepper label="Basic cards" value={counts.basic} onChange={(delta) => updateCount("basic", delta)} />
          <DeckCountStepper
            label="Advanced cards"
            value={counts.advanced}
            onChange={(delta) => updateCount("advanced", delta)}
          />
          <DeckCountStepper label="Rare cards" value={counts.rare} onChange={(delta) => updateCount("rare", delta)} />
        </div>

        <aside className="wiki-scene-panel">
          <div className={`wiki-deck-status ${legality.legal ? "legal" : "draft"}`} role="status">
            <span>{legality.legal ? "Legal deck recipe" : "Draft deck recipe"}</span>
            <strong>{legality.totalCards} cards</strong>
          </div>

          <WikiSceneCallouts
            callouts={[
              { label: "Basic total", value: String(counts.basic) },
              { label: "Advanced total", value: `${counts.advanced}/${scene.rules.advancedTotalLimit}` },
              { label: "Rare total", value: `${counts.rare}/${scene.rules.rareTotalLimit}` },
              { label: "Minimum cards", value: String(scene.rules.minCards) },
              { label: "Copy limits", value: `Basic ${scene.rules.basicCopyLimit}, Advanced ${scene.rules.advancedCopyLimit}, Rare ${scene.rules.rareCopyLimit}` },
            ]}
          />

          <ul className="wiki-deck-messages" aria-label="Deck recipe rule messages">
            {legality.messages.length > 0 ? (
              legality.messages.map((message) => <li key={message}>{message}</li>)
            ) : (
              <li>All tracked rarity totals satisfy the current rules.</li>
            )}
          </ul>
        </aside>
      </div>
    </section>
  );
}

function DeckCountStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (delta: number) => void;
}) {
  return (
    <div className="wiki-deck-stepper-row">
      <span>{label}</span>
      <div>
        <button className="secondary-link" type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(-1)}>
          -
        </button>
        <strong aria-label={`${label} count`}>{value}</strong>
        <button className="secondary-link" type="button" aria-label={`Increase ${label}`} onClick={() => onChange(1)}>
          +
        </button>
      </div>
    </div>
  );
}
