// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HexTileMesh } from "./TileMesh";

afterEach(() => cleanup());

describe("HexTileMesh", () => {
  it("renders tile material state and forwards click/context menu interactions", () => {
    const onClick = vi.fn();
    const onContextMenu = vi.fn();
    const { container } = render(
      <HexTileMesh
        coord={{ q: 1, r: -1 }}
        interaction={{
          coord: { q: 1, r: -1 },
          title: "tile",
          disabled: false,
          isLegal: true,
          isSelected: false,
          hasPiece: false,
          hasManaSource: true,
        }}
        readOnly={false}
        disabled={false}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />,
    );

    const mesh = container.querySelector("mesh");
    const material = container.querySelector("meshstandardmaterial");
    expect(mesh).toBeInTheDocument();
    expect(material).toBeInTheDocument();

    fireEvent.click(mesh!);
    fireEvent.contextMenu(mesh!, { clientX: 11, clientY: 22 });

    expect(onClick).toHaveBeenCalledWith({ q: 1, r: -1 });
    expect(onContextMenu).toHaveBeenCalledWith({ q: 1, r: -1 }, { clientX: 11, clientY: 22 });
  });

  it("does not open a context menu while read-only", () => {
    const onContextMenu = vi.fn();
    const { container } = render(
      <HexTileMesh
        coord={{ q: 0, r: 0 }}
        readOnly
        disabled={false}
        onClick={vi.fn()}
        onContextMenu={onContextMenu}
      />,
    );

    fireEvent.contextMenu(container.querySelector("mesh")!);

    expect(onContextMenu).not.toHaveBeenCalled();
  });
});
