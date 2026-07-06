import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WIKI_TOPICS } from "./wikiContent";
import { WIKI_DECK_RULES, WIKI_SCENES, wikiSceneById } from "./wikiScenes";

describe("wiki scenes", () => {
  it("has unique scene IDs", () => {
    const ids = WIKI_SCENES.map((scene) => scene.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every topic scene ID", () => {
    for (const topic of WIKI_TOPICS) {
      expect(wikiSceneById(topic.sceneId)).not.toBeNull();
    }
  });

  it("gives every board scene multiple complete steps", () => {
    for (const scene of WIKI_SCENES) {
      if (scene.type !== "board") {
        continue;
      }

      expect(scene.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of scene.steps) {
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.instruction.trim().length).toBeGreaterThan(0);
        expect(step.match).toMatchObject({ mode: "solo", board: expect.any(Object) });
        expect(step.highlights.length + step.callouts.length).toBeGreaterThan(0);
      }
    }
  });

  it("exposes the current Deck recipe values", () => {
    expect(WIKI_DECK_RULES).toEqual({
      minCards: 60,
      basicCopyLimit: 5,
      advancedCopyLimit: 4,
      rareCopyLimit: 3,
      advancedTotalLimit: 24,
      rareTotalLimit: 12,
    });
  });

  it("does not import backend Match scenario APIs", () => {
    const source = readFileSync(new URL("./wikiScenes.ts", import.meta.url), "utf8");

    expect(source).not.toContain("createMatchScenario");
    expect(source).not.toContain("loadMatchScenarios");
    expect(source).not.toContain("/api/dev/match-scenarios");
  });
});
