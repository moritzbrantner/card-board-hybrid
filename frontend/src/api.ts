import type { GameState } from "./types";

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

export function getGame() {
  return request<GameState>("/api/game");
}

export function newGame() {
  return request<GameState>("/api/game/new", { method: "POST" });
}

export function playCard(cardId: string, lane: number) {
  return request<GameState>("/api/game/action", {
    method: "POST",
    body: JSON.stringify({ cardId, lane }),
  });
}

export function resolveTurn() {
  return request<GameState>("/api/game/resolve", { method: "POST" });
}

