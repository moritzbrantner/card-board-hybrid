import { House, Layers, LibraryBig, LogIn, LogOut, History, Settings as SettingsIcon, WandSparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { AccountProps } from "../appTypes";
import { avatarSymbolLabel } from "../labels";

export function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}


export function AccountActions({ currentUser, onSignOut, onNavigate }: AccountProps) {
  if (!currentUser) {
    return (
      <div className="account-actions">
        <button className="secondary-link" type="button" onClick={() => onNavigate("/login")}>
          <LogIn size={18} />
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="account-actions">
      <button className="secondary-link" type="button" onClick={() => onNavigate("/profile")}>
        <span className={`profile-avatar ${currentUser.avatar.color}`}>
          {avatarSymbolLabel(currentUser.avatar.symbol)}
        </span>
        {currentUser.displayName}
        <span className="level-badge">Lv. {currentUser.progressionSummary.level}</span>
      </button>
      <button className="icon-button" type="button" onClick={() => onNavigate("/settings")} title="Settings">
        <SettingsIcon size={18} />
      </button>
      <button className="icon-button" type="button" onClick={onSignOut} title="Sign out">
        <LogOut size={18} />
      </button>
    </div>
  );
}

export function TopNav({ currentUser, onNavigate, onSignOut }: AccountProps) {
  return (
    <nav className="top-nav" aria-label="Primary navigation">
      <button className="brand-button" type="button" onClick={() => onNavigate("/")}>
        <WandSparkles size={19} />
        Rune Lanes
      </button>
      <div className="top-nav-links">
        <button className="secondary-link" type="button" onClick={() => onNavigate("/")}>
          <House size={18} />
          Play
        </button>
        <button className="secondary-link" type="button" onClick={() => onNavigate("/catalog/")}>
          <LibraryBig size={18} />
          Catalog
        </button>
        {currentUser ? (
          <>
            <button className="secondary-link" type="button" onClick={() => onNavigate("/decks")}>
              <Layers size={18} />
              Decks
            </button>
            <button className="secondary-link" type="button" onClick={() => onNavigate("/matches")}>
              <History size={18} />
              Matches
            </button>
          </>
        ) : null}
      </div>
      <AccountActions currentUser={currentUser} onNavigate={onNavigate} onSignOut={onSignOut} />
    </nav>
  );
}


export function ShellMessage({
  title,
  message,
  actions,
}: {
  title: string;
  message: string;
  actions?: ReactNode;
}) {
  return (
    <main className="app-shell centered">
      <div className="shell-message">
        <p className="eyebrow">{title}</p>
        <h1>{message}</h1>
        {actions ? <div className="actions shell-actions">{actions}</div> : null}
      </div>
    </main>
  );
}
