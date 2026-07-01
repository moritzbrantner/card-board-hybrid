import { History, House, LogOut, Play, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { loadProfileMatches, updateProfile } from "./api";
import type { AccountProfile, GeneratedAvatar, MatchSummary } from "./types";

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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [matchesState, setMatchesState] = useState<ProfileMatchesState>({ status: "loading" });

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

  async function handleSave() {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await updateProfile(displayName, avatar);
      onProfileUpdated(updated);
      setDisplayName(updated.displayName);
      setAvatar(updated.avatar);
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
          <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={busy}>
            <Save size={18} />
            Save Profile
          </button>
          {notice ? <p className="notice">{notice}</p> : null}
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
