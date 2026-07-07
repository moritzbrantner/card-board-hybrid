import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { storyAccount, storyVisualPreferences, withMockApi } from "../storybook/fixtures";
import { ReplayPage } from "./ReplayPage";

const meta = {
  title: "Pages/ReplayPage",
  component: ReplayPage,
  decorators: [withMockApi()],
  args: {
    matchId: "rl-story",
    currentUser: storyAccount,
    onNavigate: fn(),
    onSignOut: fn(),
    allowSignOut: true,
    loginNextPath: "/matches/rl-story/replay",
    visualPreferences: storyVisualPreferences,
  },
} satisfies Meta<typeof ReplayPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
