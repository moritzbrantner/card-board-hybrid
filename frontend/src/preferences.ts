import type {
  AccountPreferences,
  AnimationSpeed,
  BoardScale,
  HotkeyBinding,
  MotionPreference,
  PreferenceTheme,
  UpdatePreferencesRequest,
} from "./types";

type UnknownPreferences = Partial<Record<keyof AccountPreferences, unknown>>;

export type EffectiveTheme = "dark" | "light" | "highContrast";
export type EffectiveMotion = "reduced" | "full";

export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  { commandId: "cursorNorthwest", binding: "Q" },
  { commandId: "cursorNortheast", binding: "W" },
  { commandId: "cursorEast", binding: "E" },
  { commandId: "cursorWest", binding: "A" },
  { commandId: "cursorSouthwest", binding: "S" },
  { commandId: "cursorSoutheast", binding: "D" },
  { commandId: "confirm", binding: "Enter" },
  { commandId: "cancel", binding: "Escape" },
  { commandId: "endTurn", binding: "T" },
  { commandId: "passPriority", binding: "P" },
  { commandId: "openCardInfo", binding: "I" },
  { commandId: "openSettings", binding: "," },
  { commandId: "openCatalog", binding: "C" },
  { commandId: "openDecks", binding: "K" },
  { commandId: "openMatchArchive", binding: "M" },
];

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  theme: "system",
  motion: "system",
  animationSpeed: "normal",
  boardScale: "normal",
  hotkeys: DEFAULT_HOTKEYS,
  updatedAt: null,
};

const THEMES = ["system", "dark", "light", "highContrast"] as const;
const MOTIONS = ["system", "reduced", "full"] as const;
const ANIMATION_SPEEDS = ["slow", "normal", "fast"] as const;
const BOARD_SCALES = ["compact", "normal", "large"] as const;

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
    hotkeys: mergeHotkeysWithDefaults(payload.hotkeys),
    updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : null,
  };
}

export function accountPreferencesSavePayload(
  current: AccountPreferences,
  nextVisuals: Pick<AccountPreferences, "theme" | "motion" | "animationSpeed" | "boardScale">,
): UpdatePreferencesRequest {
  return {
    ...nextVisuals,
    hotkeys: mergeHotkeysWithDefaults(current.hotkeys),
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

function mergeHotkeysWithDefaults(value: unknown): HotkeyBinding[] {
  const incoming = Array.isArray(value) ? value.filter(isHotkeyBinding) : [];
  const incomingByCommand = new Map(incoming.map((hotkey) => [hotkey.commandId, hotkey.binding]));
  return DEFAULT_HOTKEYS.map((hotkey) => ({
    commandId: hotkey.commandId,
    binding: incomingByCommand.get(hotkey.commandId) ?? hotkey.binding,
  }));
}

function isHotkeyBinding(value: unknown): value is HotkeyBinding {
  return (
    isRecord(value) &&
    typeof value.commandId === "string" &&
    typeof value.binding === "string" &&
    value.commandId.length > 0 &&
    value.binding.length > 0
  );
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
