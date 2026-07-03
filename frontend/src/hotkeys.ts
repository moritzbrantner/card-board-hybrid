import type { HotkeyBinding, HotkeyCommandId } from "./types";

export type HotkeyCommand = {
  id: HotkeyCommandId;
  label: string;
  defaultBinding: string;
};

export type HotkeyValidationIssue = {
  commandId: HotkeyCommandId;
  message: string;
};

export const HOTKEY_COMMANDS: HotkeyCommand[] = [
  { id: "cursorNorthwest", label: "Cursor northwest", defaultBinding: "Q" },
  { id: "cursorNortheast", label: "Cursor northeast", defaultBinding: "W" },
  { id: "cursorEast", label: "Cursor east", defaultBinding: "E" },
  { id: "cursorWest", label: "Cursor west", defaultBinding: "A" },
  { id: "cursorSouthwest", label: "Cursor southwest", defaultBinding: "S" },
  { id: "cursorSoutheast", label: "Cursor southeast", defaultBinding: "D" },
  { id: "confirm", label: "Confirm", defaultBinding: "Enter" },
  { id: "cancel", label: "Cancel", defaultBinding: "Escape" },
  { id: "endTurn", label: "End Turn", defaultBinding: "T" },
  { id: "passPriority", label: "Pass Priority", defaultBinding: "P" },
  { id: "openCardInfo", label: "Open Card Info", defaultBinding: "I" },
  { id: "openSettings", label: "Open Settings", defaultBinding: "," },
  { id: "openCatalog", label: "Open Catalog", defaultBinding: "C" },
  { id: "openDecks", label: "Open Decks", defaultBinding: "K" },
  { id: "openMatchArchive", label: "Open Match Archive", defaultBinding: "M" },
];

const HOTKEY_COMMAND_IDS = new Set(HOTKEY_COMMANDS.map((command) => command.id));

export const DEFAULT_HOTKEYS: HotkeyBinding[] = HOTKEY_COMMANDS.map((command) => ({
  commandId: command.id,
  binding: command.defaultBinding,
}));

export function defaultHotkeyMap(): Record<HotkeyCommandId, string> {
  return hotkeyBindingsToMap(DEFAULT_HOTKEYS);
}

export function normalizeHotkeyBinding(binding: string): string | null {
  if (binding === " ") {
    return " ";
  }

  const trimmed = binding.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  switch (trimmed.toLowerCase()) {
    case "enter":
      return "Enter";
    case "escape":
    case "esc":
      return "Escape";
    case "tab":
      return "Tab";
    case "backspace":
      return "Backspace";
    case "delete":
      return "Delete";
    default:
      return [...trimmed].length === 1 ? trimmed.toUpperCase() : null;
  }
}

export function keyEventToHotkeyBinding(event: Pick<KeyboardEvent, "key">): string | null {
  if (event.key === " ") {
    return " ";
  }
  return normalizeHotkeyBinding(event.key);
}

export function hotkeyBindingsToMap(
  hotkeys: HotkeyBinding[],
): Record<HotkeyCommandId, string> {
  const incomingByCommand = new Map(
    hotkeys
      .filter((hotkey): hotkey is { commandId: HotkeyCommandId; binding: string } =>
        isHotkeyCommandId(hotkey.commandId),
      )
      .map((hotkey) => [hotkey.commandId, hotkey.binding]),
  );

  return Object.fromEntries(
    HOTKEY_COMMANDS.map((command) => [
      command.id,
      incomingByCommand.get(command.id) ?? command.defaultBinding,
    ]),
  ) as Record<HotkeyCommandId, string>;
}

export function hotkeyMapToBindings(
  hotkeys: Record<HotkeyCommandId, string>,
): HotkeyBinding[] {
  return HOTKEY_COMMANDS.map((command) => ({
    commandId: command.id,
    binding: hotkeys[command.id],
  }));
}

export function normalizeHotkeysWithDefaults(value: unknown): HotkeyBinding[] {
  const incoming = Array.isArray(value) ? value.filter(isHotkeyBinding) : [];
  const defaultBindingOwners = new Map(
    HOTKEY_COMMANDS.map((command) => [command.defaultBinding.toLowerCase(), command.id]),
  );
  const seenBindings = new Set<string>();
  const accepted = new Map<HotkeyCommandId, string>();

  for (const hotkey of incoming) {
    if (!isHotkeyCommandId(hotkey.commandId)) {
      continue;
    }

    const binding = normalizeHotkeyBinding(hotkey.binding);
    if (!binding || !bindingIsSafeForCommand(hotkey.commandId, binding)) {
      continue;
    }

    const normalizedBinding = binding.toLowerCase();
    const defaultOwner = defaultBindingOwners.get(normalizedBinding);
    if (defaultOwner && defaultOwner !== hotkey.commandId) {
      continue;
    }

    if (seenBindings.has(normalizedBinding)) {
      continue;
    }

    seenBindings.add(normalizedBinding);
    accepted.set(hotkey.commandId, binding);
  }

  return HOTKEY_COMMANDS.map((command) => ({
    commandId: command.id,
    binding: accepted.get(command.id) ?? command.defaultBinding,
  }));
}

export function validateHotkeyMap(
  hotkeys: Record<HotkeyCommandId, string>,
): HotkeyValidationIssue[] {
  const issues: HotkeyValidationIssue[] = [];
  const bindingOwners = new Map<string, HotkeyCommandId>();

  for (const command of HOTKEY_COMMANDS) {
    const binding = normalizeHotkeyBinding(hotkeys[command.id]);

    if (!binding) {
      issues.push({
        commandId: command.id,
        message: "Press a single key.",
      });
      continue;
    }

    if (!bindingIsSafeForCommand(command.id, binding)) {
      issues.push({
        commandId: command.id,
        message: reservedBindingMessage(command.id, binding),
      });
      continue;
    }

    const normalizedBinding = binding.toLowerCase();
    const owner = bindingOwners.get(normalizedBinding);
    if (owner) {
      issues.push({
        commandId: command.id,
        message: `Already used by ${hotkeyCommandLabel(owner)}.`,
      });
      issues.push({
        commandId: owner,
        message: `Already used by ${command.label}.`,
      });
      continue;
    }

    bindingOwners.set(normalizedBinding, command.id);
  }

  return issues;
}

export function hotkeyValidationIssuesByCommand(
  issues: HotkeyValidationIssue[],
): Partial<Record<HotkeyCommandId, string>> {
  const byCommand: Partial<Record<HotkeyCommandId, string>> = {};
  for (const issue of issues) {
    byCommand[issue.commandId] ??= issue.message;
  }
  return byCommand;
}

export function normalizedHotkeySaveBindings(
  hotkeys: Record<HotkeyCommandId, string>,
): HotkeyBinding[] {
  return HOTKEY_COMMANDS.map((command) => ({
    commandId: command.id,
    binding: normalizeHotkeyBinding(hotkeys[command.id]) ?? command.defaultBinding,
  }));
}

export function hotkeyCommandLabel(commandId: HotkeyCommandId): string {
  return HOTKEY_COMMANDS.find((command) => command.id === commandId)?.label ?? commandId;
}

export function isHotkeyCommandId(value: string): value is HotkeyCommandId {
  return HOTKEY_COMMAND_IDS.has(value as HotkeyCommandId);
}

function bindingIsSafeForCommand(commandId: HotkeyCommandId, binding: string) {
  if (binding === "Escape") {
    return commandId === "cancel";
  }
  if (binding === "Enter") {
    return commandId === "confirm";
  }
  return !["Tab", "Backspace", "Delete", " "].includes(binding);
}

function reservedBindingMessage(commandId: HotkeyCommandId, binding: string) {
  if (binding === "Escape") {
    return commandId === "cancel" ? "" : "Escape is reserved for Cancel.";
  }
  if (binding === "Enter") {
    return commandId === "confirm" ? "" : "Enter is reserved for Confirm.";
  }
  return `${formatBinding(binding)} is reserved by the browser.`;
}

function formatBinding(binding: string) {
  return binding === " " ? "Space" : binding;
}

function isHotkeyBinding(value: unknown): value is HotkeyBinding {
  return (
    isRecord(value) &&
    typeof value.commandId === "string" &&
    typeof value.binding === "string" &&
    value.commandId.length > 0 &&
    value.binding.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
