import { RotateCcw, StepBack, X } from "lucide-react";
import type { TutorialStep } from "./tutorialTypes";

export function TutorialIntroOverlay({
  step,
  canGoBack,
  onContinue,
  onBack,
  onRestart,
  onExit,
}: {
  step: TutorialStep;
  canGoBack: boolean;
  onContinue: () => void;
  onBack: () => void;
  onRestart: () => void;
  onExit: () => void;
}) {
  return (
    <div className="tutorial-overlay-backdrop" role="presentation">
      <section
        className="tutorial-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-overlay-title"
      >
        <p className="eyebrow">Tutorial</p>
        <h2 id="tutorial-overlay-title">{step.title}</h2>
        <p>{step.intro}</p>
        <div className="tutorial-overlay-actions">
          <button className="secondary-link" type="button" onClick={onExit}>
            <X size={17} />
            Exit
          </button>
          <button className="secondary-link" type="button" onClick={onRestart}>
            <RotateCcw size={17} />
            Restart
          </button>
          <button className="secondary-link" type="button" onClick={onBack} disabled={!canGoBack}>
            <StepBack size={17} />
            Back
          </button>
          <button className="primary-button" type="button" onClick={onContinue}>
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}

export function TutorialObjectivePanel({
  step,
  hint,
  completed,
  onRestart,
  onExit,
}: {
  step: TutorialStep;
  hint: string | null;
  completed: boolean;
  onRestart: () => void;
  onExit: () => void;
}) {
  return (
    <section className="tutorial-objective-panel" aria-label="Tutorial objective" role="status">
      <div>
        <p className="eyebrow">Tutorial</p>
        <h2>{completed ? "Complete" : step.title}</h2>
        <p>{completed ? "You are ready to start a match." : step.objective}</p>
        {hint ? <p className="tutorial-hint">{hint}</p> : null}
      </div>
      <div className="tutorial-objective-actions">
        <button className="secondary-link" type="button" onClick={onRestart}>
          <RotateCcw size={17} />
          Restart
        </button>
        <button className="primary-button" type="button" onClick={onExit}>
          {completed ? "Start Playing" : "Exit"}
        </button>
      </div>
    </section>
  );
}
