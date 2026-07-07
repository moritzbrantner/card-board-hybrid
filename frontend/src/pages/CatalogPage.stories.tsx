import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { catalogCards } from "../components/board.fixtures";
import { withMockApi } from "../storybook/fixtures";
import { CatalogCardButton, CatalogDetail, CatalogPage, SegmentedFilter } from "./CatalogPage";

const meta = {
  title: "Pages/CatalogPage",
  component: CatalogPage,
  decorators: [withMockApi()],
  args: {
    onNavigate: fn(),
  },
} satisfies Meta<typeof CatalogPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const SegmentedFilterStory: StoryObj = {
  name: "SegmentedFilter",
  render: () => (
    <main className="app-shell catalog-shell">
      <section className="catalog-controls">
        <SegmentedFilter
          label="Kind"
          value="unit"
          options={[
            ["all", "All"],
            ["unit", "Units"],
            ["spell", "Spells"],
          ]}
          onChange={fn()}
        />
      </section>
    </main>
  ),
};

export const CatalogCardButtonStory: StoryObj = {
  name: "CatalogCardButton",
  render: () => (
    <main className="app-shell catalog-shell">
      <section className="catalog-grid">
        <CatalogCardButton card={catalogCards[0]} selected onClick={fn()} />
        <CatalogCardButton card={catalogCards[1]} selected={false} onClick={fn()} />
      </section>
    </main>
  ),
};

export const CatalogDetailStory: StoryObj = {
  name: "CatalogDetail",
  render: () => (
    <main className="app-shell catalog-shell">
      <CatalogDetail card={catalogCards[0]} />
    </main>
  ),
};
