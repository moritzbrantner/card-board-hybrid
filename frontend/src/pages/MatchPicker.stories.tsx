import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { storyAccount, withMockApi } from "../storybook/fixtures";
import { PlayPage } from "./MatchPicker";

const meta = {
  title: "Pages/MatchPicker",
  component: PlayPage,
  decorators: [withMockApi()],
  args: {
    currentUser: storyAccount,
    onNavigate: fn(),
    onSignOut: fn(),
  },
} satisfies Meta<typeof PlayPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {};

export const SignedOut: Story = {
  args: {
    currentUser: null,
  },
};
