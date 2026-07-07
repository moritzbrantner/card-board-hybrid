import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiScenePanel } from "./WikiScenePanel";
import { WIKI_SCENES } from "./wikiScenes";

const meta = {
  title: "Components/WikiScenePanel",
  component: WikiScenePanel,
  args: {
    scene: WIKI_SCENES[0],
  },
} satisfies Meta<typeof WikiScenePanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const BoardScene: Story = {};

export const DeckRulesScene: Story = {
  args: {
    scene: WIKI_SCENES.find((scene) => scene.type === "deckRules") ?? WIKI_SCENES[0],
  },
};
