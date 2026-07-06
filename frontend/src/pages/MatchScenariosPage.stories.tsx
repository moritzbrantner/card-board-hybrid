import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { MatchScenariosView } from "./MatchScenariosPage";
import type { MatchScenarioSummary } from "../types";

const scenarios: MatchScenarioSummary[] = [
  {
    id: "play-unit-card",
    name: "Play Unit Card",
    description: "Start with an affordable unit card and an adjacent empty hex.",
    primaryActions: ["playCard"],
  },
  {
    id: "priority-response",
    name: "Priority Response",
    description: "Start with an opponent stack item and player priority.",
    primaryActions: ["playCard", "passPriority", "advanceAi"],
  },
];

const meta = {
  title: "Pages/MatchScenariosPage",
  component: MatchScenariosView,
  args: {
    currentUser: null,
    loadState: { status: "ready", scenarios },
    busyScenarioId: null,
    notice: null,
    onNavigate: fn(),
    onSignOut: fn(),
    onLoadScenario: fn(),
  },
} satisfies Meta<typeof MatchScenariosView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Match Scenarios" })).toBeInTheDocument();
    await userEvent.click(canvas.getAllByRole("button", { name: "Load Scenario" })[0]);
    await expect(args.onLoadScenario).toHaveBeenCalledWith(scenarios[0]);
  },
};

export const Loading: Story = {
  args: {
    loadState: { status: "loading" },
  },
};

export const Error: Story = {
  args: {
    loadState: { status: "error", message: "Could not load match scenarios" },
  },
};

export const Busy: Story = {
  args: {
    busyScenarioId: "priority-response",
  },
};

export const WithNotice: Story = {
  args: {
    notice: "Could not load match scenario",
  },
};
