// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WIKI_TOPICS } from "../wiki/wikiContent";
import { WikiPage } from "./WikiPage";

afterEach(() => cleanup());

describe("WikiPage", () => {
  it("renders the overview with every Rules wiki topic", () => {
    renderWiki();

    expect(screen.getByRole("heading", { name: "Rules Wiki" })).toBeInTheDocument();
    const topics = screen.getByRole("region", { name: "Rules topics" });

    for (const topic of WIKI_TOPICS) {
      expect(within(topics).getByRole("button", { name: `Open ${topic.title}` })).toBeInTheDocument();
    }
  });

  it("routes overview learning actions to Tutorial and Card Catalog", () => {
    const onNavigate = vi.fn();
    renderWiki({ onNavigate });

    fireEvent.click(screen.getByRole("button", { name: "Tutorial" }));
    fireEvent.click(screen.getByRole("button", { name: "Card Catalog" }));

    expect(onNavigate).toHaveBeenCalledWith("/tutorial");
    expect(onNavigate).toHaveBeenCalledWith("/catalog/");
  });

  it("renders a known topic with reference sections and related topic navigation", () => {
    const onNavigate = vi.fn();
    renderWiki({ topicSlug: "mana", onNavigate });

    expect(screen.getByRole("heading", { name: "Mana" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Key Rules" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Example" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Common Mistakes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Related Topics" })).toBeInTheDocument();
    expect(screen.getByText(/current base value is 3 Mana/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Buildings" }).at(-1)!);

    expect(onNavigate).toHaveBeenCalledWith("/wiki/buildings");
  });

  it("renders a not-found state for unknown wiki topics", () => {
    const onNavigate = vi.fn();
    renderWiki({ topicSlug: "missing-topic", onNavigate });

    expect(screen.getByRole("heading", { name: "Rules topic not found" })).toBeInTheDocument();
    const notFound = screen.getByRole("region", { name: "Rules topic not found" });

    fireEvent.click(within(notFound).getByRole("button", { name: "Open Rules" }));
    fireEvent.click(within(notFound).getByRole("button", { name: "Dashboard" }));

    expect(onNavigate).toHaveBeenCalledWith("/wiki");
    expect(onNavigate).toHaveBeenCalledWith("/");
  });
});

function renderWiki({
  topicSlug = null,
  onNavigate = vi.fn(),
  onSignOut = vi.fn(),
}: {
  topicSlug?: string | null;
  onNavigate?: (to: string) => void;
  onSignOut?: () => void;
} = {}) {
  return render(
    <WikiPage
      topicSlug={topicSlug}
      currentUser={null}
      onNavigate={onNavigate}
      onSignOut={onSignOut}
    />,
  );
}
