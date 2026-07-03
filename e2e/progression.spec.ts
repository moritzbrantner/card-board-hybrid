import { expect, test } from "@playwright/test";

const EXPERIENCED_EMAIL = "experienced@local.dev";
const EXPERIENCED_PASSWORD = "experienced";
const AUTH_TOKEN = "experienced-e2e-token";

test("selects wizard specs and resets them", async ({ page }) => {
  await mockExperiencedAccountApi(page);
  await signInExperiencedAccount(page);

  await page.getByRole("button", { name: "Pyromancer" }).click();

  const heatedFocus = page.getByRole("button", { name: /Heated Focus/ });
  const scorchingScript = page.getByRole("button", { name: /Scorching Script/ });

  await expect(heatedFocus).toHaveAttribute("aria-pressed", "false");
  await expect(heatedFocus).toBeEnabled();
  await expect(scorchingScript).toBeDisabled();

  await heatedFocus.click();

  await expect(heatedFocus).toHaveAttribute("aria-pressed", "true");
  await expect(heatedFocus).toBeDisabled();
  await expect(scorchingScript).toBeEnabled();

  await page.getByRole("button", { name: /Respec/ }).click();

  await expect(heatedFocus).toHaveAttribute("aria-pressed", "false");
  await expect(heatedFocus).toBeEnabled();
  await expect(scorchingScript).toBeDisabled();
});

test("selects and replaces default rune loadout within slot limit", async ({ page }) => {
  await mockExperiencedAccountApi(page);
  await signInExperiencedAccount(page);

  const vitality = page.getByRole("button", { name: /Vitality Rune/ });
  const force = page.getByRole("button", { name: /Force Rune/ });
  const foresight = page.getByRole("button", { name: /Foresight Rune/ });

  await vitality.click();
  await force.click();

  await expect(vitality).toHaveAttribute("aria-pressed", "true");
  await expect(force).toHaveAttribute("aria-pressed", "true");
  await expect(foresight).toBeDisabled();

  await vitality.click();

  await expect(vitality).toHaveAttribute("aria-pressed", "false");
  await expect(foresight).toBeEnabled();

  await foresight.click();

  await expect(foresight).toHaveAttribute("aria-pressed", "true");
  await expect(force).toHaveAttribute("aria-pressed", "true");
});

async function signInExperiencedAccount(page) {
  await page.goto("/profile");
  await page.getByLabel("Email").fill(EXPERIENCED_EMAIL);
  await page.getByLabel("Password").fill(EXPERIENCED_PASSWORD);
  await page.getByRole("button", { name: /Sign In/ }).click();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByLabel("Wizard skill tree")).toBeVisible();
}

async function mockExperiencedAccountApi(page) {
  let progression = experiencedProgression();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/auth/login" && request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}");
      if (body.email === EXPERIENCED_EMAIL && body.password === EXPERIENCED_PASSWORD) {
        await route.fulfill({ json: { token: AUTH_TOKEN, user: experiencedUser() } });
        return;
      }
      await route.fulfill({ status: 401, json: { message: "Invalid email or password." } });
      return;
    }

    if (url.pathname === "/api/auth/me") {
      await route.fulfill({ json: experiencedUser() });
      return;
    }

    if (url.pathname === "/api/profile/matches") {
      await route.fulfill({ json: { matches: [] } });
      return;
    }

    if (url.pathname === "/api/progression" && request.method() === "GET") {
      await route.fulfill({ json: progression });
      return;
    }

    const skillMatch = url.pathname.match(/^\/api\/progression\/wizards\/([^/]+)\/skills\/([^/]+)$/);
    if (skillMatch && request.method() === "POST") {
      const [, wizardType, nodeId] = skillMatch;
      progression = unlockSkill(progression, wizardType, decodeURIComponent(nodeId));
      await route.fulfill({ json: progression });
      return;
    }

    const respecMatch = url.pathname.match(/^\/api\/progression\/wizards\/([^/]+)\/respec$/);
    if (respecMatch && request.method() === "POST") {
      const [, wizardType] = respecMatch;
      progression = respecWizard(progression, wizardType);
      await route.fulfill({ json: progression });
      return;
    }

    const loadoutMatch = url.pathname.match(/^\/api\/progression\/wizards\/([^/]+)\/loadout$/);
    if (loadoutMatch && request.method() === "PATCH") {
      const [, wizardType] = loadoutMatch;
      const body = JSON.parse(request.postData() ?? "{}");
      progression = saveLoadout(progression, wizardType, body.runeIds ?? []);
      await route.fulfill({ json: progression });
      return;
    }

    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });
}

function experiencedUser() {
  return {
    id: 100,
    email: EXPERIENCED_EMAIL,
    displayName: "Experienced",
    avatar: { symbol: "sparkles", color: "emerald" },
    preferredWizardType: "runekeeper",
    boardVisualMode: "3d",
    progressionSummary: experiencedProgression().account,
  };
}

function unlockSkill(progression, wizardType, nodeId) {
  return {
    ...progression,
    wizards: progression.wizards.map((wizard) => {
      if (wizard.wizardType !== wizardType || wizard.unlockedSkillIds.includes(nodeId)) {
        return wizard;
      }
      const unlockedSkillIds = [...wizard.unlockedSkillIds, nodeId];
      return {
        ...wizard,
        unlockedSkillIds,
        spentSkillPoints: unlockedSkillIds.length,
        availableSkillPoints: wizard.totalSkillPoints - unlockedSkillIds.length,
      };
    }),
  };
}

function respecWizard(progression, wizardType) {
  return {
    ...progression,
    wizards: progression.wizards.map((wizard) =>
      wizard.wizardType === wizardType
        ? {
            ...wizard,
            unlockedSkillIds: [],
            spentSkillPoints: 0,
            availableSkillPoints: wizard.totalSkillPoints,
          }
        : wizard,
    ),
  };
}

function saveLoadout(progression, wizardType, runeIds) {
  return {
    ...progression,
    loadouts: progression.loadouts.map((loadout) =>
      loadout.wizardType === wizardType ? { ...loadout, runeIds } : loadout,
    ),
  };
}

function experiencedProgression() {
  const wizardTypes = ["runekeeper", "pyromancer", "chronomancer", "warden", "battlemage"];
  return {
    account: {
      totalXp: 20_000,
      level: 20,
      currentLevelXp: 19_000,
      nextLevelXp: 21_000,
      xpIntoLevel: 1_000,
      xpToNextLevel: 1_000,
      runeSlots: 2,
    },
    runes: [
      {
        id: "vitality",
        name: "Vitality Rune",
        text: "Wizard starts with +2 max HP.",
        unlockLevel: 2,
        unlocked: true,
      },
      {
        id: "force",
        name: "Force Rune",
        text: "Wizard starts with +1 attack.",
        unlockLevel: 4,
        unlocked: true,
      },
      {
        id: "foresight",
        name: "Foresight Rune",
        text: "Draw +1 opening hand card.",
        unlockLevel: 6,
        unlocked: true,
      },
      {
        id: "wellspring",
        name: "Wellspring Rune",
        text: "Gain +1 mana from controlled hexes.",
        unlockLevel: 8,
        unlocked: true,
      },
      {
        id: "bulwark",
        name: "Bulwark Rune",
        text: "Summoned units enter with +1 armor.",
        unlockLevel: 12,
        unlocked: true,
      },
    ],
    wizards: wizardTypes.map((wizardType) => ({
      wizardType,
      xp: 20_000,
      level: 20,
      currentLevelXp: 19_000,
      nextLevelXp: 21_000,
      xpIntoLevel: 1_000,
      xpToNextLevel: 1_000,
      totalSkillPoints: 19,
      spentSkillPoints: 0,
      availableSkillPoints: 19,
      unlockedSkillIds: [],
    })),
    skillTrees: [
      skillTree("runekeeper", [
        ["runekeeper-runic-balance", "Runic Balance", "The root of Runekeeper mastery.", true, null],
        ["runekeeper-steady-glyph", "Steady Glyph", "Wizard starts with +1 max HP.", false, "runekeeper-runic-balance"],
        ["runekeeper-channel-stone", "Channel Stone", "Gain +1 mana from controlled hexes.", false, "runekeeper-runic-balance"],
        [
          "runekeeper-warding-script",
          "Warding Script",
          "First summoned unit each match enters with +1 armor.",
          false,
          "runekeeper-steady-glyph",
        ],
        ["runekeeper-archive-spark", "Archive Spark", "Draw +1 opening hand card.", false, "runekeeper-channel-stone"],
      ]),
      skillTree("pyromancer", [
        ["pyromancer-ember-path", "Ember Path", "The root of Pyromancer mastery.", true, null],
        ["pyromancer-heated-focus", "Heated Focus", "Wizard starts with +1 attack.", false, "pyromancer-ember-path"],
        ["pyromancer-kindling-reserve", "Kindling Reserve", "Gain +1 mana from controlled hexes.", false, "pyromancer-ember-path"],
        ["pyromancer-scorching-script", "Scorching Script", "Damaging spells deal +1 damage.", false, "pyromancer-heated-focus"],
        [
          "pyromancer-glass-flame",
          "Glass Flame",
          "Draw +1 opening hand card and start with -1 max HP.",
          false,
          "pyromancer-kindling-reserve",
        ],
      ]),
      skillTree("chronomancer", [
        ["chronomancer-time-thread", "Time Thread", "The root of Chronomancer mastery.", true, null],
        ["chronomancer-quick-step", "Quick Step", "Wizard starts with +1 max AP.", false, "chronomancer-time-thread"],
        ["chronomancer-stored-moment", "Stored Moment", "Gain +1 mana from controlled hexes.", false, "chronomancer-time-thread"],
        ["chronomancer-early-loop", "Early Loop", "Draw +1 opening hand card.", false, "chronomancer-quick-step"],
        ["chronomancer-temporal-guard", "Temporal Guard", "Wizard starts with +1 max HP.", false, "chronomancer-stored-moment"],
      ]),
      skillTree("warden", [
        ["warden-stone-oath", "Stone Oath", "The root of Warden mastery.", true, null],
        ["warden-stone-skin", "Stone Skin", "Wizard starts with +2 max HP.", false, "warden-stone-oath"],
        ["warden-guard-drill", "Guard Drill", "Summoned units enter with +1 armor.", false, "warden-stone-oath"],
        [
          "warden-anchored-stance",
          "Anchored Stance",
          "Wizard starts with +1 max HP and gains +1 mana from controlled hexes.",
          false,
          "warden-stone-skin",
        ],
        ["warden-shield-line", "Shield Line", "First summoned unit each match enters with +1 armor.", false, "warden-guard-drill"],
      ]),
      skillTree("battlemage", [
        ["battlemage-duelist-oath", "Duelist Oath", "The root of Battlemage mastery.", true, null],
        ["battlemage-weapon-drill", "Weapon Drill", "Wizard starts with +1 attack.", false, "battlemage-duelist-oath"],
        ["battlemage-iron-focus", "Iron Focus", "Wizard starts with +1 max HP.", false, "battlemage-duelist-oath"],
        ["battlemage-battle-rhythm", "Battle Rhythm", "Gain +1 mana from controlled hexes.", false, "battlemage-weapon-drill"],
        [
          "battlemage-frontline-command",
          "Frontline Command",
          "Summoned units enter with +1 armor.",
          false,
          "battlemage-iron-focus",
        ],
      ]),
    ],
    loadouts: wizardTypes.map((wizardType) => ({ wizardType, runeIds: [] })),
  };
}

function skillTree(wizardType, nodes) {
  return {
    wizardType,
    nodes: nodes.map(([id, name, text, root, prerequisiteId]) => ({
      id,
      name,
      text,
      root,
      prerequisiteId,
    })),
  };
}
