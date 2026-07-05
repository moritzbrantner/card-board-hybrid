import type { EffectiveMotion } from "./preferences";
import type { SettingsState } from "./settings";
import type {
  AccountPreferences,
  AuthUser,
  CatalogCard,
  DeckListResponse,
  MatchReplayResponse,
  MatchSummaryResponse,
  MatchState,
  MatchSummary,
  ProgressionResponse,
  SharedMatchResponse,
  SystemDeckListResponse,
  Unit,
  Hero,
} from "./types";

export type LoadState =
  | { status: "loading" }
  | { status: "ready"; match: MatchState }
  | { status: "error"; message: string };

export type CatalogLoadState =
  | { status: "loading" }
  | { status: "ready"; cards: CatalogCard[] }
  | { status: "error"; message: string };

export type DeckLoadState =
  | { status: "loading" }
  | { status: "ready"; response: DeckListResponse }
  | { status: "error"; message: string };

export type SystemDeckLoadState =
  | { status: "loading" }
  | { status: "ready"; response: SystemDeckListResponse }
  | { status: "error"; message: string };

export type MatchArchiveLoadState =
  | { status: "loading" }
  | { status: "ready"; matches: MatchSummary[] }
  | { status: "error"; message: string };

export type ReplayLoadState =
  | { status: "loading" }
  | { status: "ready"; replay: MatchReplayResponse }
  | { status: "error"; message: string };

export type MatchSummaryLoadState =
  | { status: "loading" }
  | { status: "ready"; response: MatchSummaryResponse }
  | { status: "error"; message: string };

export type SharedLoadState =
  | { status: "loading" }
  | { status: "ready"; shared: SharedMatchResponse }
  | { status: "error"; message: string };

export type ProgressionLoadState =
  | { status: "loading" }
  | { status: "ready"; progression: ProgressionResponse }
  | { status: "error"; message: string };

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: AuthUser };

export type Selection =
  | { type: "card"; cardId: string }
  | { type: "piece"; pieceId: string }
  | null;

export type UnitContextMenu =
  | {
      pieceId: string;
      x: number;
      y: number;
    }
  | null;

export type BoardHero = Hero & { pieceType: "hero"; name: string };
export type BoardUnit = Unit & { pieceType: "unit"; hp?: never; maxHp?: never };
export type BoardPiece = BoardHero | BoardUnit;

export type AccountProps = {
  currentUser: AuthUser | null;
  onSignOut: () => void;
  onNavigate: (to: string) => void;
  allowSignOut?: boolean;
  loginNextPath?: string;
  activeAccountRoute?: "profile" | "settings" | null;
};

export type AppliedVisualPreferences = {
  preferences: AccountPreferences;
  effectiveMotion: EffectiveMotion;
  liveAiDelayMs: number;
};

export type AccountPreferenceProps = AccountProps & {
  visualPreferences: AppliedVisualPreferences;
};

export type AccountPreferencesState = {
  state: SettingsState;
  loadedUserId: number | null;
};
