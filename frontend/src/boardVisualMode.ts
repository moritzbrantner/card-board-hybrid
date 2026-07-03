import type { AuthUser, BoardVisualMode } from "./types";

export const BOARD_VISUAL_MODE_STORAGE_KEY = "rune-lanes-board-visual-mode";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function isBoardVisualMode(value: unknown): value is BoardVisualMode {
  return value === "2d" || value === "3d";
}

export function defaultBoardVisualMode(prefersReducedMotion: boolean): BoardVisualMode {
  return prefersReducedMotion ? "2d" : "3d";
}

export function resolveBoardVisualMode({
  accountMode,
  storedMode,
  prefersReducedMotion,
}: {
  accountMode?: BoardVisualMode | null;
  storedMode?: string | null;
  prefersReducedMotion: boolean;
}): BoardVisualMode {
  if (accountMode) {
    return accountMode;
  }

  if (isBoardVisualMode(storedMode)) {
    return storedMode;
  }

  return defaultBoardVisualMode(prefersReducedMotion);
}

export function readLocalBoardVisualMode(storage: StorageLike | undefined = browserStorage()) {
  if (!storage) {
    return null;
  }

  return storage.getItem(BOARD_VISUAL_MODE_STORAGE_KEY);
}

export function saveLocalBoardVisualMode(
  mode: BoardVisualMode,
  storage: StorageLike | undefined = browserStorage(),
) {
  storage?.setItem(BOARD_VISUAL_MODE_STORAGE_KEY, mode);
}

export function browserPrefersReducedMotion() {
  return Boolean(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}

export function effectiveBoardVisualMode(currentUser: AuthUser | null): BoardVisualMode {
  return resolveBoardVisualMode({
    accountMode: currentUser?.boardVisualMode,
    storedMode: readLocalBoardVisualMode(),
    prefersReducedMotion: browserPrefersReducedMotion(),
  });
}

function browserStorage() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}
