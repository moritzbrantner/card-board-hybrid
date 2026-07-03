import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_PREFERENCES,
  accountPreferencesSavePayload,
  normalizeAccountPreferences,
  visualPreferencesCssAttributes,
  visualPreferencesLiveAiDelayMs,
} from "./preferences";

describe("account preference normalization", () => {
  it("merges backend visual preferences with safe hotkey defaults", () => {
    const preferences = normalizeAccountPreferences({
      theme: "highContrast",
      motion: "reduced",
      animationSpeed: "fast",
      boardScale: "large",
      hotkeys: [
        { commandId: "openSettings", binding: "," },
        { commandId: "endTurn", binding: "Y" },
      ],
      updatedAt: 12,
    });

    expect(preferences).toMatchObject({
      theme: "highContrast",
      motion: "reduced",
      animationSpeed: "fast",
      boardScale: "large",
      updatedAt: 12,
    });
    expect(preferences.hotkeys).toHaveLength(DEFAULT_ACCOUNT_PREFERENCES.hotkeys.length);
    expect(preferences.hotkeys.find((hotkey) => hotkey.commandId === "endTurn")?.binding).toBe(
      "Y",
    );
    expect(preferences.hotkeys.find((hotkey) => hotkey.commandId === "confirm")?.binding).toBe(
      "Enter",
    );
  });

  it("falls back to default visual values when a payload is partial or unknown", () => {
    expect(
      normalizeAccountPreferences({
        theme: "sepia",
        motion: "cinematic",
        animationSpeed: "instant",
        boardScale: "tiny",
        hotkeys: [],
      }),
    ).toMatchObject({
      theme: "system",
      motion: "system",
      animationSpeed: "normal",
      boardScale: "normal",
    });
  });

  it("builds a complete save payload that preserves hotkeys", () => {
    const payload = accountPreferencesSavePayload(
      normalizeAccountPreferences({
        ...DEFAULT_ACCOUNT_PREFERENCES,
        hotkeys: [{ commandId: "endTurn", binding: "Y" }],
      }),
      {
        theme: "dark",
        motion: "full",
        animationSpeed: "slow",
        boardScale: "compact",
      },
    );

    expect(payload).toMatchObject({
      theme: "dark",
      motion: "full",
      animationSpeed: "slow",
      boardScale: "compact",
    });
    expect(payload.hotkeys.find((hotkey) => hotkey.commandId === "endTurn")?.binding).toBe("Y");
    expect(payload.hotkeys).toHaveLength(DEFAULT_ACCOUNT_PREFERENCES.hotkeys.length);
  });

  it("resolves CSS attributes and AI frame delay from visual preferences", () => {
    expect(
      visualPreferencesCssAttributes(
        normalizeAccountPreferences({
          theme: "system",
          motion: "system",
          animationSpeed: "normal",
          boardScale: "normal",
          hotkeys: [],
        }),
        { prefersDarkTheme: true, prefersReducedMotion: true },
      ),
    ).toEqual({
      "data-theme": "dark",
      "data-motion": "reduced",
      "data-animation-speed": "normal",
      "data-board-scale": "normal",
    });

    expect(visualPreferencesLiveAiDelayMs("slow", "full")).toBeGreaterThan(
      visualPreferencesLiveAiDelayMs("fast", "full"),
    );
    expect(visualPreferencesLiveAiDelayMs("slow", "reduced")).toBe(0);
  });
});
