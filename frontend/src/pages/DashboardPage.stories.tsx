import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { storyAccount, withMockApi } from "../storybook/fixtures";
import { DashboardPage } from "./DashboardPage";

const meta = {
  title: "Pages/DashboardPage",
  component: DashboardPage,
  decorators: [withMockApi()],
  args: {
    currentUser: storyAccount,
    onNavigate: fn(),
    onSignOut: fn(),
  },
} satisfies Meta<typeof DashboardPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {};

export const SignedOut: Story = {
  args: {
    currentUser: null,
  },
};
