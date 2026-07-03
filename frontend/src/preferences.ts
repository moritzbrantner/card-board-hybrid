import type {
  AccountPreferences,
  AnimationSpeed,
  BoardScale,
  HotkeyBinding,
  MotionPreference,
  PreferenceTheme,
  UpdatePreferencesRequest,
} from "./types";
import { DEFAULT_HOTKEYS, normalizeHotkeysWithDefaults } from "./hotkeys";

type UnknownPreferences = Partial<Record<keyof AccountPreferences, unknown>>;

export type EffectiveTheme = "dark" | "light" | "highContrast";
export type EffectiveMotion = "reduced" | "full";

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  theme: "system",
  motion: "system",
  animationSpeed: "normal",
  boardScale: "normal",
  boardVisualMode: "3d",
  hotkeys: DEFAULT_HOTKEYS,
  updatedAt: null,
};

const THEMES = ["system", "dark", "light", "highContrast"] as const;
const MOTIONS = ["system", "reduced", "full"] as const;
const ANIMATION_SPEEDS = ["slow", "normal", "fast"] as const;
const BOARD_SCALES = ["compact", "normal", "large"] as const;
const BOARD_VISUAL_MODES = ["2d", "3d"] as const;

export function normalizeAccountPreferences(value: unknown): AccountPreferences {
  const payload = isRecord(value) ? (value as UnknownPreferences) : {};
  return {
    theme: enumValue(payload.theme, THEMES, DEFAULT_ACCOUNT_PREFERENCES.theme),
    motion: enumValue(payload.motion, MOTIONS, DEFAULT_ACCOUNT_PREFERENCES.motion),
    animationSpeed: enumValue(
      payload.animationSpeed,
      ANIMATION_SPEEDS,
      DEFAULT_ACCOUNT_PREFERENCES.animationSpeed,
    ),
    boardScale: enumValue(payload.boardScale, BOARD_SCALES, DEFAULT_ACCOUNT_PREFERENCES.boardScale),
    boardVisualMode: enumValue(
      payload.boardVisualMode,
      BOARD_VISUAL_MODES,
      DEFAULT_ACCOUNT_PREFERENCES.boardVisualMode,
    ),
    hotkeys: normalizeHotkeysWithDefaults(payload.hotkeys),
    updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : null,
  };
}

export function accountPreferencesSavePayload(
  current: AccountPreferences,
  nextVisuals: Pick<AccountPreferences, "theme" | "motion" | "animationSpeed" | "boardScale"> &
    Partial<Pick<AccountPreferences, "boardVisualMode">>,
  nextHotkeys: HotkeyBinding[] = current.hotkeys,
): UpdatePreferencesRequest {
  return {
    ...nextVisuals,
    boardVisualMode: nextVisuals.boardVisualMode ?? current.boardVisualMode,
    hotkeys: normalizeHotkeysWithDefaults(nextHotkeys),
  };
}

export function resolvePreferenceTheme(
  theme: PreferenceTheme,
  prefersDarkTheme: boolean,
): EffectiveTheme {
  if (theme === "system") {
    return prefersDarkTheme ? "dark" : "light";
  }
  return theme;
}

export function resolveMotionPreference(
  motion: MotionPreference,
  prefersReducedMotion: boolean,
): EffectiveMotion {
  if (motion === "system") {
    return prefersReducedMotion ? "reduced" : "full";
  }
  return motion;
}

export function visualPreferencesCssAttributes(
  preferences: AccountPreferences,
  system: { prefersDarkTheme: boolean; prefersReducedMotion: boolean },
) {
  return {
    "data-theme": resolvePreferenceTheme(preferences.theme, system.prefersDarkTheme),
    "data-motion": resolveMotionPreference(preferences.motion, system.prefersReducedMotion),
    "data-animation-speed": preferences.animationSpeed,
    "data-board-scale": preferences.boardScale,
  };
}

export function visualPreferencesLiveAiDelayMs(
  animationSpeed: AnimationSpeed,
  motion: EffectiveMotion,
) {
  if (motion === "reduced") {
    return 0;
  }

  switch (animationSpeed) {
    case "slow":
      return 1400;
    case "fast":
      return 450;
    case "normal":
      return 1000;
  }
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
