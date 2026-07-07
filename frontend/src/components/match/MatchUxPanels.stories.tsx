import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import {
  ActionPreviewPanel,
  ActionRecapCallout,
  ActionTray,
  AvailabilityReasonText,
  TurnChecklist,
} from "./MatchUxPanels";
import type { ActionAvailabilityReason, ActionPreview, ActionRecap, ActionTrayEntry, TurnChecklistItem } from "../../matchUxModel";

const blockedReason: ActionAvailabilityReason = {
  code: "insufficientMana",
  message: "You need 2 more mana to play this card.",
};

const preview: ActionPreview = {
  title: "Cast Spark Jolt",
  body: "Deal 2 damage to the selected target.",
  details: ["Range 3", "Priority 2"],
  tone: "attack",
};

const entries: ActionTrayEntry[] = [
  { id: "move", label: "Move", icon: "move", enabled: true, preview },
  { id: "attack", label: "Attack", icon: "attack", enabled: false, reason: blockedReason },
  { id: "info", label: "Inspect", icon: "info", enabled: true },
];

const checklist: TurnChecklistItem[] = [
  { id: "mana", label: "Mana", value: "4/6", status: "available" },
  { id: "attack", label: "Attack", value: "Spent", status: "spent" },
  { id: "priority", label: "Priority", value: "Waiting", status: "waiting" },
];

const recap: ActionRecap = {
  id: "recap-1",
  title: "Ember Squire attacked",
  details: ["Opponent hero took 2 damage."],
  tone: "attack",
};

const meta = {
  title: "Components/MatchUxPanels",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Panels: Story = {
  render: () => (
    <main className="app-shell match-app-shell">
      <div className="match-ux-dock">
        <ActionRecapCallout recap={recap} />
        <ActionPreviewPanel preview={preview} />
        <ActionPreviewPanel preview={null} reason={blockedReason} />
        <ActionTray entries={entries} onBlockedEntry={fn()} />
        <AvailabilityReasonText reason={blockedReason} />
      </div>
      <TurnChecklist items={checklist} />
    </main>
  ),
};
