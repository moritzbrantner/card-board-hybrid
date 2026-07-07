import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { storyAccount, withMockApi } from "../storybook/fixtures";
import { ProfilePage } from "../profile";

const meta = {
  title: "Pages/ProfilePage",
  component: ProfilePage,
  decorators: [withMockApi()],
  args: {
    currentUser: storyAccount,
    onNavigate: fn(),
    onProfileUpdated: fn(),
    onSignOut: fn(),
  },
} satisfies Meta<typeof ProfilePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
