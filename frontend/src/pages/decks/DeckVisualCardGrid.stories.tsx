import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeckVisualCardGrid } from "./DeckVisualCardGrid";
import { catalogCards } from "../../components/board.fixtures";

const meta = {
  title: "Components/DeckVisualCardGrid",
  component: DeckVisualCardGrid,
  args: {
    cards: catalogCards.slice(0, 8).map((card, index) => ({
      card,
      count: index % 2 === 0 ? 2 : 1,
      copyLimit: 3,
      kindLabel: card.kind.type,
      kindDetail: card.text,
    })),
  },
} satisfies Meta<typeof DeckVisualCardGrid>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Grid: Story = {};
