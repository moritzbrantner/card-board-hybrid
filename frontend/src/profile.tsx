import { History, House, LogOut, Play, RotateCcw, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadProfileMatches,
  loadProgression,
  respecWizardSkills,
  saveWizardRuneLoadout,
  unlockWizardSkill,
  updateProfile,
} from "./api";
import type {
  AccountProfile,
  BoardVisualMode,
  GeneratedAvatar,
  MatchSummary,
  ProgressionResponse,
  RuneDefinition,
  SkillNodeDefinition,
  WizardProgression,
  WizardSkillTree,
  WizardType,
} from "./types";
import { WIZARD_OPTIONS } from "./wizards";

type ProfilePageProps = {
  currentUser: AccountProfile;
  onNavigate: (to: string) => void;
  onProfileUpdated: (profile: AccountProfile) => void;
  onSignOut: () => void;
};

type ProfileMatchesState =
  | { status: "loading" }
  | { status: "ready"; matches: MatchSummary[] }
  | { status: "error"; message: string };

type ProgressionState =
  | { status: "loading" }
  | { status: "ready"; progression: ProgressionResponse }
  | { status: "error"; message: string };

const AVATAR_SYMBOLS = ["sparkles", "shield", "sword", "wand", "rune", "flame"] as const;
const AVATAR_COLORS = ["emerald", "indigo", "rose", "amber", "sky", "slate"] as const;

export function ProfilePage({
  currentUser,
  onNavigate,
  onProfileUpdated,
  onSignOut,
}: ProfilePageProps) {
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [avatar, setAvatar] = useState<GeneratedAvatar>(currentUser.avatar);
  const [preferredWizardType, setPreferredWizardType] = useState<WizardType>(
    currentUser.preferredWizardType,
  );
  const [boardVisualMode, setBoardVisualMode] = useState<BoardVisualMode>(
    currentUser.boardVisualMode,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [matchesState, setMatchesState] = useState<ProfileMatchesState>({ status: "loading" });
  const [progressionState, setProgressionState] = useState<ProgressionState>({
    status: "loading",
  });
  const [selectedProgressionWizard, setSelectedProgressionWizard] = useState<WizardType>(
    currentUser.preferredWizardType,
  );

  useEffect(() => {
    let cancelled = false;
    loadProfileMatches()
      .then((response) => {
        if (!cancelled) {
          setMatchesState({ status: "ready", matches: response.matches });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMatchesState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load profile matches",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadProgression()
      .then((progression) => {
        if (!cancelled) {
          setProgressionState({ status: "ready", progression });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProgressionState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load progression",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await updateProfile(displayName, avatar, preferredWizardType, boardVisualMode);
      onProfileUpdated(updated);
      setDisplayName(updated.displayName);
      setAvatar(updated.avatar);
      setPreferredWizardType(updated.preferredWizardType);
      setBoardVisualMode(updated.boardVisualMode);
      setNotice("Profile saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell archive-shell">
      <section className="profile-layout" aria-label="Profile">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Rune Lanes</p>
            <h1>Profile</h1>
          </div>
          <div className="actions">
            <button className="icon-button" type="button" onClick={() => onNavigate("/")} title="Match picker">
              <House size={18} />
            </button>
            <button className="icon-button" type="button" onClick={onSignOut} title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>

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
          <label className="preferred-wizard-control" htmlFor="profile-preferred-wizard">
            <span>Preferred Wizard</span>
            <select
              id="profile-preferred-wizard"
              value={preferredWizardType}
              onChange={(event) => setPreferredWizardType(event.target.value as WizardType)}
            >
              {WIZARD_OPTIONS.map((wizard) => (
                <option key={wizard.id} value={wizard.id}>
                  {wizard.name} · {wizard.role}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="board-visual-mode-control">
            <legend>Board visual mode</legend>
            <div>
              <button
                className={boardVisualMode === "2d" ? "active" : ""}
                type="button"
                onClick={() => setBoardVisualMode("2d")}
                aria-pressed={boardVisualMode === "2d"}
              >
                2D
              </button>
              <button
                className={boardVisualMode === "3d" ? "active" : ""}
                type="button"
                onClick={() => setBoardVisualMode("3d")}
                aria-pressed={boardVisualMode === "3d"}
              >
                3D
              </button>
            </div>
          </fieldset>
          <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={busy}>
            <Save size={18} />
            Save Profile
          </button>
          {notice ? <p className="notice">{notice}</p> : null}
        </section>

        <section className="profile-progression" aria-label="Progression">
          <div className="section-heading">
            <Sparkles size={18} />
            <h2>Progression</h2>
          </div>
          {progressionState.status === "loading" ? <p className="empty-state">Loading progression.</p> : null}
          {progressionState.status === "error" ? <p className="notice">{progressionState.message}</p> : null}
          {progressionState.status === "ready" ? (
            <ProgressionPanel
              progression={progressionState.progression}
              selectedWizard={selectedProgressionWizard}
              onSelectWizard={setSelectedProgressionWizard}
              onProgressionChanged={(progression) => setProgressionState({ status: "ready", progression })}
            />
          ) : null}
        </section>

        <section className="profile-history" aria-label="Profile match history">
          <div className="section-heading">
            <History size={18} />
            <h2>Match History</h2>
          </div>
          {matchesState.status === "loading" ? <p className="empty-state">Loading matches.</p> : null}
          {matchesState.status === "error" ? <p className="notice">{matchesState.message}</p> : null}
          {matchesState.status === "ready" && matchesState.matches.length === 0 ? (
            <p className="empty-state">No owned matches yet.</p>
          ) : null}
          {matchesState.status === "ready" && matchesState.matches.length > 0 ? (
            <div className="match-list" role="list" aria-label="Owned matches">
              {matchesState.matches.map((match) => (
                <article className="match-row" role="listitem" key={match.matchId}>
                  <div>
                    <strong>{match.matchId}</strong>
                    <span>{formatMatchStatus(match)}</span>
                  </div>
                  <div className="match-row-stat">
                    <span>Round</span>
                    <strong>{match.round}</strong>
                  </div>
                  <div className="match-row-stat">
                    <span>Frames</span>
                    <strong>{match.frameCount}</strong>
                  </div>
                  <div className="match-row-date">
                    <span>Updated</span>
                    <strong>{formatUnixTime(match.updatedAt)}</strong>
                  </div>
                  <div className="match-row-actions">
                    {match.phase !== "matchOver" ? (
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => onNavigate(`/match/${match.matchId}`)}
                        title="Continue match"
                      >
                        <Play size={18} />
                      </button>
                    ) : null}
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => onNavigate(`/matches/${match.matchId}/replay`)}
                    >
                      <History size={18} />
                      Replay
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function ProgressionPanel({
  progression,
  selectedWizard,
  onSelectWizard,
  onProgressionChanged,
}: {
  progression: ProgressionResponse;
  selectedWizard: WizardType;
  onSelectWizard: (wizardType: WizardType) => void;
  onProgressionChanged: (progression: ProgressionResponse) => void;
}) {
  const wizard = progression.wizards.find((candidate) => candidate.wizardType === selectedWizard);
  const tree = progression.skillTrees.find((candidate) => candidate.wizardType === selectedWizard);
  const loadout =
    progression.loadouts.find((candidate) => candidate.wizardType === selectedWizard)?.runeIds ?? [];
  const selectedWizardOption = WIZARD_OPTIONS.find((option) => option.id === selectedWizard);

  async function handleToggleRune(rune: RuneDefinition) {
    if (!rune.unlocked) {
      return;
    }
    const nextRuneIds = loadout.includes(rune.id)
      ? loadout.filter((runeId) => runeId !== rune.id)
      : [...loadout, rune.id].slice(0, progression.account.runeSlots);
    const updated = await saveWizardRuneLoadout(selectedWizard, nextRuneIds);
    onProgressionChanged(updated);
  }

  async function handleUnlock(node: SkillNodeDefinition) {
    const updated = await unlockWizardSkill(selectedWizard, node.id);
    onProgressionChanged(updated);
  }

  async function handleRespec() {
    const updated = await respecWizardSkills(selectedWizard);
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

      <div className="wizard-progression-tabs" role="tablist" aria-label="Wizard mastery">
        {WIZARD_OPTIONS.map((wizardOption) => (
          <button
            key={wizardOption.id}
            type="button"
            className={wizardOption.id === selectedWizard ? "active" : ""}
            onClick={() => onSelectWizard(wizardOption.id)}
          >
            {wizardOption.name}
          </button>
        ))}
      </div>

      {wizard && tree ? (
        <div className="wizard-progression-detail">
          <div className="wizard-progression-heading">
            <div>
              <span>{selectedWizardOption?.role ?? "Wizard"}</span>
              <h3>{selectedWizardOption?.name ?? selectedWizard}</h3>
            </div>
            <button className="secondary-link" type="button" onClick={() => void handleRespec()}>
              <RotateCcw size={16} />
              Respec
            </button>
          </div>
          <div className="progression-summary compact">
            <div>
              <span>Mastery</span>
              <strong>{wizard.level}</strong>
            </div>
            <div>
              <span>Skill Points</span>
              <strong>{wizard.availableSkillPoints}</strong>
            </div>
            <div>
              <span>Wizard XP</span>
              <strong>{wizard.xp}</strong>
            </div>
          </div>
          <ProgressBar
            label={`Next mastery level in ${wizard.xpToNextLevel} XP`}
            value={wizard.xpIntoLevel}
            max={wizard.nextLevelXp - wizard.currentLevelXp}
          />
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
          <div className="skill-tree" aria-label="Wizard skill tree">
            {tree.nodes.map((node) => {
              const unlocked = node.root || wizard.unlockedSkillIds.includes(node.id);
              const prerequisiteMet =
                !node.prerequisiteId ||
                node.prerequisiteId === tree.nodes[0]?.id ||
                wizard.unlockedSkillIds.includes(node.prerequisiteId);
              const disabled = unlocked || !prerequisiteMet || wizard.availableSkillPoints === 0;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={unlocked ? "unlocked" : ""}
                  disabled={disabled}
                  onClick={() => void handleUnlock(node)}
                >
                  <strong>{node.name}</strong>
                  <span>{node.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
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

function formatMatchStatus(match: MatchSummary) {
  if (match.winner) {
    return `${sideLabel(match.winner)} won`;
  }
  return match.phase === "matchOver" ? "Match over" : "In progress";
}

function formatUnixTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000));
}

function sideLabel(side: string) {
  return side === "player" ? "Player" : "Opponent";
}
