import type { HexCoord } from "../types";

export type TutorialHighlightTone = "primary" | "secondary" | "danger";

export type BoardTutorialHighlight =
  | {
      kind: "coord";
      coord: HexCoord;
      tone: TutorialHighlightTone;
    }
  | {
      kind: "piece";
      pieceId: string;
      tone: TutorialHighlightTone;
    };

export function sameTutorialCoord(left: HexCoord, right: HexCoord) {
  return left.q === right.q && left.r === right.r;
}
