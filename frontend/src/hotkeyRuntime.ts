import {
  HOTKEY_COMMANDS,
  keyEventToHotkeyBinding,
  normalizeHotkeysWithDefaults,
} from "./hotkeys";
import type { HotkeyBinding, HotkeyCommandId } from "./types";

export type HotkeyRuntimeEvent = Pick<
  KeyboardEvent,
  "key" | "target" | "defaultPrevented" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault"
>;

export type HotkeyHandlers = Partial<Record<HotkeyCommandId, () => boolean>>;

export function dispatchHotkeyEvent(
  event: HotkeyRuntimeEvent,
  hotkeys: HotkeyBinding[],
  handlers: HotkeyHandlers,
) {
  const commandId = hotkeyCommandForEvent(event, hotkeys);
  if (!commandId) {
    return false;
  }

  const handler = handlers[commandId];
  if (!handler?.()) {
    return false;
  }

  event.preventDefault();
  return true;
}

export function hotkeyCommandForEvent(
  event: Omit<HotkeyRuntimeEvent, "preventDefault">,
  hotkeys: HotkeyBinding[],
): HotkeyCommandId | null {
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isEditableHotkeyTarget(event.target)
  ) {
    return null;
  }

  const binding = keyEventToHotkeyBinding(event);
  if (!binding) {
    return null;
  }

  const bindingsByCommand = normalizeHotkeysWithDefaults(hotkeys);
  const normalizedBinding = binding.toLowerCase();
  return (
    HOTKEY_COMMANDS.find((command) => {
      const saved = bindingsByCommand.find((hotkey) => hotkey.commandId === command.id);
      return saved?.binding.toLowerCase() === normalizedBinding;
    })?.id ?? null
  );
}

export function isEditableHotkeyTarget(target: EventTarget | null): boolean {
  if (!target || !isElementLike(target)) {
    return false;
  }

  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (["input", "select", "textarea"].includes(tagName)) {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  const closestEditable = target.closest?.("[contenteditable=true]");
  return Boolean(closestEditable);
}

function isElementLike(value: EventTarget): value is EventTarget & {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | null;
} {
  return typeof value === "object" && value !== null;
}
