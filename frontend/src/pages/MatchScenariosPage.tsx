import { FlaskConical, House, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { createMatchScenario, loadMatchScenarios } from "../api";
import type { AccountProps } from "../appTypes";
import { ShellMessage, TopNav } from "../components/common";
import type { MatchScenarioSummary } from "../types";

export type ScenarioLoadState =
  | {
      status: "loading";
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "ready";
      scenarios: MatchScenarioSummary[];
    };

export function MatchScenariosPage({
  onNavigate,
  currentUser,
  onSignOut,
}: {
  onNavigate: (to: string) => void;
} & AccountProps) {
  const [loadState, setLoadState] = useState<ScenarioLoadState>({ status: "loading" });
  const [busyScenarioId, setBusyScenarioId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadMatchScenarios()
      .then((response) => setLoadState({ status: "ready", scenarios: response.scenarios }))
      .catch((error: unknown) =>
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load match scenarios",
        }),
      );
  }, []);

  async function handleLoadScenario(scenario: MatchScenarioSummary) {
    setBusyScenarioId(scenario.id);
    setNotice(null);
    try {
      const created = await createMatchScenario(scenario.id);
      onNavigate(`/match/${created.matchId}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load match scenario");
    } finally {
      setBusyScenarioId(null);
    }
  }

  return (
    <MatchScenariosView
      loadState={loadState}
      busyScenarioId={busyScenarioId}
      notice={notice}
      currentUser={currentUser}
      onNavigate={onNavigate}
      onSignOut={onSignOut}
      onLoadScenario={(scenario) => void handleLoadScenario(scenario)}
    />
  );
}

export function MatchScenariosView({
  loadState,
  busyScenarioId,
  notice,
  currentUser,
  onNavigate,
  onSignOut,
  onLoadScenario,
}: {
  loadState: ScenarioLoadState;
  busyScenarioId: string | null;
  notice: string | null;
  onNavigate: (to: string) => void;
  onLoadScenario: (scenario: MatchScenarioSummary) => void;
} & AccountProps) {
  if (loadState.status === "loading") {
    return <ShellMessage title="Match Scenarios" message="Loading scenarios" />;
  }

  if (loadState.status === "error") {
    return (
      <ShellMessage
        title="Match Scenarios"
        message={loadState.message}
        actions={
          <button className="primary-button" type="button" onClick={() => onNavigate("/play")}>
            <House size={18} />
            Play
          </button>
        }
      />
    );
  }

  return (
    <main className="app-shell dev-scenarios-shell">
      <TopNav currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
      <section className="dev-scenarios-layout" aria-label="Match scenarios">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Local development</p>
            <h1>Match Scenarios</h1>
          </div>
          <div className="actions">
            <button className="icon-button" type="button" onClick={() => onNavigate("/")} title="Dashboard">
              <House size={18} />
            </button>
          </div>
        </header>

        <div className="scenario-list" role="list" aria-label="Playable match scenarios">
          {loadState.scenarios.map((scenario) => (
            <article className="scenario-row" role="listitem" key={scenario.id}>
              <div className="scenario-row-main">
                <span className="scenario-icon" aria-hidden="true">
                  <FlaskConical size={18} />
                </span>
                <div>
                  <strong>{scenario.name}</strong>
                  <p>{scenario.description}</p>
                </div>
              </div>
              <div className="scenario-actions" aria-label={`${scenario.name} actions`}>
                {scenario.primaryActions.map((action) => (
                  <span className="scenario-action-pill" key={action}>
                    {action}
                  </span>
                ))}
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={busyScenarioId !== null}
                onClick={() => onLoadScenario(scenario)}
              >
                <Play size={18} />
                {busyScenarioId === scenario.id ? "Loading" : "Load Scenario"}
              </button>
            </article>
          ))}
        </div>
        {notice ? <p className="notice">{notice}</p> : null}
      </section>
    </main>
  );
}
