import { ChevronLeft, ChevronRight, Eye, EyeOff, History, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { loadReplay } from "../api";
import type { AccountPreferenceProps, ReplayLoadState } from "../appTypes";
import { createBoardAnimationCue } from "../boardAnimations";
import { Board, PlayerBadge } from "../components/board";
import { AccountActions, ShellMessage } from "../components/common";
import { useMatchChromeMinimized } from "../appHooks";
import { eventDetail, eventSideLabel, eventTitle, sideLabel } from "../labels";

export function ReplayPage({
  matchId,
  onNavigate,
  currentUser,
  onSignOut,
  allowSignOut,
  loginNextPath,
  visualPreferences,
}: {
  matchId: string;
  onNavigate: (to: string) => void;
} & AccountPreferenceProps) {
  const boardVisualMode = visualPreferences.preferences.boardVisualMode;
  const [loadState, setLoadState] = useState<ReplayLoadState>({ status: "loading" });
  const [frameIndex, setFrameIndex] = useState(0);
  const [matchChromeMinimized, setMatchChromeMinimized] = useMatchChromeMinimized();
  const reducedMotion = visualPreferences.effectiveMotion === "reduced";

  useEffect(() => {
    setLoadState({ status: "loading" });
    setFrameIndex(0);
    loadReplay(matchId)
      .then((response) => setLoadState({ status: "ready", replay: response }))
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load replay",
        }),
      );
  }, [matchId]);

  if (loadState.status === "loading") {
    return <ShellMessage title={`Replay ${matchId}`} message="Loading replay" />;
  }

  if (loadState.status === "error") {
    return (
      <ShellMessage
        title={`Replay ${matchId}`}
        message={loadState.message}
        actions={
          <button className="primary-button" type="button" onClick={() => onNavigate("/matches")}>
            Match Archive
          </button>
        }
      />
    );
  }

  const { replay } = loadState;
  const frameCount = replay.frames.length;
  const clampedFrameIndex = Math.min(frameIndex, Math.max(frameCount - 1, 0));
  const frame = replay.frames[clampedFrameIndex];
  const match = frame.matchState;
  const boardAnimation = createBoardAnimationCue({
    previous: replay.frames[clampedFrameIndex - 1]?.matchState ?? null,
    next: match,
    event: frame.event,
    sequence: clampedFrameIndex,
    reducedMotion,
  });

  return (
    <main
      className={`app-shell match-app-shell replay-shell ${matchChromeMinimized ? "match-chrome-minimized" : ""}`}
    >
      <section className="table match-table replay-table">
        <header className="top-bar match-chrome">
          <div>
            <p className="eyebrow">Rune Lanes Replay</p>
            <h1>Round {match.round}</h1>
            <p className="match-id">Match {matchId}</p>
          </div>
          <div className="actions">
            <AccountActions
              currentUser={currentUser}
              onNavigate={onNavigate}
              onSignOut={onSignOut}
              allowSignOut={allowSignOut}
              loginNextPath={loginNextPath}
            />
            <button
              className="icon-button"
              type="button"
              onClick={() => onNavigate("/matches")}
              title="Match archive"
            >
              <History size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => onNavigate(`/match/${matchId}`)}
              title="Playable match"
            >
              <Play size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setMatchChromeMinimized(true)}
              title="Minimize match chrome"
              aria-label="Minimize match chrome"
            >
              <EyeOff size={18} />
            </button>
          </div>
        </header>
        <button
          className="icon-button match-chrome-restore"
          type="button"
          onClick={() => setMatchChromeMinimized(false)}
          title="Restore match chrome"
          aria-label="Restore match chrome"
        >
          <Eye size={18} />
        </button>

        <section className="battlefield replay-battlefield">
          <div className="battlefield-hud battlefield-hud-player">
            <PlayerBadge player={match.player} />
          </div>
          <div className="battlefield-hud battlefield-hud-phase">
            <div className="phase-pill">
              {replay.visibility === "revealed" ? <Eye size={16} /> : <EyeOff size={16} />}
              {match.phase === "matchOver" ? `${sideLabel(match.winner)} wins` : "Planning"}
            </div>
          </div>
          <div className="battlefield-hud battlefield-hud-opponent">
            <PlayerBadge player={match.opponent} />
          </div>

          <Board
            match={match}
            animation={boardAnimation}
            boardVisualMode={boardVisualMode}
            viewerSide="player"
            selectedCard={null}
            selectedPiece={null}
            disabled={false}
            readOnly
          />
        </section>

        <section className="replay-inspector" aria-label="Replay timeline">
          <div className="replay-controls">
            <button
              className="icon-button"
              type="button"
              onClick={() => setFrameIndex(Math.max(clampedFrameIndex - 1, 0))}
              disabled={clampedFrameIndex === 0}
              title="Previous frame"
            >
              <ChevronLeft size={18} />
            </button>
            <input
              type="range"
              min="0"
              max={Math.max(frameCount - 1, 0)}
              value={clampedFrameIndex}
              onChange={(event) => setFrameIndex(Number(event.target.value))}
              aria-label="Replay frame"
            />
            <button
              className="icon-button"
              type="button"
              onClick={() => setFrameIndex(Math.min(clampedFrameIndex + 1, frameCount - 1))}
              disabled={clampedFrameIndex >= frameCount - 1}
              title="Next frame"
            >
              <ChevronRight size={18} />
            </button>
            <span className="frame-count">
              {clampedFrameIndex + 1}/{frameCount}
            </span>
          </div>

          <aside className="event-detail" aria-label="Replay event">
            <p className="eyebrow">{eventSideLabel(frame.event)}</p>
            <h2>{eventTitle(frame.event)}</h2>
            <p>{eventDetail(frame.event)}</p>
          </aside>
        </section>
      </section>
    </main>
  );
}
