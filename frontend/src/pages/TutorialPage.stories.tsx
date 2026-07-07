import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { storyAccount, storyVisualPreferences } from "../storybook/fixtures";
import { TutorialPage } from "./TutorialPage";

const meta = {
  title: "Pages/TutorialPage",
  component: TutorialPage,
  args: {
    currentUser: storyAccount,
    onNavigate: fn(),
    onSignOut: fn(),
    allowSignOut: true,
    loginNextPath: "/tutorial",
    visualPreferences: storyVisualPreferences,
  },
} satisfies Meta<typeof TutorialPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Intro: Story = {};
