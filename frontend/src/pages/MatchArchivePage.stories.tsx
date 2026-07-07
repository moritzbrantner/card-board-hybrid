import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { storyAccount, withMockApi } from "../storybook/fixtures";
import { MatchArchivePage } from "./MatchArchivePage";

const meta = {
  title: "Pages/MatchArchivePage",
  component: MatchArchivePage,
  decorators: [withMockApi()],
  args: {
    currentUser: storyAccount,
    onNavigate: fn(),
    onSignOut: fn(),
  },
} satisfies Meta<typeof MatchArchivePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
