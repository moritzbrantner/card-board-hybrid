import { describe, expect, it } from "vitest";
import { WIKI_TOPICS, wikiTopicById } from "./wikiContent";

describe("wiki content", () => {
  it("has unique topic IDs", () => {
    const ids = WIKI_TOPICS.map((topic) => topic.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only links to existing related topics", () => {
    const ids = new Set(WIKI_TOPICS.map((topic) => topic.id));

    for (const topic of WIKI_TOPICS) {
      expect(topic.relatedTopicIds.length).toBeGreaterThan(0);
      for (const relatedTopicId of topic.relatedTopicIds) {
        expect(ids.has(relatedTopicId)).toBe(true);
      }
    }
  });

  it("gives every topic enough player-facing reference content", () => {
    for (const topic of WIKI_TOPICS) {
      expect(topic.summary.trim().length).toBeGreaterThan(0);
      expect(topic.keyRules.length).toBeGreaterThanOrEqual(3);
      expect(topic.example.trim().length).toBeGreaterThan(0);
      expect(topic.commonMistakes.length).toBeGreaterThan(0);
      expect(topic.relatedTopicIds.length).toBeGreaterThan(0);
    }
  });

  it("documents current Deck recipe rule values", () => {
    const deckRules = wikiTopicById("deck-rules");

    expect(deckRules).not.toBeNull();
    const content = deckRules?.keyRules.join(" ") ?? "";
    expect(content).toContain("60");
    expect(content).toContain("5");
    expect(content).toContain("4");
    expect(content).toContain("3");
    expect(content).toContain("24");
    expect(content).toContain("12");
  });
});
