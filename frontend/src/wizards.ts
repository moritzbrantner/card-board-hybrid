import type { WizardType } from "./types";

export type WizardOption = {
  id: WizardType;
  name: string;
  role: string;
  hp: number;
  attack: number;
  ap: number;
  text: string;
  token: string;
};

export const WIZARD_OPTIONS = [
  {
    id: "runekeeper",
    name: "Runekeeper",
    role: "Balanced",
    hp: 20,
    attack: 1,
    ap: 3,
    text: "Steady stats for flexible card play.",
    token: "Run",
  },
  {
    id: "pyromancer",
    name: "Pyromancer",
    role: "Aggressive",
    hp: 18,
    attack: 2,
    ap: 3,
    text: "Higher melee damage with a smaller health pool.",
    token: "Pyr",
  },
  {
    id: "chronomancer",
    name: "Chronomancer",
    role: "Mobile",
    hp: 16,
    attack: 1,
    ap: 4,
    text: "Extra action point for repositioning and summons.",
    token: "Chr",
  },
  {
    id: "warden",
    name: "Warden",
    role: "Defensive",
    hp: 24,
    attack: 1,
    ap: 2,
    text: "Durable but slower across the board.",
    token: "War",
  },
  {
    id: "battlemage",
    name: "Battlemage",
    role: "Bruiser",
    hp: 20,
    attack: 2,
    ap: 2,
    text: "Tougher frontline duelist with fewer actions.",
    token: "Bat",
  },
] as const satisfies readonly WizardOption[];
