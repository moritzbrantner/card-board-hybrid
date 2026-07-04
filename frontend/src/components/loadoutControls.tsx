import { Heart, Layers, Sword, WandSparkles, Zap } from "lucide-react";
import { HeroPreview3D } from "../HeroPreview3D";
import { HERO_OPTIONS } from "../heroes";
import { defaultRuneIdsForHero, heroOptionByType } from "../labels";
import { runeNamesForLoadout, skillNamesForHero, type HomeLoadout } from "../deckHelpers";
import type { ProgressionResponse, RuneDefinition, HeroType } from "../types";

export function LoadoutCard({
  loadout,
  selected,
  progression,
  onSelect,
  busy,
}: {
  loadout: HomeLoadout;
  selected: boolean;
  progression: ProgressionResponse | null;
  onSelect: (loadout: HomeLoadout) => void;
  busy: boolean;
}) {
  const hero = heroOptionByType(loadout.heroType);
  const effectiveRuneIds =
    loadout.kind === "system" && progression
      ? defaultRuneIdsForHero(progression, loadout.heroType)
      : loadout.runeIds;
  const runeNames = runeNamesForLoadout(progression, effectiveRuneIds);
  const skillNames = skillNamesForHero(progression, loadout.heroType);

  return (
    <button
      className={`loadout-card ${selected ? "selected" : ""} ${!loadout.legal ? "draft" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(loadout)}
      disabled={busy || !loadout.legal}
    >
      <span className="loadout-card-model">
        <HeroPreview3D heroType={loadout.heroType} label={hero?.name ?? "Hero"} />
      </span>
      <span className="loadout-card-body">
        <span className="loadout-card-heading">
          <span>
            <strong>{loadout.name}</strong>
            <small>{loadout.kind === "system" ? "Preconfigured" : "Custom deck recipe"}</small>
          </span>
          <WandSparkles size={18} />
        </span>
        <span className="hero-stat-row">
          <span>
            <Heart size={13} />
            {hero?.hp ?? 0}
          </span>
          <span>
            <Sword size={13} />
            {hero?.attack ?? 0}
          </span>
          <span>
            <Zap size={13} />
            {hero?.ap ?? 0}
          </span>
          <span>
            <Layers size={13} />
            {loadout.cardCount}
          </span>
        </span>
        <span className="loadout-detail-list">
          <span>{hero?.name ?? "Hero"}</span>
          <span>{runeNames.length > 0 ? runeNames.join(", ") : "No runes equipped"}</span>
          <span>{skillNames.length > 0 ? skillNames.join(", ") : "Base skill only"}</span>
          {!loadout.legal ? <span>Draft deck cannot start a match</span> : null}
        </span>
      </span>
    </button>
  );
}


export function HeroPicker({
  selectedHeroType,
  busy,
  onSelect,
}: {
  selectedHeroType: HeroType;
  busy: boolean;
  onSelect: (heroType: HeroType) => void;
}) {
  return (
    <fieldset className="hero-picker" aria-label="Hero type">
      <legend>Hero Type</legend>
      <div className="hero-options">
        {HERO_OPTIONS.map((hero) => (
          <button
            key={hero.id}
            className={`hero-option ${selectedHeroType === hero.id ? "selected" : ""}`}
            type="button"
            aria-pressed={selectedHeroType === hero.id}
            onClick={() => onSelect(hero.id)}
            disabled={busy}
          >
            <span className="hero-option-header">
              <span>
                <strong>{hero.name}</strong>
                <span>{hero.role}</span>
              </span>
              <WandSparkles size={18} />
            </span>
            <span className="hero-option-text">{hero.text}</span>
            <span className="hero-stat-row">
              <span>
                <Heart size={13} />
                {hero.hp}
              </span>
              <span>
                <Sword size={13} />
                {hero.attack}
              </span>
              <span>
                <Zap size={13} />
                {hero.ap}
              </span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function RuneSelector({
  progression,
  heroType,
  selectedRuneIds,
  onChange,
}: {
  progression: ProgressionResponse;
  heroType: HeroType;
  selectedRuneIds: string[];
  onChange: (runeIds: string[]) => void;
}) {
  const hero = heroOptionByType(heroType);
  function toggleRune(rune: RuneDefinition) {
    if (!rune.unlocked) {
      return;
    }
    if (selectedRuneIds.includes(rune.id)) {
      onChange(selectedRuneIds.filter((runeId) => runeId !== rune.id));
      return;
    }
    if (selectedRuneIds.length >= progression.account.runeSlots) {
      return;
    }
    onChange([...selectedRuneIds, rune.id]);
  }

  return (
    <section className="setup-rune-selector" aria-label="Rune loadout">
      <div>
        <span>Runes</span>
        <strong>
          {hero?.name ?? "Hero"} · {selectedRuneIds.length}/{progression.account.runeSlots}
        </strong>
      </div>
      <div className="rune-grid compact">
        {progression.runes.map((rune) => {
          const selected = selectedRuneIds.includes(rune.id);
          const disabled =
            !rune.unlocked || (!selected && selectedRuneIds.length >= progression.account.runeSlots);
          return (
            <button
              key={rune.id}
              type="button"
              className={selected ? "selected" : ""}
              disabled={disabled}
              onClick={() => toggleRune(rune)}
              title={rune.unlocked ? rune.text : `Unlocks at account level ${rune.unlockLevel}`}
            >
              <strong>{rune.name}</strong>
              <span>{rune.unlocked ? rune.text : `Level ${rune.unlockLevel}`}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function LobbySeatStatus({
  label,
  ready,
  heroName,
}: {
  label: string;
  ready: boolean;
  heroName: string | null;
}) {
  return (
    <div className={`lobby-seat-status ${ready ? "ready" : ""}`}>
      <span>{label}</span>
      <strong>{ready ? (heroName ?? "Ready") : "Choosing"}</strong>
    </div>
  );
}
