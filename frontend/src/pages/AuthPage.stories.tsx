import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AuthPage } from "./AuthPage";

const meta = {
  title: "Pages/AuthPage",
  component: AuthPage,
  args: {
    mode: "login",
    nextPath: "/play",
    onNavigate: fn(),
    onAuthenticated: fn(),
  },
} satisfies Meta<typeof AuthPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Login: Story = {};

export const Register: Story = {
  args: {
    mode: "register",
  },
};
