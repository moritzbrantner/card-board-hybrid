import { House, LogOut, RefreshCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { accountPreferencesSavePayload } from "./preferences";
import type {
  AccountPreferences,
  AnimationSpeed,
  BoardScale,
  MotionPreference,
  PreferenceTheme,
} from "./types";

type SettingsState =
  | { status: "loading"; preferences: AccountPreferences }
  | { status: "ready"; preferences: AccountPreferences }
  | { status: "error"; preferences: AccountPreferences; message: string };

type SettingsPageProps = {
  preferencesState: SettingsState;
  onNavigate: (to: string) => void;
  onSave: (preferences: ReturnType<typeof accountPreferencesSavePayload>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
};

const THEME_OPTIONS: Array<[PreferenceTheme, string]> = [
  ["system", "System"],
  ["dark", "Dark"],
  ["light", "Light"],
  ["highContrast", "High contrast"],
];

const MOTION_OPTIONS: Array<[MotionPreference, string]> = [
  ["system", "System"],
  ["reduced", "Reduced"],
  ["full", "Full"],
];

const SPEED_OPTIONS: Array<[AnimationSpeed, string]> = [
  ["slow", "Slow"],
  ["normal", "Normal"],
  ["fast", "Fast"],
];

const SCALE_OPTIONS: Array<[BoardScale, string]> = [
  ["compact", "Compact"],
  ["normal", "Normal"],
  ["large", "Large"],
];

export function SettingsPage({
  preferencesState,
  onNavigate,
  onSave,
  onRefresh,
  onSignOut,
}: SettingsPageProps) {
  const preferences = preferencesState.preferences;
  const [theme, setTheme] = useState<PreferenceTheme>(preferences.theme);
  const [motion, setMotion] = useState<MotionPreference>(preferences.motion);
  const [animationSpeed, setAnimationSpeed] = useState<AnimationSpeed>(
    preferences.animationSpeed,
  );
  const [boardScale, setBoardScale] = useState<BoardScale>(preferences.boardScale);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setTheme(preferences.theme);
    setMotion(preferences.motion);
    setAnimationSpeed(preferences.animationSpeed);
    setBoardScale(preferences.boardScale);
  }, [preferences]);

  async function handleSave() {
    setBusy(true);
    setNotice(null);
    try {
      await onSave(
        accountPreferencesSavePayload(preferences, {
          theme,
          motion,
          animationSpeed,
          boardScale,
        }),
      );
      setNotice("Settings saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    setNotice(null);
    try {
      await onRefresh();
      setNotice("Settings refreshed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not refresh settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell archive-shell">
      <section className="settings-layout" aria-label="Settings">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Account preferences</p>
            <h1>Settings</h1>
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

        <section className="settings-panel" aria-label="Visual preferences">
          <div className="section-heading">
            <h2>Visual Preferences</h2>
          </div>
          {preferencesState.status === "loading" ? (
            <p className="empty-state">Loading settings.</p>
          ) : null}
          {preferencesState.status === "error" ? (
            <p className="notice">{preferencesState.message}</p>
          ) : null}
          <PreferenceSelect
            id="settings-theme"
            label="Theme"
            value={theme}
            options={THEME_OPTIONS}
            onChange={(value) => setTheme(value as PreferenceTheme)}
            disabled={busy}
          />
          <PreferenceSelect
            id="settings-motion"
            label="Motion"
            value={motion}
            options={MOTION_OPTIONS}
            onChange={(value) => setMotion(value as MotionPreference)}
            disabled={busy}
          />
          <PreferenceSelect
            id="settings-animation-speed"
            label="Animation speed"
            value={animationSpeed}
            options={SPEED_OPTIONS}
            onChange={(value) => setAnimationSpeed(value as AnimationSpeed)}
            disabled={busy}
          />
          <PreferenceSelect
            id="settings-board-scale"
            label="Board scale"
            value={boardScale}
            options={SCALE_OPTIONS}
            onChange={(value) => setBoardScale(value as BoardScale)}
            disabled={busy}
          />
          <div className="settings-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || preferencesState.status === "loading"}
            >
              <Save size={18} />
              Save Settings
            </button>
            <button className="secondary-link" type="button" onClick={() => void handleRefresh()} disabled={busy}>
              <RefreshCcw size={18} />
              Refresh
            </button>
          </div>
          {notice ? <p className="notice">{notice}</p> : null}
        </section>
      </section>
    </main>
  );
}

function PreferenceSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="settings-control" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

export type { SettingsState };
