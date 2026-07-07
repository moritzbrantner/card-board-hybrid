import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MatchEndOverlay } from "./MatchEndOverlay";

const meta = {
  title: "Components/MatchEndOverlay",
  component: MatchEndOverlay,
  args: {
    winner: "player",
    viewerSide: "player",
    onOpenSummary: fn(),
  },
} satisfies Meta<typeof MatchEndOverlay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Victory: Story = {};

export const Defeat: Story = {
  args: {
    winner: "opponent",
  },
};
