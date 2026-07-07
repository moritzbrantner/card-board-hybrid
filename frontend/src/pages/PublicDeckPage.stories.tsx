import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { storyAccount, withMockApi } from "../storybook/fixtures";
import { PublicDeckPage } from "./PublicDeckPage";

const meta = {
  title: "Pages/PublicDeckPage",
  component: PublicDeckPage,
  decorators: [withMockApi()],
  args: {
    handle: "player-one",
    deckId: 1,
    currentUser: storyAccount,
    onNavigate: fn(),
    onSignOut: fn(),
  },
} satisfies Meta<typeof PublicDeckPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
