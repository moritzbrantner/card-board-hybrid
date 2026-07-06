// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCOUNT_PREFERENCES } from "../preferences";
import { TUTORIAL_COMPLETION_STORAGE_KEY } from "../tutorial/tutorialReducer";
import { TutorialPage } from "./TutorialPage";

afterEach(() => cleanup());

beforeEach(() => {
  window.localStorage.clear();
});

describe("TutorialPage", () => {
  it("renders intro overlay and highlighted targets", () => {
    renderTutorial();

    expect(screen.getByRole("dialog", { name: "Board and Goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /q 0, r 1, occupied by your hero/i })).toHaveClass(
      "tutorial-highlight",
    );
  });

  it("runs the happy path and stores local completion", () => {
    renderTutorial();

    continueIntro();
    fireEvent.click(screen.getByRole("button", { name: /q 0, r 1, occupied by your hero/i }));

    continueIntro();
    fireEvent.click(screen.getByRole("button", { name: /Ember Squire/i }));

    continueIntro();
    fireEvent.click(screen.getByRole("button", { name: /Ember Squire/i }));
    fireEvent.click(screen.getByRole("button", { name: /q 0, r 0, empty hex/i }));

    continueIntro();
    fireEvent.click(screen.getByRole("button", { name: /q 0, r 0, occupied by your unit/i }));
    fireEvent.click(screen.getByRole("button", { name: /q 1, r 0, empty hex/i }));

    continueIntro();
    fireEvent.click(screen.getByRole("button", { name: /q 1, r 0, occupied by your unit/i }));
    fireEvent.click(screen.getByRole("button", { name: /q 1, r -1, occupied by the opponent's unit/i }));

    continueIntro();
    fireEvent.click(screen.getByRole("button", { name: "End Turn" }));

    continueIntro();
    fireEvent.click(screen.getByRole("button", { name: /Spark Jolt/i }));
    fireEvent.click(screen.getByRole("button", { name: /q 1, r -1, occupied by the opponent's unit/i }));

    expect(window.localStorage.getItem(TUTORIAL_COMPLETION_STORAGE_KEY)).toBe("true");
    expect(screen.getByRole("button", { name: "Start Playing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pass Priority" })).not.toBeInTheDocument();
  });
});

function renderTutorial() {
  return render(
    <TutorialPage
      currentUser={null}
      onNavigate={vi.fn()}
      onSignOut={vi.fn()}
      allowSignOut={false}
      loginNextPath="/tutorial"
      visualPreferences={{
        preferences: {
          ...DEFAULT_ACCOUNT_PREFERENCES,
          boardVisualMode: "2d",
        },
        effectiveMotion: "full",
        liveAiDelayMs: 0,
      }}
    />,
  );
}

function continueIntro() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
