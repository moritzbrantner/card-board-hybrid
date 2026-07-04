import { expect, test } from "@playwright/test";

const MATCH_ID = "dev-play-unit-card-e2e";

test("loads a dev match scenario and navigates to the playable match route", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/dev/match-scenarios") {
      await route.fulfill({
        json: {
          scenarios: [
            {
              id: "play-unit-card",
              name: "Play Unit Card",
              description: "Start with an affordable unit card and an adjacent empty hex.",
              primaryActions: ["playCard"],
            },
          ],
        },
      });
      return;
    }

    if (
      url.pathname === "/api/dev/match-scenarios/play-unit-card/matches" &&
      request.method() === "POST"
    ) {
      await route.fulfill({ json: matchResponse(playableMatch()) });
      return;
    }

    if (url.pathname === `/api/matches/${MATCH_ID}`) {
      await route.fulfill({ json: matchResponse(playableMatch()) });
      return;
    }

    if (url.pathname === "/api/catalog/cards") {
      await route.fulfill({
        json: {
          cards: [catalogCard(emberSquire())],
        },
      });
      return;
    }

    await route.fulfill({ status: 404, json: { message: "Unexpected request" } });
  });

  await page.goto("/dev/scenarios");

  await expect(page.getByRole("heading", { name: "Match Scenarios" })).toBeVisible();
  await expect(page.getByText("playCard")).toBeVisible();
  await page.getByRole("button", { name: "Load Scenario" }).click();

  await expect(page).toHaveURL(new RegExp(`/match/${MATCH_ID}$`));
  await expect(page.getByText(`Match ${MATCH_ID}`)).toBeVisible();
});

function matchResponse(matchState) {
  return {
    matchId: MATCH_ID,
    matchState,
  };
}

function playableMatch() {
  const hand = [emberSquire()];
  return {
    mode: "solo",
    round: 1,
    phase: "planning",
    activeSide: "player",
    prioritySide: null,
    player: {
      side: "player",
      mana: 8,
      maxMana: 8,
      hero: hero("player-hero", "player", { q: 0, r: 1 }),
      progression: progression(),
      hand,
      handCount: hand.length,
      deckCount: 24,
      discardCount: 0,
    },
    opponent: {
      side: "opponent",
      mana: 8,
      maxMana: 8,
      hero: hero("opponent-hero", "opponent", { q: 1, r: 1 }),
      progression: progression(),
      handCount: 3,
      deckCount: 25,
      discardCount: 0,
    },
    board: {
      radius: 3,
      tiles: radiusThreeTiles(),
      units: [],
      droppedItems: [],
    },
    actionStack: [],
    log: ["Loaded a local match scenario."],
    winner: null,
  };
}

function emberSquire() {
  return {
    id: "scenario-ember-squire",
    templateId: "ember-squire",
    name: "Ember Squire",
    rarity: "basic",
    cost: 1,
    text: "1 attack / 2 armor / 2 AP.",
    kind: { type: "unit", attack: 1, armor: 2, maxAp: 2 },
  };
}

function catalogCard(card) {
  return {
    ...card,
    id: card.templateId,
    copyCount: 12,
    artKey: card.templateId,
    artPath: "/card-art/ember-squire.svg",
  };
}

function hero(id, side, position) {
  return {
    id,
    side,
    heroType: side === "player" ? "runekeeper" : "pyromancer",
    hp: side === "player" ? 20 : 18,
    maxHp: side === "player" ? 20 : 18,
    attack: side === "player" ? 1 : 2,
    position,
    apRemaining: 3,
    maxAp: 3,
    hasAttacked: false,
  };
}

function progression() {
  return {
    runeIds: [],
    skillIds: [],
    effects: {
      maxHpDelta: 0,
      attackDelta: 0,
      maxApDelta: 0,
      manaDelta: 0,
      openingHandDelta: 0,
      summonedUnitArmorDelta: 0,
      firstSummonedUnitArmorDelta: 0,
      spellDamageDelta: 0,
    },
  };
}

function radiusThreeTiles() {
  const tiles = [];
  for (let q = -3; q <= 3; q += 1) {
    for (let r = -3; r <= 3; r += 1) {
      const coord = { q, r };
      if (distance(coord, { q: 0, r: 0 }) <= 3) {
        tiles.push({ coord });
      }
    }
  }
  return tiles.sort((left, right) => left.coord.r - right.coord.r || left.coord.q - right.coord.q);
}

function distance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}
