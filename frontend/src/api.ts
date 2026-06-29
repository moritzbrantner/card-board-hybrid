import type { ActionTarget, GameActionRequest, GameState, HexCoord } from "./types";

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

function gameAction(action: GameActionRequest) {
  return request<GameState>("/api/game/action", {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export function getGame() {
  return request<GameState>("/api/game");
}

export function newGame() {
  return request<GameState>("/api/game/new", { method: "POST" });
}

export function playCard(cardId: string, target: ActionTarget) {
  return gameAction({ type: "playCard", cardId, target });
}

export function movePiece(pieceId: string, to: HexCoord) {
  return gameAction({ type: "movePiece", pieceId, to });
}

export function attack(attackerId: string, targetId: string) {
  return gameAction({ type: "attack", attackerId, targetId });
}

export function endTurn() {
  return gameAction({ type: "endTurn" });
}
