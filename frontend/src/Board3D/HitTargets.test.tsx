// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Board3DHitTarget } from "./HitTargets";
import type { Board3DTileInteraction } from "./types";

afterEach(() => cleanup());

describe("Board3DHitTarget", () => {
  it("exposes tile state and forwards click, hover, focus, and context menu events", () => {
    const onClick = vi.fn();
    const onDrop = vi.fn();
    const onContextMenu = vi.fn();
    const onHoverChange = vi.fn();

    render(
      <Board3DHitTarget
        interaction={interaction({
          isLegal: true,
          isSelected: true,
          isFocused: true,
          tutorialHighlightTone: "primary",
          hasManaSource: true,
          pieceSide: "player",
          pieceLabel: "Hero",
          pieceStatLabel: "2/8",
        })}
        projectedPosition={{ x: 32, y: 48, visible: true }}
        readOnly={false}
        disabled={false}
        onClick={onClick}
        onDrop={onDrop}
        onContextMenu={onContextMenu}
        onHoverChange={onHoverChange}
      />,
    );

    const button = screen.getByRole("button", { name: "q 0, r 1" });
    expect(button).toHaveClass("legal", "selected-piece", "keyboard-focused", "mana-source", "occupied-player");
    expect(button).toHaveAttribute("data-board-3d-tile", "0:1");
    expect(button).toHaveAttribute("data-legal", "true");
    expect(button).toHaveStyle({ left: "32px", top: "48px", visibility: "visible" });

    fireEvent.pointerEnter(button);
    fireEvent.focus(button);
    fireEvent.click(button);
    fireEvent.contextMenu(button, { clientX: 11, clientY: 22 });

    expect(onHoverChange).toHaveBeenCalledWith({ q: 0, r: 1 });
    expect(onClick).toHaveBeenCalledWith({ q: 0, r: 1 });
    expect(onContextMenu).toHaveBeenCalledWith({ q: 0, r: 1 }, { clientX: 11, clientY: 22 });
  });

  it("accepts legal card drops and ignores read-only drops", () => {
    const onDrop = vi.fn();
    const dataTransfer = {
      dropEffect: "none",
      getData: vi.fn(() => "card-1"),
    };
    const { rerender } = render(
      <Board3DHitTarget
        interaction={interaction({ isLegal: true })}
        projectedPosition={{ x: 32, y: 48, visible: true }}
        readOnly={false}
        disabled={false}
        onClick={vi.fn()}
        onDrop={onDrop}
        onContextMenu={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "q 0, r 1" });
    fireEvent.dragOver(button, { dataTransfer });
    fireEvent.drop(button, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");
    expect(onDrop).toHaveBeenCalledWith({ q: 0, r: 1 }, "card-1");

    rerender(
      <Board3DHitTarget
        interaction={interaction({ isLegal: true })}
        projectedPosition={{ x: 32, y: 48, visible: true }}
        readOnly
        disabled={false}
        onClick={vi.fn()}
        onDrop={onDrop}
        onContextMenu={vi.fn()}
      />,
    );
    fireEvent.drop(screen.getByRole("button", { name: "q 0, r 1" }), { dataTransfer });
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});

function interaction(overrides: Partial<Board3DTileInteraction> = {}): Board3DTileInteraction {
  return {
    coord: { q: 0, r: 1 },
    title: "q 0, r 1",
    disabled: false,
    isLegal: false,
    isSelected: false,
    hasPiece: true,
    ...overrides,
  };
}
