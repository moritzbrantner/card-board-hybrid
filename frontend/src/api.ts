import type {
  ActionTarget,
  AuthSessionResponse,
  AuthUser,
  CatalogResponse,
  CreateSharedMatchResponse,
  DeckCardCount,
  DeckLegality,
  DeckListResponse,
  DeckRecipeDetail,
  DeckRecipeSummary,
  MatchArchiveResponse,
  MatchActionRequest,
  MatchReplayResponse,
  MatchResponse,
  MatchState,
  SoloAiOpponentSelection,
  SharedMatchResponse,
  SystemDeckListResponse,
  HexCoord,
  WizardType,
  AccountProfile,
  GeneratedAvatar,
} from "./types";
import { clearAuthToken, getAuthToken } from "./session";

type ApiError = {
  message?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();
    }
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new Error(body.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function registerAccount(email: string, password: string) {
  return request<AuthSessionResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function loginAccount(email: string, password: string) {
  return request<AuthSessionResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function loadCurrentAccount() {
  return request<AuthUser>("/api/auth/me");
}

export function loadProfile() {
  return request<AccountProfile>("/api/profile");
}

export function updateProfile(
  displayName: string,
  avatar: GeneratedAvatar,
  preferredWizardType: WizardType,
) {
  return request<AccountProfile>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ displayName, avatar, preferredWizardType }),
  });
}

export function loadProfileMatches() {
  return request<MatchArchiveResponse>("/api/profile/matches");
}

export function loadDecks() {
  return request<DeckListResponse>("/api/decks");
}

export function loadDeck(deckId: number) {
  return request<DeckRecipeDetail>(`/api/decks/${encodeURIComponent(deckId)}`);
}

export function createDeck(name: string, cards: DeckCardCount[], isDefault = false) {
  return request<DeckRecipeSummary>("/api/decks", {
    method: "POST",
    body: JSON.stringify({ name, cards, isDefault }),
  });
}

export function updateDeck(
  deckId: number,
  name: string,
  cards: DeckCardCount[],
  isDefault = false,
) {
  return request<DeckRecipeSummary>(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name, cards, isDefault }),
  });
}

export function previewDeckLegality(cards: DeckCardCount[]) {
  return request<DeckLegality>("/api/decks/legality-preview", {
    method: "POST",
    body: JSON.stringify({ cards }),
  });
}

export function duplicateDeck(deckId: number) {
  return request<DeckRecipeSummary>(`/api/decks/${encodeURIComponent(deckId)}/duplicate`, {
    method: "POST",
  });
}

export function deleteDeck(deckId: number) {
  return request<{ message: string }>(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: "DELETE",
  });
}

export function loadSystemDecks() {
  return request<SystemDeckListResponse>("/api/system-decks");
}

export function logoutAccount() {
  return request<{ message: string }>("/api/auth/logout", {
    method: "POST",
  });
}

function matchAction(matchId: string, action: MatchActionRequest) {
  return request<MatchResponse>(`/api/matches/${encodeURIComponent(matchId)}/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  }).then((response) => response.matchState);
}

export function createMatch(options?: {
  wizardType?: WizardType;
  playerDeckId?: number;
  aiOpponent?: SoloAiOpponentSelection;
}) {
  return request<MatchResponse>("/api/matches", {
    method: "POST",
    body: options ? JSON.stringify(options) : undefined,
  });
}

export function createSharedMatch(wizardType: WizardType) {
  return request<CreateSharedMatchResponse>("/api/shared-matches", {
    method: "POST",
    body: JSON.stringify({ wizardType }),
  });
}

export function loadSharedMatch(matchId: string, seatToken: string) {
  return request<SharedMatchResponse>(
    `/api/shared-matches/${encodeURIComponent(matchId)}/seats/${encodeURIComponent(seatToken)}`,
  );
}

export function joinSharedMatch(
  matchId: string,
  seatToken: string,
  wizardType: WizardType,
  deckRecipeId?: number,
) {
  return request<SharedMatchResponse>(
    `/api/shared-matches/${encodeURIComponent(matchId)}/seats/${encodeURIComponent(seatToken)}/join`,
    {
      method: "POST",
      body: JSON.stringify({ wizardType, deckRecipeId }),
    },
  );
}

export function sharedMatchWebSocketUrl(matchId: string, seatToken: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/shared-matches/${encodeURIComponent(
    matchId,
  )}/seats/${encodeURIComponent(seatToken)}/ws`;
}

export function loadMatch(matchId: string) {
  return request<MatchResponse>(`/api/matches/${encodeURIComponent(matchId)}`);
}

export function loadMatches() {
  return request<MatchArchiveResponse>("/api/matches");
}

export function loadReplay(matchId: string) {
  return request<MatchReplayResponse>(`/api/matches/${encodeURIComponent(matchId)}/replay`);
}

export function loadCatalog() {
  return request<CatalogResponse>("/api/catalog/cards");
}

export function playCard(matchId: string, cardId: string, target: ActionTarget) {
  return matchAction(matchId, { type: "playCard", cardId, target });
}

export function movePiece(matchId: string, pieceId: string, to: HexCoord) {
  return matchAction(matchId, { type: "movePiece", pieceId, to });
}

export function attack(matchId: string, attackerId: string, targetId: string) {
  return matchAction(matchId, { type: "attack", attackerId, targetId });
}

export function endTurn(matchId: string) {
  return matchAction(matchId, { type: "endTurn" });
}

export function passPriority(matchId: string) {
  return matchAction(matchId, { type: "passPriority" });
}
