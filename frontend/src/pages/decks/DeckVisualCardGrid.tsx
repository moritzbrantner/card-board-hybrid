import { Minus, Plus, WandSparkles } from "lucide-react";
import { rarityLabel } from "../../deckHelpers";
import type { CatalogCard } from "../../types";
import type { DeckVisualCard } from "./deckDesignerModel";

type DeckVisualCardGridProps = {
  cards: DeckVisualCard[];
  selectedTemplateId?: string | null;
  busy?: boolean;
  readOnly?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  onSelect?: (templateId: string) => void;
  onAdjust?: (card: CatalogCard, delta: number) => void;
};

export function DeckVisualCardGrid({
  cards,
  selectedTemplateId = null,
  busy = false,
  readOnly = false,
  emptyTitle = "No Cards picked",
  emptyMessage = "Add Cards from the catalog to build this Deck recipe.",
  onSelect,
  onAdjust,
}: DeckVisualCardGridProps) {
  if (cards.length === 0) {
    return (
      <div className="deck-empty-state deck-visual-grid-empty">
        <WandSparkles size={22} />
        <strong>{emptyTitle}</strong>
        <span>{emptyMessage}</span>
      </div>
    );
  }

  return (
    <div className="picked-card-grid">
      {cards.map((row) => {
        const selected = selectedTemplateId === row.card.templateId;
        const canSelect = Boolean(onSelect);

        return (
          <article
            key={row.card.id}
            className={`picked-card-tile ${row.card.rarity} ${selected ? "selected" : ""}`}
          >
            <button
              type="button"
              className="picked-card-art-button"
              onClick={() => onSelect?.(row.card.templateId)}
              disabled={!canSelect}
              aria-label={`Select ${row.card.name}`}
              aria-pressed={selected}
            >
              <img src={row.card.artPath} alt="" loading="lazy" />
              <span className="card-cost">{row.card.cost}</span>
              <span className="picked-card-count-badge">x{row.count}</span>
            </button>
            <div className="picked-card-tile-body">
              <button
                type="button"
                className="picked-card-title-button"
                onClick={() => onSelect?.(row.card.templateId)}
                disabled={!canSelect}
              >
                <strong>{row.card.name}</strong>
                <small>
                  {rarityLabel(row.card.rarity)} · {row.card.cost} mana · {row.kindLabel}
                </small>
              </button>
              <p>{row.kindDetail}</p>
              {readOnly || !onAdjust ? (
                <span className="picked-card-readonly-count">{row.count} in deck recipe</span>
              ) : (
                <div className="deck-count-controls" aria-label={`${row.card.name} count`}>
                  <button
                    type="button"
                    onClick={() => onAdjust(row.card, -1)}
                    disabled={busy || row.count <= 0}
                    aria-label={`Remove ${row.card.name}`}
                  >
                    <Minus size={15} />
                  </button>
                  <strong>{row.count}</strong>
                  <button
                    type="button"
                    onClick={() => onAdjust(row.card, 1)}
                    disabled={busy || row.count >= row.copyLimit}
                    title={
                      row.count >= row.copyLimit
                        ? `${rarityLabel(row.card.rarity)} copy limit reached`
                        : undefined
                    }
                    aria-label={`Add ${row.card.name}`}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
