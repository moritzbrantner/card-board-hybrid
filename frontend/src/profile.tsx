import { RotateCcw, Save } from "lucide-react";
import { useState, type CSSProperties } from "react";
import {
  respecHeroSkills,
  saveHeroAppearance,
  saveHeroRuneLoadout,
  unlockHeroSkill,
  updateProfile,
} from "./api";
import type {
  AccountProfile,
  GeneratedAvatar,
  ProgressionResponse,
  RuneDefinition,
  SkillNodeDefinition,
  HeroProgression,
  HeroSkillTree,
  HeroType,
  HeroAppearanceProgression,
  HeroAppearanceDefinition,
} from "./types";
import { TopNav } from "./components/common";
import { HERO_OPTIONS } from "./heroes";
import { HeroPreview3D } from "./HeroPreview3D";
import { saveLocalHeroAppearance } from "./heroAppearances";

type ProfilePageProps = {
  currentUser: AccountProfile;
  onNavigate: (to: string) => void;
  onProfileUpdated: (profile: AccountProfile) => void;
  onSignOut: () => void;
};

const AVATAR_SYMBOLS = ["sparkles", "shield", "sword", "wand", "rune", "flame"] as const;
const AVATAR_COLORS = ["emerald", "indigo", "rose", "amber", "sky", "slate"] as const;
const SKILL_GRAPH_WIDTH = 760;
const SKILL_GRAPH_HEIGHT = 420;

export function ProfilePage({
  currentUser,
  onNavigate,
  onProfileUpdated,
  onSignOut,
}: ProfilePageProps) {
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [handle, setHandle] = useState(currentUser.handle);
  const [avatar, setAvatar] = useState<GeneratedAvatar>(currentUser.avatar);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await updateProfile(
        displayName,
        handle,
        avatar,
      );
      onProfileUpdated(updated);
      setDisplayName(updated.displayName);
      setHandle(updated.handle);
      setAvatar(updated.avatar);
      setNotice("Profile saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell dashboard-shell">
      <TopNav currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} activePath="/profile" />
      <section className="profile-layout" aria-label="Profile">
        <header className="home-heading"><h1>Profile</h1><p>Manage your account identity.</p></header>

        <section className="profile-editor" aria-label="Account profile">
          <div className={`profile-avatar large ${avatar.color}`}>{avatarSymbolLabel(avatar.symbol)}</div>
          <div className="profile-fields">
            <label htmlFor="profile-display-name">Display Name</label>
            <input
              id="profile-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={32}
            />
            <label htmlFor="profile-public-handle">Public Handle</label>
            <input
              id="profile-public-handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              maxLength={24}
            />
            <span>{currentUser.email}</span>
          </div>
          <div className="avatar-controls" aria-label="Generated avatar">
            <fieldset>
              <legend>Symbol</legend>
              <div>
                {AVATAR_SYMBOLS.map((symbol) => (
                  <button
                    key={symbol}
                    className={avatar.symbol === symbol ? "active" : ""}
                    type="button"
                    onClick={() => setAvatar({ ...avatar, symbol })}
                    aria-pressed={avatar.symbol === symbol}
                  >
                    {avatarSymbolLabel(symbol)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Color</legend>
              <div>
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`avatar-swatch ${color} ${avatar.color === color ? "active" : ""}`}
                    type="button"
                    onClick={() => setAvatar({ ...avatar, color })}
                    aria-pressed={avatar.color === color}
                    title={color}
                  />
                ))}
              </div>
            </fieldset>
          </div>
          <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={busy}>
            <Save size={18} />
            Save Profile
          </button>
          {notice ? <p className="notice">{notice}</p> : null}
        </section>

      </section>
    </main>
  );
}

export function ProgressionPanel({
  progression,
  selectedHero,
  onSelectHero,
  onProgressionChanged,
}: {
  progression: ProgressionResponse;
  selectedHero: HeroType;
  onSelectHero: (heroType: HeroType) => void;
  onProgressionChanged: (progression: ProgressionResponse) => void;
}) {
  const hero = progression.heroes.find((candidate) => candidate.heroType === selectedHero);
  const tree = progression.skillTrees.find((candidate) => candidate.heroType === selectedHero);
  const loadout =
    progression.loadouts.find((candidate) => candidate.heroType === selectedHero)?.runeIds ?? [];
  const appearanceProgression = progression.heroAppearances?.find(
    (candidate) => candidate.heroType === selectedHero,
  );
  const selectedHeroOption = HERO_OPTIONS.find((option) => option.id === selectedHero);

  async function handleToggleRune(rune: RuneDefinition) {
    if (!rune.unlocked) {
      return;
    }
    const nextRuneIds = loadout.includes(rune.id)
      ? loadout.filter((runeId) => runeId !== rune.id)
      : [...loadout, rune.id].slice(0, progression.account.runeSlots);
    const updated = await saveHeroRuneLoadout(selectedHero, nextRuneIds);
    onProgressionChanged(updated);
  }

  async function handleUnlock(node: SkillNodeDefinition) {
    const updated = await unlockHeroSkill(selectedHero, node.id);
    onProgressionChanged(updated);
  }

  async function handleRespec() {
    const updated = await respecHeroSkills(selectedHero);
    onProgressionChanged(updated);
  }

  async function handleAppearanceSelect(appearance: HeroAppearanceDefinition) {
    if (!appearance.unlocked) {
      return;
    }
    saveLocalHeroAppearance(selectedHero, appearance.id);
    const updated = await saveHeroAppearance(selectedHero, appearance.id);
    onProgressionChanged(updated);
  }

  return (
    <div className="progression-panel">
      <div className="progression-summary">
        <div>
          <span>Account Level</span>
          <strong>{progression.account.level}</strong>
        </div>
        <div>
          <span>Total XP</span>
          <strong>{progression.account.totalXp}</strong>
        </div>
        <div>
          <span>Rune Slots</span>
          <strong>{progression.account.runeSlots}</strong>
        </div>
      </div>
      <ProgressBar
        label={`Next account level in ${progression.account.xpToNextLevel} XP`}
        value={progression.account.xpIntoLevel}
        max={progression.account.nextLevelXp - progression.account.currentLevelXp}
      />

      <div className="hero-progression-tabs" role="tablist" aria-label="Hero mastery">
        {HERO_OPTIONS.map((heroOption) => (
          <button
            key={heroOption.id}
            type="button"
            className={heroOption.id === selectedHero ? "active" : ""}
            onClick={() => onSelectHero(heroOption.id)}
          >
            {heroOption.name}
          </button>
        ))}
      </div>

      {hero && tree ? (
        <div className="hero-progression-detail">
          <div className="hero-progression-heading">
            <div>
              <span>{selectedHeroOption?.role ?? "Hero"}</span>
              <h3>{selectedHeroOption?.name ?? selectedHero}</h3>
            </div>
            <button className="secondary-link" type="button" onClick={() => void handleRespec()}>
              <RotateCcw size={16} />
              Respec
            </button>
          </div>
          <div className="progression-summary compact">
            <div>
              <span>Mastery</span>
              <strong>{hero.level}</strong>
            </div>
            <div>
              <span>Skill Points</span>
              <strong>{hero.availableSkillPoints}</strong>
            </div>
            <div>
              <span>Hero XP</span>
              <strong>{hero.xp}</strong>
            </div>
          </div>
          <ProgressBar
            label={`Next mastery level in ${hero.xpToNextLevel} XP`}
            value={hero.xpIntoLevel}
            max={hero.nextLevelXp - hero.currentLevelXp}
          />
          {appearanceProgression ? (
            <HeroAppearanceSelector
              heroName={selectedHeroOption?.name ?? selectedHero}
              appearanceProgression={appearanceProgression}
              onSelect={handleAppearanceSelect}
            />
          ) : null}
          <div className="rune-loadout-editor" aria-label="Default rune loadout">
            <h3>Default Runes</h3>
            <div className="rune-grid">
              {progression.runes.map((rune) => {
                const selected = loadout.includes(rune.id);
                const disabled = !rune.unlocked || (!selected && loadout.length >= progression.account.runeSlots);
                return (
                  <button
                    key={rune.id}
                    type="button"
                    className={selected ? "selected" : ""}
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => void handleToggleRune(rune)}
                    title={rune.unlocked ? rune.text : `Unlocks at account level ${rune.unlockLevel}`}
                  >
                    <strong>{rune.name}</strong>
                    <span>{rune.unlocked ? rune.text : `Level ${rune.unlockLevel}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <SkillTreeGraph tree={tree} hero={hero} onUnlock={handleUnlock} />
        </div>
      ) : null}
    </div>
  );
}

function HeroAppearanceSelector({
  heroName,
  appearanceProgression,
  onSelect,
}: {
  heroName: string;
  appearanceProgression: HeroAppearanceProgression;
  onSelect: (appearance: HeroAppearanceDefinition) => Promise<void>;
}) {
  return (
    <div className="hero-appearance-selector" aria-label="Board appearance variants">
      <div className="hero-appearance-preview">
        <HeroPreview3D
          heroType={appearanceProgression.heroType}
          label={heroName}
          appearanceId={appearanceProgression.selectedAppearanceId}
        />
      </div>
      <div className="hero-appearance-options">
        <h3>Board Appearance</h3>
        <div className="hero-appearance-grid">
          {appearanceProgression.appearances.map((appearance) => {
            const selected = appearance.id === appearanceProgression.selectedAppearanceId;
            return (
              <button
                key={appearance.id}
                type="button"
                className={selected ? "selected" : ""}
                disabled={!appearance.unlocked}
                aria-pressed={selected}
                onClick={() => void onSelect(appearance)}
                title={
                  appearance.unlocked
                    ? appearance.text
                    : `Unlocks at mastery level ${appearance.unlockLevel}`
                }
              >
                <strong>{appearance.name}</strong>
                <span>
                  {appearance.unlocked
                    ? selected
                      ? "Selected"
                      : appearance.text
                    : `Mastery ${appearance.unlockLevel}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SkillTreeGraph({
  tree,
  hero,
  onUnlock,
}: {
  tree: HeroSkillTree;
  hero: HeroProgression;
  onUnlock: (node: SkillNodeDefinition) => Promise<void>;
}) {
  const layout = skillGraphLayout(tree.nodes);
  const rootId = tree.nodes.find((node) => node.root)?.id;

  return (
    <div className="skill-tree-viewport">
      <div
        className="skill-tree-graph"
        aria-label="Hero skill tree"
        style={
          {
            "--skill-graph-width": `${SKILL_GRAPH_WIDTH}px`,
            "--skill-graph-height": `${SKILL_GRAPH_HEIGHT}px`,
          } as CSSProperties
        }
      >
        <svg className="skill-tree-edges" viewBox={`0 0 ${SKILL_GRAPH_WIDTH} ${SKILL_GRAPH_HEIGHT}`} aria-hidden="true">
          {tree.nodes
            .filter((node) => node.prerequisiteId)
            .map((node) => {
              const from = layout.get(node.prerequisiteId ?? "");
              const to = layout.get(node.id);
              if (!from || !to) {
                return null;
              }
              const unlocked = hero.unlockedSkillIds.includes(node.id);
              const prerequisiteUnlocked =
                node.prerequisiteId === rootId || hero.unlockedSkillIds.includes(node.prerequisiteId ?? "");
              return (
                <line
                  key={`${node.prerequisiteId}-${node.id}`}
                  className={unlocked ? "unlocked" : prerequisiteUnlocked ? "available" : ""}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                />
              );
            })}
        </svg>
        {tree.nodes.map((node) => {
          const position = layout.get(node.id) ?? { x: SKILL_GRAPH_WIDTH / 2, y: SKILL_GRAPH_HEIGHT / 2 };
          const unlocked = node.root || hero.unlockedSkillIds.includes(node.id);
          const prerequisiteMet =
            !node.prerequisiteId ||
            node.prerequisiteId === rootId ||
            hero.unlockedSkillIds.includes(node.prerequisiteId);
          const disabled = unlocked || !prerequisiteMet || hero.availableSkillPoints === 0;
          const status = unlocked ? "Unlocked" : prerequisiteMet && hero.availableSkillPoints > 0 ? "Available" : "Locked";
          return (
            <button
              key={node.id}
              type="button"
              className={`skill-node ${unlocked ? "unlocked" : ""} ${status.toLowerCase()}`}
              disabled={disabled}
              aria-pressed={unlocked}
              onClick={() => void onUnlock(node)}
              style={{ left: position.x, top: position.y }}
            >
              <span>{status}</span>
              <strong>{node.name}</strong>
              <small>{node.text}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function skillGraphLayout(nodes: SkillNodeDefinition[]) {
  const root = nodes.find((node) => node.root) ?? nodes[0];
  const positions = new Map<string, { x: number; y: number }>();
  if (!root) {
    return positions;
  }

  positions.set(root.id, { x: SKILL_GRAPH_WIDTH / 2, y: 66 });
  const rootChildren = nodes.filter((node) => node.prerequisiteId === root.id);
  const rootChildX = distributedX(rootChildren.length);
  rootChildren.forEach((node, index) => {
    const x = rootChildX[index] ?? SKILL_GRAPH_WIDTH / 2;
    positions.set(node.id, { x, y: 214 });

    const childNodes = nodes.filter((candidate) => candidate.prerequisiteId === node.id);
    const childX = distributedX(childNodes.length, x, 122);
    childNodes.forEach((childNode, childIndex) => {
      positions.set(childNode.id, { x: childX[childIndex] ?? x, y: 354 });
    });
  });

  const unplaced = nodes.filter((node) => !positions.has(node.id));
  const unplacedX = distributedX(unplaced.length);
  unplaced.forEach((node, index) => {
    positions.set(node.id, { x: unplacedX[index] ?? SKILL_GRAPH_WIDTH / 2, y: 354 });
  });

  return positions;
}

function distributedX(count: number, center = SKILL_GRAPH_WIDTH / 2, spread = 300) {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [center];
  }
  const first = center - spread / 2;
  const step = spread / (count - 1);
  return Array.from({ length: count }, (_, index) => first + step * index);
}

function ProgressBar({ label, value, max }: { label: string; value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress-bar" aria-label={label}>
      <div>
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>{label}</small>
    </div>
  );
}

function avatarSymbolLabel(symbol: string) {
  return symbol.slice(0, 1).toUpperCase();
}
