import { House, Layers, LibraryBig, LogIn, LogOut, History, Settings as SettingsIcon, User, WandSparkles } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AccountProps } from "../appTypes";
import { avatarSymbolLabel } from "../labels";
import { protectedLoginRoute } from "../routes";

export function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}


export function AccountActions({
  currentUser,
  onSignOut,
  onNavigate,
  allowSignOut = true,
  loginNextPath,
  activeAccountRoute = null,
}: AccountProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  if (!currentUser) {
    const loginPath = loginNextPath ? protectedLoginRoute(loginNextPath) : "/login";
    return (
      <div className="account-actions">
        <button className="secondary-link" type="button" onClick={() => onNavigate(loginPath)}>
          <LogIn size={18} />
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="account-actions account-menu-root" ref={containerRef}>
      <button
        className="secondary-link account-menu-trigger"
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        aria-label={`Account menu for ${currentUser.displayName}`}
      >
        <span className={`profile-avatar ${currentUser.avatar.color}`}>
          {avatarSymbolLabel(currentUser.avatar.symbol)}
        </span>
        <span className="account-menu-name">{currentUser.displayName}</span>
        <span className="level-badge">Lv. {currentUser.progressionSummary.level}</span>
      </button>
      {menuOpen ? (
        <div className="account-menu" id={menuId} role="menu" aria-label="Account menu">
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            disabled={activeAccountRoute === "profile"}
            onClick={() => {
              setMenuOpen(false);
              onNavigate("/profile");
            }}
          >
            <User size={17} />
            Profile
          </button>
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            disabled={activeAccountRoute === "settings"}
            onClick={() => {
              setMenuOpen(false);
              onNavigate("/settings");
            }}
          >
            <SettingsIcon size={17} />
            Settings
          </button>
          {allowSignOut ? (
            <button
              className="account-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onSignOut();
              }}
            >
              <LogOut size={17} />
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TopNav({ currentUser, onNavigate, onSignOut, ...accountActionProps }: AccountProps) {
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
      <AccountActions
        currentUser={currentUser}
        onNavigate={onNavigate}
        onSignOut={onSignOut}
        {...accountActionProps}
      />
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
