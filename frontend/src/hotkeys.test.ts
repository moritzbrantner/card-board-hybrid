import { describe, expect, it } from "vitest";
import {
  defaultHotkeyMap,
  HOTKEY_COMMANDS,
  normalizeHotkeyBinding,
  normalizeHotkeysWithDefaults,
  normalizedHotkeySaveBindings,
  validateHotkeyMap,
} from "./hotkeys";

describe("hotkey command registry", () => {
  it("defines the configurable commands in backend order with PRD defaults", () => {
    expect(HOTKEY_COMMANDS.map((command) => [command.id, command.defaultBinding])).toEqual([
      ["cursorNorthwest", "Q"],
      ["cursorNortheast", "W"],
      ["cursorEast", "E"],
      ["cursorWest", "A"],
      ["cursorSouthwest", "S"],
      ["cursorSoutheast", "D"],
      ["confirm", "Enter"],
      ["cancel", "Escape"],
      ["endTurn", "T"],
      ["passPriority", "P"],
      ["openCardInfo", "I"],
      ["openSettings", ","],
      ["openCatalog", "C"],
      ["openDecks", "K"],
      ["openMatchArchive", "M"],
    ]);
  });

  it("normalizes stored hotkeys through safe defaults", () => {
    const hotkeys = normalizeHotkeysWithDefaults([
      { commandId: "endTurn", binding: " y " },
      { commandId: "confirm", binding: "enter" },
      { commandId: "cursorWest", binding: "Escape" },
      { commandId: "openCatalog", binding: "Enter" },
      { commandId: "unknown", binding: "Z" },
      { commandId: "openDecks", binding: "Shift+K" },
    ]);

    expect(hotkeys).toHaveLength(HOTKEY_COMMANDS.length);
    expect(hotkeys.find((hotkey) => hotkey.commandId === "endTurn")?.binding).toBe("Y");
    expect(hotkeys.find((hotkey) => hotkey.commandId === "confirm")?.binding).toBe("Enter");
    expect(hotkeys.find((hotkey) => hotkey.commandId === "cursorWest")?.binding).toBe("A");
    expect(hotkeys.find((hotkey) => hotkey.commandId === "openCatalog")?.binding).toBe("C");
    expect(hotkeys.find((hotkey) => hotkey.commandId === "openDecks")?.binding).toBe("K");
  });

  it("blocks duplicate bindings before save", () => {
    const hotkeys = {
      ...defaultHotkeyMap(),
      endTurn: "Y",
      passPriority: "y",
    };

    expect(validateHotkeyMap(hotkeys)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "passPriority",
          message: "Already used by End Turn.",
        }),
        expect.objectContaining({
          commandId: "endTurn",
          message: "Already used by Pass Priority.",
        }),
      ]),
    );
  });

  it("blocks unsafe reserved bindings and permits Escape only for cancel", () => {
    expect(validateHotkeyMap({ ...defaultHotkeyMap(), endTurn: "Escape" })).toContainEqual({
      commandId: "endTurn",
      message: "Escape is reserved for Cancel.",
    });
    expect(validateHotkeyMap({ ...defaultHotkeyMap(), cancel: "Escape" })).toEqual([]);
    expect(validateHotkeyMap({ ...defaultHotkeyMap(), openDecks: " " })).toContainEqual({
      commandId: "openDecks",
      message: "Space is reserved by the browser.",
    });
    expect(validateHotkeyMap({ ...defaultHotkeyMap(), openDecks: "Tab" })).toContainEqual({
      commandId: "openDecks",
      message: "Tab is reserved by the browser.",
    });
    expect(validateHotkeyMap({ ...defaultHotkeyMap(), openDecks: "Backspace" })).toContainEqual({
      commandId: "openDecks",
      message: "Backspace is reserved by the browser.",
    });
    expect(validateHotkeyMap({ ...defaultHotkeyMap(), openDecks: "Delete" })).toContainEqual({
      commandId: "openDecks",
      message: "Delete is reserved by the browser.",
    });
  });

  it("normalizes save bindings into backend-compatible values", () => {
    const hotkeys = {
      ...defaultHotkeyMap(),
      endTurn: "y",
      confirm: "enter",
      cancel: "esc",
    };

    expect(normalizeHotkeyBinding("Shift+Y")).toBeNull();
    expect(normalizedHotkeySaveBindings(hotkeys)).toEqual(
      expect.arrayContaining([
        { commandId: "endTurn", binding: "Y" },
        { commandId: "confirm", binding: "Enter" },
        { commandId: "cancel", binding: "Escape" },
      ]),
    );
  });
});
