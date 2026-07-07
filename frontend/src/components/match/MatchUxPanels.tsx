import {
  AlertCircle,
  ArrowRight,
  Building2,
  Footprints,
  Info,
  LibraryBig,
  ListChecks,
  ScrollText,
  ShieldQuestion,
  Sparkles,
  Sword,
  WandSparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ActionAvailabilityReason,
  ActionPreview,
  ActionRecap,
  ActionTrayEntry,
  TurnChecklistItem,
} from "../../matchUxModel";

export function ActionPreviewPanel({
  preview,
  reason,
}: {
  preview: ActionPreview | null;
  reason?: ActionAvailabilityReason | null;
}) {
  if (!preview && !reason) {
    return null;
  }

  const tone = reason ? "blocked" : (preview?.tone ?? "blocked");

  return (
    <section className={`match-ux-panel action-preview-panel action-preview-${tone}`} aria-label="Action preview">
      <div className="match-ux-panel-header">
        <span>
          {toneIcon(tone)}
          Action preview
        </span>
        <strong>{preview?.title ?? "Unavailable"}</strong>
      </div>
      <p>{reason?.message ?? preview?.body}</p>
      {preview?.details.length ? (
        <ul>
          {preview.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function ActionTray({
  entries,
  onBlockedEntry,
}: {
  entries: ActionTrayEntry[];
  onBlockedEntry?: (entry: ActionTrayEntry) => void;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="match-ux-panel action-tray" aria-label="Action tray">
      <div className="match-ux-panel-header">
        <span>
          <ScrollText size={15} />
          Actions
        </span>
      </div>
      <div className="action-tray-list">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`action-tray-button ${entry.enabled ? "" : "blocked"}`}
            aria-disabled={!entry.enabled}
            title={entry.reason?.message ?? entry.preview?.body ?? entry.label}
            onClick={() => {
              if (!entry.enabled) {
                onBlockedEntry?.(entry);
              }
            }}
          >
            {entryIcon(entry.icon)}
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function TurnChecklist({ items }: { items: TurnChecklistItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="turn-checklist" aria-label="Turn checklist">
      <span className="turn-checklist-title">
        <ListChecks size={15} />
        Turn
      </span>
      <div className="turn-checklist-items">
        {items.map((item) => (
          <span key={item.id} className={`turn-checklist-item ${item.status}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

export function ActionRecapCallout({ recap }: { recap: ActionRecap | null }) {
  if (!recap) {
    return null;
  }

  return (
    <section className={`action-recap action-recap-${recap.tone}`} aria-label="Latest action recap">
      <div>
        <span>
          {recapIcon(recap.tone)}
          Latest
        </span>
        <strong>{recap.title}</strong>
      </div>
      {recap.details.length > 0 ? <p>{recap.details.join(" ")}</p> : null}
    </section>
  );
}

export function AvailabilityReasonText({ reason }: { reason: ActionAvailabilityReason | null }) {
  if (!reason) {
    return null;
  }

  return (
    <p className="availability-reason">
      <AlertCircle size={14} />
      {reason.message}
    </p>
  );
}

function entryIcon(icon: ActionTrayEntry["icon"]) {
  switch (icon) {
    case "move":
      return <Footprints size={15} />;
    case "attack":
      return <Sword size={15} />;
    case "card":
      return <WandSparkles size={15} />;
    case "item":
      return <Sparkles size={15} />;
    case "building":
      return <Building2 size={15} />;
    case "info":
      return <LibraryBig size={15} />;
  }
}

function toneIcon(tone: ActionPreview["tone"]): ReactNode {
  switch (tone) {
    case "attack":
      return <Sword size={15} />;
    case "support":
      return <Sparkles size={15} />;
    case "blocked":
      return <ShieldQuestion size={15} />;
    case "neutral":
      return <ArrowRight size={15} />;
  }
}

function recapIcon(tone: ActionRecap["tone"]) {
  switch (tone) {
    case "attack":
      return <Sword size={14} />;
    case "support":
      return <Sparkles size={14} />;
    case "turn":
      return <ListChecks size={14} />;
    case "neutral":
      return <Info size={14} />;
  }
}
