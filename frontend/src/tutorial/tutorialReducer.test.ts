import { describe, expect, it } from "vitest";
import {
  TUTORIAL_EMBER_SQUIRE_CARD_ID,
  TUTORIAL_MOVE_COORD,
  TUTORIAL_OPPONENT_UNIT_ID,
  TUTORIAL_PLAYER_HERO_ID,
  TUTORIAL_PLAYER_UNIT_ID,
  TUTORIAL_SPARK_JOLT_CARD_ID,
  TUTORIAL_SUMMON_COORD,
} from "./tutorialFixtures";
import {
  createInitialTutorialState,
  currentTutorialStep,
  tutorialReducer,
} from "./tutorialReducer";
import type { TutorialState } from "./tutorialTypes";

describe("tutorialReducer", () => {
  it("starts at the first intro and continues into practice", () => {
    const initial = createInitialTutorialState();

    expect(currentTutorialStep(initial).id).toBe("board-goal");
    expect(initial.phase).toBe("intro");

    const practice = tutorialReducer(initial, { type: "continue" });
    expect(practice.phase).toBe("practice");
  });

  it("keeps exploratory interactions on the same step with a hint", () => {
    const initial = tutorialReducer(createInitialTutorialState(), { type: "continue" });
    const next = tutorialReducer(initial, {
      type: "interact",
      interaction: { type: "tileClick", coord: { q: 3, r: 0 } },
    });

    expect(currentTutorialStep(next).id).toBe("board-goal");
    expect(next.hint).toContain("Hero");
  });

  it("walks the expected eight-step path to completion", () => {
    let state = practice(createInitialTutorialState());

    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "pieceClick", pieceId: TUTORIAL_PLAYER_HERO_ID },
    });
    expect(currentTutorialStep(state).id).toBe("mana-ap");

    state = practice(state);
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "cardClick", cardId: TUTORIAL_EMBER_SQUIRE_CARD_ID },
    });
    expect(currentTutorialStep(state).id).toBe("play-unit");

    state = practice(state);
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "cardClick", cardId: TUTORIAL_EMBER_SQUIRE_CARD_ID },
    });
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "tileClick", coord: TUTORIAL_SUMMON_COORD },
    });
    expect(currentTutorialStep(state).id).toBe("move-unit");
    expect(state.match.board.units.some((unit) => unit.id === TUTORIAL_PLAYER_UNIT_ID)).toBe(true);

    state = practice(state);
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "pieceClick", pieceId: TUTORIAL_PLAYER_UNIT_ID },
    });
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "tileClick", coord: TUTORIAL_MOVE_COORD },
    });
    expect(currentTutorialStep(state).id).toBe("attack");

    state = practice(state);
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "pieceClick", pieceId: TUTORIAL_PLAYER_UNIT_ID },
    });
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "pieceClick", pieceId: TUTORIAL_OPPONENT_UNIT_ID },
    });
    expect(currentTutorialStep(state).id).toBe("end-turn");

    state = practice(state);
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "endTurn" },
    });
    expect(currentTutorialStep(state).id).toBe("priority-response");
    expect(state.match.actionStack).toHaveLength(1);

    state = practice(state);
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "cardClick", cardId: TUTORIAL_SPARK_JOLT_CARD_ID },
    });
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "pieceClick", pieceId: TUTORIAL_OPPONENT_UNIT_ID },
    });
    expect(currentTutorialStep(state).id).toBe("pass-priority");
    expect(state.match.actionStack).toHaveLength(2);

    state = practice(state);
    state = tutorialReducer(state, {
      type: "interact",
      interaction: { type: "passPriority" },
    });
    expect(state.phase).toBe("completed");
    expect(state.match.actionStack).toHaveLength(0);
  });

  it("supports deterministic back and restart", () => {
    const initial = createInitialTutorialState();
    const secondStep = tutorialReducer(practice(initial), {
      type: "interact",
      interaction: { type: "pieceClick", pieceId: TUTORIAL_PLAYER_HERO_ID },
    });

    expect(currentTutorialStep(secondStep).id).toBe("mana-ap");
    expect(currentTutorialStep(tutorialReducer(secondStep, { type: "back" })).id).toBe("board-goal");
    expect(currentTutorialStep(tutorialReducer(secondStep, { type: "restart" })).id).toBe("board-goal");
  });
});

function practice(state: TutorialState): TutorialState {
  return tutorialReducer(state, { type: "continue" });
}
