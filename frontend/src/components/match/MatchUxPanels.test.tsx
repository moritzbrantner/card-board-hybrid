// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ActionPreviewPanel,
  ActionRecapCallout,
  ActionTray,
  TurnChecklist,
} from "./MatchUxPanels";

describe("match UX panels", () => {
  it("renders action previews and blocked reasons", () => {
    render(
      <ActionPreviewPanel
        preview={{
          title: "Spark Jolt",
          body: "Deals 1 damage.",
          details: ["1 mana"],
          tone: "attack",
        }}
        reason={{ code: "insufficientMana", message: "Need 1 mana; you have 0." }}
      />,
    );

    expect(screen.getByRole("region", { name: "Action preview" })).toHaveTextContent(
      "Need 1 mana",
    );
    expect(screen.getByText("Spark Jolt")).toBeInTheDocument();
  });

  it("reports blocked action tray entries without native disabling", () => {
    const onBlockedEntry = vi.fn();

    render(
      <ActionTray
        entries={[
          {
            id: "move",
            label: "Move",
            icon: "move",
            enabled: false,
            reason: { code: "pieceApEmpty", message: "No AP left." },
          },
        ]}
        onBlockedEntry={onBlockedEntry}
      />,
    );

    const button = screen.getByRole("button", { name: "Move" });
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);

    expect(onBlockedEntry).toHaveBeenCalledOnce();
  });

  it("renders compact checklist and latest recap", () => {
    render(
      <>
        <TurnChecklist
          items={[
            { id: "hero-ap", label: "Hero AP", value: "2/3", status: "available" },
            { id: "cards", label: "Playable cards", value: "1", status: "available" },
          ]}
        />
        <ActionRecapCallout
          recap={{
            id: "recap",
            title: "Opponent attacked",
            details: ["Your Hero took 2."],
            tone: "attack",
          }}
        />
      </>,
    );

    expect(screen.getByRole("region", { name: "Turn checklist" })).toHaveTextContent("2/3");
    expect(screen.getByRole("region", { name: "Latest action recap" })).toHaveTextContent(
      "Opponent attacked",
    );
  });
});
