import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  createBoardProjection,
  type BoardProjection,
  type BoardProjectionAdapter,
} from "../../boardProjection";
import { coordKey } from "../../matchBoardHelpers";
import type { HexCoord } from "../../types";

type RectProvider = Pick<Element, "getBoundingClientRect">;

type DomBoardProjectionContext = {
  container: RectProvider | null;
  elementAt(coord: HexCoord): RectProvider | undefined;
};

export const domBoardProjectionAdapter: BoardProjectionAdapter<DomBoardProjectionContext> = {
  project(coords, { container, elementAt }, previous) {
    if (!container) {
      return createBoardProjection([], previous);
    }

    const fieldRect = container.getBoundingClientRect();
    const samples = coords.flatMap((coord) => {
      const element = elementAt(coord);
      if (!element) {
        return [];
      }

      const rect = element.getBoundingClientRect();
      return [{
        coord,
        position: {
          x: rect.left - fieldRect.left + rect.width / 2,
          y: rect.top - fieldRect.top + rect.height / 2,
          visible: true,
        },
      }];
    });

    return createBoardProjection(samples, previous);
  },
};

export function useDomBoardProjection(coords: readonly HexCoord[], enabled = true) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elementByCoordRef = useRef(new Map<string, HTMLButtonElement>());
  const [projection, setProjection] = useState<BoardProjection>(() => createBoardProjection([]));
  const coordSignature = coords.map(coordKey).join("|");

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    let frameId = 0;

    function measure() {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        setProjection((current) =>
          domBoardProjectionAdapter.project(
            coords,
            {
              container: containerRef.current,
              elementAt: (coord) => elementByCoordRef.current.get(coordKey(coord)),
            },
            current,
          ),
        );
      });
    }

    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (containerRef.current && resizeObserver) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [coordSignature, enabled]);

  const registerElement = useCallback((coord: HexCoord, element: HTMLButtonElement | null) => {
    const key = coordKey(coord);
    if (element) {
      elementByCoordRef.current.set(key, element);
    } else {
      elementByCoordRef.current.delete(key);
    }
  }, []);

  return { containerRef, projection, registerElement };
}
