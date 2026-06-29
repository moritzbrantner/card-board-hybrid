import type {
  ActionTarget,
  MatchActionRequest,
  MatchResponse,
  MatchState,
  HexCoord,
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

function matchAction(action: MatchActionRequest) {
  return request<MatchState>("/api/match/action", {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export function getMatch() {
  return request<MatchState>("/api/match");
}

export function newMatch() {
  return request<MatchState>("/api/match/new", { method: "POST" });
}

export function createMatch() {
  return request<MatchResponse>("/api/matches", { method: "POST" });
}

export function loadMatch(matchId: string) {
  return request<MatchResponse>(`/api/matches/${encodeURIComponent(matchId)}`);
}

export function playCard(cardId: string, target: ActionTarget) {
  return matchAction({ type: "playCard", cardId, target });
}

export function movePiece(pieceId: string, to: HexCoord) {
  return matchAction({ type: "movePiece", pieceId, to });
}

export function attack(attackerId: string, targetId: string) {
  return matchAction({ type: "attack", attackerId, targetId });
}

export function endTurn() {
  return matchAction({ type: "endTurn" });
}
