import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { storyAccount, withMockApi } from "../storybook/fixtures";
import { DeckLegalityPanel, DecksPage } from "./DecksPage";

const meta = {
  title: "Pages/DecksPage",
  component: DecksPage,
  decorators: [withMockApi()],
  args: {
    currentUser: storyAccount,
    onNavigate: fn(),
    onSignOut: fn(),
  },
} satisfies Meta<typeof DecksPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const DeckLegalityPanelStory: StoryObj = {
  name: "DeckLegalityPanel",
  render: () => (
    <main className="app-shell archive-shell">
      <DeckLegalityPanel
        legality={{
          legal: false,
          totalCards: 8,
          basicCards: 6,
          advancedCards: 2,
          rareCards: 0,
          messages: ["Deck needs at least 12 cards.", "Rare card limit is 1."],
        }}
      />
    </main>
  ),
};
