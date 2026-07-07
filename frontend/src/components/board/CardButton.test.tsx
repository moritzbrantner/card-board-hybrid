// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardButton } from "./Board";
import { emberSquireCard } from "../board.fixtures";
import type { CardVisualIdentity } from "../../matchVisualIdentity";

const visualIdentity: CardVisualIdentity = {
  name: "Ember Squire",
  templateId: "ember-squire",
  kind: emberSquireCard.kind,
  cost: emberSquireCard.cost,
  text: emberSquireCard.text,
  artPath: null,
  artAlt: "",
  rarity: "basic",
  status: "resolved",
  accentClass: "basic",
};

describe("CardButton", () => {
  it("keeps unavailable cards focusable while preventing drag submission", () => {
    const onClick = vi.fn();
    const onFocus = vi.fn();
    const onDragStart = vi.fn();

    render(
      <CardButton
        card={emberSquireCard}
        visualIdentity={visualIdentity}
        selected={false}
        disabled={false}
        unavailable
        availabilityReason="Need 1 mana; you have 0."
        onClick={onClick}
        onFocus={onFocus}
        onDragStart={onDragStart}
      />,
    );

    const button = screen.getByRole("button", { name: /Ember Squire/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();

    fireEvent.focus(button);
    fireEvent.click(button);
    fireEvent.dragStart(button);

    expect(onFocus).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
    expect(onDragStart).not.toHaveBeenCalled();
  });
});
