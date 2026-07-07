import type { Meta, StoryObj } from "@storybook/react-vite";
import { HeroPreview3D } from "./HeroPreview3D";

const meta = {
  title: "Components/HeroPreview3D",
  component: HeroPreview3D,
  args: {
    heroType: "runekeeper",
    label: "Runekeeper preview",
  },
} satisfies Meta<typeof HeroPreview3D>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Runekeeper: Story = {};

export const Pyromancer: Story = {
  args: {
    heroType: "pyromancer",
    label: "Pyromancer preview",
  },
};
