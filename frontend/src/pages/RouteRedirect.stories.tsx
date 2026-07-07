import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RouteRedirect } from "./RouteRedirect";

const meta = {
  title: "Pages/RouteRedirect",
  component: RouteRedirect,
  args: {
    to: "/",
    onNavigate: fn(),
  },
} satisfies Meta<typeof RouteRedirect>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Redirecting: Story = {};
