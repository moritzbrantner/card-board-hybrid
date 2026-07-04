import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, Layers } from "lucide-react";
import { Board, CardButton, PileDisplay, PlayerBadge, StackDisplay } from "./board";
import {
  catalogCards,
  emberFlaskCard,
  emberSquireCard,
  pendingAttackStack,
  sparkJoltCard,
  storyMatch,
  storyUnit,
} from "./board.fixtures";
import { pieceById } from "../matchBoardHelpers";
import { createMatchVisualCatalog } from "../matchVisualIdentity";

const visualCatalog = createMatchVisualCatalog(catalogCards);
const selectedUnitMatch = storyMatch({
  units: [
    storyUnit({ q: 0, r: 0 }),
    storyUnit(
      { q: 1, r: 0 },
      {
        id: "story-opponent-unit",
        side: "opponent",
        name: "Ember Squire",
        templateId: "ember-squire",
        armor: 2,
        maxArmor: 2,
        maxAp: 2,
        apRemaining: 2,
      },
    ),
  ],
});

const proceduralMiniaturesMatch = storyMatch({
  units: [
    storyUnit({ q: -1, r: 1 }, {
      id: "story-ash-hound",
      name: "Ash Hound",
      templateId: "ash-hound",
      attack: 2,
      armor: 1,
      maxArmor: 1,
      apRemaining: 3,
      maxAp: 3,
    }),
    storyUnit({ q: 0, r: 0 }, {
      id: "story-stoneguard",
      name: "Stoneguard",
      templateId: "stoneguard",
      attack: 1,
      armor: 4,
      maxArmor: 4,
    }),
    storyUnit({ q: 1, r: -1 }, {
      id: "story-flame-weaver",
      side: "opponent",
      name: "Flame Weaver",
      templateId: "flame-weaver",
      attack: 3,
      armor: 2,
      maxArmor: 2,
    }),
    storyUnit({ q: 1, r: 0 }, {
      id: "story-vanguard-golem",
      side: "opponent",
      name: "Vanguard Golem",
      templateId: "vanguard-golem",
      attack: 2,
      armor: 5,
      maxArmor: 5,
    }),
  ],
});

const meta = {
  title: "Board/Board",
  component: Board,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    match: storyMatch(),
    boardVisualMode: "2d",
    viewerSide: "player",
    visualCatalog,
    selectedCard: null,
    selectedPiece: null,
    disabled: false,
  },
} satisfies Meta<typeof Board>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OpeningBoard: Story = {};

export const SelectedCardTargets: Story = {
  args: {
    match: storyMatch({ hand: [emberSquireCard] }),
    selectedCard: emberSquireCard,
  },
};

export const SelectedUnitActions: Story = {
  args: {
    match: selectedUnitMatch,
    selectedPiece: pieceById(selectedUnitMatch, "story-player-unit"),
  },
};

export const PendingPriority: Story = {
  args: {
    match: storyMatch({
      actionStack: [pendingAttackStack],
      prioritySide: "player",
    }),
  },
};

export const ThreeDProceduralMiniatures: Story = {
  args: {
    match: proceduralMiniaturesMatch,
    boardVisualMode: "3d",
  },
};

export const CardButtonStates: StoryObj = {
  render: () => (
    <main className="app-shell">
      <section className="hand" aria-label="Story hand">
        <CardButton
          card={emberSquireCard}
          visualIdentity={visualCatalog.card(emberSquireCard)}
          selected={false}
          disabled={false}
          onClick={() => undefined}
        />
        <CardButton
          card={sparkJoltCard}
          visualIdentity={visualCatalog.card(sparkJoltCard)}
          selected
          disabled={false}
          onClick={() => undefined}
        />
        <CardButton
          card={emberFlaskCard}
          visualIdentity={visualCatalog.card(emberFlaskCard)}
          selected={false}
          played
          disabled
          onClick={() => undefined}
        />
      </section>
    </main>
  ),
};

export const StackAndPiles: StoryObj = {
  render: () => {
    const match = storyMatch({ actionStack: [pendingAttackStack], prioritySide: "player" });
    return (
      <main className="app-shell">
        <section className="player-zone">
          <PlayerBadge player={match.player} />
          <StackDisplay stack={match.actionStack} prioritySide={match.prioritySide} />
          <section className="pile-row" aria-label="Story piles">
            <PileDisplay icon={<Layers size={19} />} label="Deck" count={match.player.deckCount} status="Remaining" />
            <PileDisplay icon={<Archive size={19} />} label="Discard" count={match.player.discardCount} status="Empty" />
          </section>
        </section>
      </main>
    );
  },
};
