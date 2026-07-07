import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SettingsPage } from "../settings";
import { storyAccount, storyPreferences } from "../storybook/fixtures";

const meta = {
  title: "Pages/SettingsPage",
  component: SettingsPage,
  args: {
    preferencesState: { status: "ready", preferences: storyPreferences },
    currentUser: storyAccount,
    onNavigate: fn(),
    onSave: fn(async () => undefined),
    onRefresh: fn(async () => undefined),
    onSignOut: fn(),
  },
} satisfies Meta<typeof SettingsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const LocalPreferences: Story = {
  args: {
    currentUser: null,
  },
};
