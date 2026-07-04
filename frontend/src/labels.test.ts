import { describe, expect, it } from "vitest";
import { eventDetail, eventTitle } from "./labels";

describe("labels", () => {
  it("renders Barbarian kill mana replay events", () => {
    const event = {
      type: "manaGained",
      side: "player",
      amount: 2,
      source: {
        type: "barbarianKill",
        heroId: "player-hero",
        unitId: "opponent-unit",
      },
    } as const;

    expect(eventTitle(event)).toBe("You gained mana");
    expect(eventDetail(event)).toBe("player-hero gained 2 mana from destroying opponent-unit.");
  });
});
