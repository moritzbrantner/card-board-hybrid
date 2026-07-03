import { describe, expect, it, vi } from "vitest";
import {
  dispatchHotkeyEvent,
  hotkeyCommandForEvent,
  isEditableHotkeyTarget,
  type HotkeyRuntimeEvent,
} from "./hotkeyRuntime";
import type { HotkeyBinding } from "./types";

describe("hotkey runtime", () => {
  it("matches saved hotkeys and falls back to defaults for missing commands", () => {
    const hotkeys: HotkeyBinding[] = [{ commandId: "openCatalog", binding: "G" }];

    expect(hotkeyCommandForEvent(keyEvent("g"), hotkeys)).toBe("openCatalog");
    expect(hotkeyCommandForEvent(keyEvent("m"), hotkeys)).toBe("openMatchArchive");
  });

  it("ignores key events from editable controls", () => {
    const editableTargets = [
      { tagName: "INPUT" },
      { tagName: "SELECT" },
      { tagName: "TEXTAREA" },
      { tagName: "DIV", isContentEditable: true },
      { tagName: "SPAN", closest: vi.fn(() => ({ isContentEditable: true })) },
    ];

    for (const target of editableTargets) {
      expect(isEditableHotkeyTarget(fakeTarget(target))).toBe(true);
      expect(hotkeyCommandForEvent(keyEvent("c", { target: fakeTarget(target) }), [])).toBeNull();
    }
  });

  it("preserves browser modifier shortcuts", () => {
    expect(hotkeyCommandForEvent(keyEvent("c", { ctrlKey: true }), [])).toBeNull();
    expect(hotkeyCommandForEvent(keyEvent("c", { metaKey: true }), [])).toBeNull();
    expect(hotkeyCommandForEvent(keyEvent("c", { altKey: true }), [])).toBeNull();
  });

  it("dispatches only legal handled commands and prevents defaults after handling", () => {
    const preventDefault = vi.fn();
    const endTurn = vi.fn(() => false);
    const openCatalog = vi.fn(() => true);

    expect(
      dispatchHotkeyEvent(keyEvent("t", { preventDefault }), [], {
        endTurn,
        openCatalog,
      }),
    ).toBe(false);
    expect(endTurn).toHaveBeenCalledOnce();
    expect(preventDefault).not.toHaveBeenCalled();

    expect(
      dispatchHotkeyEvent(keyEvent("c", { preventDefault }), [], {
        endTurn,
        openCatalog,
      }),
    ).toBe(true);
    expect(openCatalog).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

function keyEvent(
  key: string,
  overrides: Partial<HotkeyRuntimeEvent> = {},
): HotkeyRuntimeEvent {
  return {
    key,
    target: null,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {},
    ...overrides,
  };
}

function fakeTarget(target: object): EventTarget {
  return target as EventTarget;
}
