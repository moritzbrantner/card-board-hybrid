// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProceduralMiniature } from "./ProceduralMiniature";
import type { ProceduralMiniatureRecipe } from "../board3dModelManifest";

afterEach(() => cleanup());

describe("ProceduralMiniature", () => {
  it("renders a clickable procedural piece with weapon and shield geometry", () => {
    const onClick = vi.fn();
    const onContextMenu = vi.fn();
    const { container } = render(
      <ProceduralMiniature
        position={[0, 0.04, 0]}
        side="player"
        pieceType="unit"
        visualIdentity={{
          status: "resolved",
          templateId: "ember-squire",
          name: "Ember Squire",
          rarity: "basic",
          portraitPath: null,
          portraitAlt: "Ember Squire portrait",
          fallbackLabel: "EMB",
          baseStats: null,
        }}
        recipe={recipe({ body: "medium", weapon: "sword", shield: "buckler", motion: "runner" })}
        selected
        legalTarget={false}
        coord={{ q: 0, r: 1 }}
        readOnly={false}
        disabled={false}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />,
    );

    const rootGroup = container.querySelector("group");
    expect(rootGroup).toBeInTheDocument();
    expect(container.querySelector("torusgeometry")).toBeInTheDocument();
    expect(container.querySelector("boxgeometry")).toBeInTheDocument();

    fireEvent.click(rootGroup!);
    fireEvent.contextMenu(rootGroup!, { clientX: 7, clientY: 9 });

    expect(onClick).toHaveBeenCalledWith({ q: 0, r: 1 });
    expect(onContextMenu).toHaveBeenCalledWith({ q: 0, r: 1 }, { clientX: 7, clientY: 9 });
  });

  it("blocks context menu actions when disabled", () => {
    const onContextMenu = vi.fn();
    const { container } = render(
      <ProceduralMiniature
        position={[0, 0.04, 0]}
        side="opponent"
        pieceType="hero"
        visualIdentity={{
          status: "resolved",
          heroType: "runekeeper",
          name: "Runekeeper",
          portraitPath: "/hero-art/runekeeper.svg",
          portraitAlt: "Runekeeper portrait",
          accentClass: "runekeeper",
          fallbackLabel: "R",
        }}
        recipe={recipe({ body: "medium", weapon: "staff", shield: "none", motion: "floating" })}
        selected={false}
        legalTarget
        coord={{ q: 0, r: 0 }}
        readOnly={false}
        disabled
        onClick={vi.fn()}
        onContextMenu={onContextMenu}
      />,
    );

    fireEvent.contextMenu(container.querySelector("group")!);

    expect(onContextMenu).not.toHaveBeenCalled();
  });
});

function recipe(
  silhouette: ProceduralMiniatureRecipe["silhouette"],
): ProceduralMiniatureRecipe {
  return {
    family: "humanoid",
    scale: 1,
    palette: {
      primary: "#d1665a",
      secondary: "#4a241e",
      accent: "#ffd08a",
    },
    silhouette,
  };
}
