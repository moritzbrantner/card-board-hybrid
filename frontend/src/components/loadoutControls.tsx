import { Heart, Layers, Sword, WandSparkles, Zap } from "lucide-react";
import { WizardPreview3D } from "../WizardPreview3D";
import { WIZARD_OPTIONS } from "../wizards";
import { defaultRuneIdsForWizard, wizardOptionByType } from "../labels";
import { runeNamesForLoadout, skillNamesForWizard, type HomeLoadout } from "../deckHelpers";
import type { ProgressionResponse, RuneDefinition, WizardType } from "../types";

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
  const wizard = wizardOptionByType(loadout.wizardType);
  const effectiveRuneIds =
    loadout.kind === "system" && progression
      ? defaultRuneIdsForWizard(progression, loadout.wizardType)
      : loadout.runeIds;
  const runeNames = runeNamesForLoadout(progression, effectiveRuneIds);
  const skillNames = skillNamesForWizard(progression, loadout.wizardType);

  return (
    <button
      className={`loadout-card ${selected ? "selected" : ""} ${!loadout.legal ? "draft" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(loadout)}
      disabled={busy || !loadout.legal}
    >
      <span className="loadout-card-model">
        <WizardPreview3D wizardType={loadout.wizardType} label={wizard?.name ?? "Wizard"} />
      </span>
      <span className="loadout-card-body">
        <span className="loadout-card-heading">
          <span>
            <strong>{loadout.name}</strong>
            <small>{loadout.kind === "system" ? "Preconfigured" : "Custom deck recipe"}</small>
          </span>
          <WandSparkles size={18} />
        </span>
        <span className="wizard-stat-row">
          <span>
            <Heart size={13} />
            {wizard?.hp ?? 0}
          </span>
          <span>
            <Sword size={13} />
            {wizard?.attack ?? 0}
          </span>
          <span>
            <Zap size={13} />
            {wizard?.ap ?? 0}
          </span>
          <span>
            <Layers size={13} />
            {loadout.cardCount}
          </span>
        </span>
        <span className="loadout-detail-list">
          <span>{wizard?.name ?? "Wizard"}</span>
          <span>{runeNames.length > 0 ? runeNames.join(", ") : "No runes equipped"}</span>
          <span>{skillNames.length > 0 ? skillNames.join(", ") : "Base skill only"}</span>
          {!loadout.legal ? <span>Draft deck cannot start a match</span> : null}
        </span>
      </span>
    </button>
  );
}


export function WizardPicker({
  selectedWizardType,
  busy,
  onSelect,
}: {
  selectedWizardType: WizardType;
  busy: boolean;
  onSelect: (wizardType: WizardType) => void;
}) {
  return (
    <fieldset className="wizard-picker" aria-label="Wizard type">
      <legend>Wizard Type</legend>
      <div className="wizard-options">
        {WIZARD_OPTIONS.map((wizard) => (
          <button
            key={wizard.id}
            className={`wizard-option ${selectedWizardType === wizard.id ? "selected" : ""}`}
            type="button"
            aria-pressed={selectedWizardType === wizard.id}
            onClick={() => onSelect(wizard.id)}
            disabled={busy}
          >
            <span className="wizard-option-header">
              <span>
                <strong>{wizard.name}</strong>
                <span>{wizard.role}</span>
              </span>
              <WandSparkles size={18} />
            </span>
            <span className="wizard-option-text">{wizard.text}</span>
            <span className="wizard-stat-row">
              <span>
                <Heart size={13} />
                {wizard.hp}
              </span>
              <span>
                <Sword size={13} />
                {wizard.attack}
              </span>
              <span>
                <Zap size={13} />
                {wizard.ap}
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
  wizardType,
  selectedRuneIds,
  onChange,
}: {
  progression: ProgressionResponse;
  wizardType: WizardType;
  selectedRuneIds: string[];
  onChange: (runeIds: string[]) => void;
}) {
  const wizard = wizardOptionByType(wizardType);
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
          {wizard?.name ?? "Wizard"} · {selectedRuneIds.length}/{progression.account.runeSlots}
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
  wizardName,
}: {
  label: string;
  ready: boolean;
  wizardName: string | null;
}) {
  return (
    <div className={`lobby-seat-status ${ready ? "ready" : ""}`}>
      <span>{label}</span>
      <strong>{ready ? (wizardName ?? "Ready") : "Choosing"}</strong>
    </div>
  );
}
