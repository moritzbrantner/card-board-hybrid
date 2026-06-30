import type {
  ActionTarget,
  CatalogResponse,
  CreateSharedMatchResponse,
  MatchArchiveResponse,
  MatchActionRequest,
  MatchReplayResponse,
  MatchResponse,
  MatchState,
  SharedMatchResponse,
  HexCoord,
  WizardType,
} from "./types";

type ApiError = {
  message?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new Error(body.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function matchAction(matchId: string, action: MatchActionRequest) {
  return request<MatchResponse>(`/api/matches/${encodeURIComponent(matchId)}/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  }).then((response) => response.matchState);
}

export function createMatch(wizardType?: WizardType) {
  return request<MatchResponse>("/api/matches", {
    method: "POST",
    body: wizardType ? JSON.stringify({ wizardType }) : undefined,
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

export function joinSharedMatch(matchId: string, seatToken: string, wizardType: WizardType) {
  return request<SharedMatchResponse>(
    `/api/shared-matches/${encodeURIComponent(matchId)}/seats/${encodeURIComponent(seatToken)}/join`,
    {
      method: "POST",
      body: JSON.stringify({ wizardType }),
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
