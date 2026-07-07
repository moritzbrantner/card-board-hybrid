import { describe, expect, it } from "vitest";
import {
  baseHeroAppearanceId,
  heroAppearanceStorageKey,
  readLocalHeroAppearance,
  resolveHeroAppearanceId,
  saveLocalHeroAppearance,
} from "./heroAppearances";

describe("Hero Board appearance helpers", () => {
  it("stores local fallback selections by Hero", () => {
    const storage = new MapStorage();

    expect(readLocalHeroAppearance("pyromancer", storage)).toBeNull();
    saveLocalHeroAppearance("pyromancer", "pyromancer-ember-mantle", storage);

    expect(storage.getItem(heroAppearanceStorageKey("pyromancer"))).toBe("pyromancer-ember-mantle");
    expect(readLocalHeroAppearance("pyromancer", storage)).toBe("pyromancer-ember-mantle");
  });

  it("prefers response assignments over local fallback and base appearance", () => {
    const assigned = resolveHeroAppearanceId({
      side: "player",
      heroType: "pyromancer",
      assignments: [
        {
          side: "player",
          heroType: "pyromancer",
          appearanceId: "pyromancer-inferno-crown",
          source: "ownerSelection",
        },
      ],
    });
    expect(assigned).toBe("pyromancer-inferno-crown");

    expect(
      resolveHeroAppearanceId({
        side: "opponent",
        heroType: "warden",
        assignments: [],
      }),
    ).toBe(baseHeroAppearanceId("warden"));
  });
});

class MapStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
