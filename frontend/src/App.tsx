import { useEffect, useMemo, useState } from "react";
import { loadCurrentAccount, logoutAccount } from "./api";
import type { AuthSessionResponse } from "./types";
import type { AuthState } from "./appTypes";
import { useAccountPreferences, useAppliedVisualPreferences, useHotkeyHandlers } from "./appHooks";
import { ShellMessage } from "./components/common";
import { ProfilePage } from "./profile";
import { clearAuthToken, getAuthToken, saveAuthToken } from "./session";
import { SettingsPage } from "./settings";
import type { HotkeyHandlers } from "./hotkeyRuntime";
import {
  currentRoutePath,
  matchRouteFromPath,
  protectedLoginRoute,
  publicDeckRouteFromPath,
  replayRouteFromPath,
  routeFromPath,
  safeAuthNextPath,
  sharedMatchRouteFromPath,
} from "./routes";
import { AuthPage } from "./pages/AuthPage";
import { CatalogPage } from "./pages/CatalogPage";
import { DecksPage } from "./pages/DecksPage";
import { MatchArchivePage } from "./pages/MatchArchivePage";
import { MatchPage } from "./pages/MatchPage";
import { MatchPicker } from "./pages/MatchPicker";
import { PublicDeckPage } from "./pages/PublicDeckPage";
import { ReplayPage } from "./pages/ReplayPage";
import { RouteRedirect } from "./pages/RouteRedirect";
import { SharedMatchPage } from "./pages/SharedMatchPage";

export function App() {
  const [path, setPath] = useState(() => currentRoutePath());
  const [authState, setAuthState] = useState<AuthState>(() =>
    getAuthToken() ? { status: "loading" } : { status: "signedOut" },
  );

  useEffect(() => {
    const handlePopState = () => setPath(currentRoutePath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!getAuthToken()) {
      setAuthState({ status: "signedOut" });
      return;
    }

    let cancelled = false;
    loadCurrentAccount()
      .then((user) => {
        if (!cancelled) {
          setAuthState({ status: "signedIn", user });
        }
      })
      .catch(() => {
        clearAuthToken();
        if (!cancelled) {
          setAuthState({ status: "signedOut" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function navigate(to: string) {
    window.history.pushState(null, "", to);
    setPath(currentRoutePath());
  }

  function replaceRoute(to: string) {
    window.history.replaceState(null, "", to);
    setPath(currentRoutePath());
  }

  function handleAuthenticated(session: AuthSessionResponse, nextPath: string) {
    saveAuthToken(session.token);
    setAuthState({ status: "signedIn", user: session.user });
    navigate(nextPath);
  }

  async function handleSignOut() {
    try {
      await logoutAccount();
    } catch {
      // Local sign-out should still clear stale sessions if the server is unavailable.
    }
    clearAuthToken();
    setAuthState({ status: "signedOut" });
    navigate("/");
  }

  const { pathname, searchParams } = routeFromPath(path);
  const normalizedPath = pathname.replace(/\/+$/, "");
  const authNextPath = safeAuthNextPath(searchParams.get("next"));
  const currentUser = authState.status === "signedIn" ? authState.user : null;
  const preferences = useAccountPreferences(currentUser);
  const visualPreferences = useAppliedVisualPreferences(preferences.state.preferences);
  const appHotkeyHandlers = useMemo<HotkeyHandlers>(
    () => ({
      openSettings: () => {
        navigate("/settings");
        return true;
      },
      openCatalog: () => {
        navigate("/catalog/");
        return true;
      },
      openDecks: () => {
        navigate("/decks");
        return true;
      },
      openMatchArchive: () => {
        navigate("/matches");
        return true;
      },
    }),
    [],
  );
  useHotkeyHandlers(preferences.state.preferences.hotkeys, appHotkeyHandlers);

  if (authState.status === "loading") {
    return <ShellMessage title="Rune Lanes" message="Checking account" />;
  }

  if (normalizedPath === "/login" || normalizedPath === "/register") {
    if (currentUser) {
      return <RouteRedirect to={authNextPath} onNavigate={replaceRoute} />;
    }

    return (
      <AuthPage
        mode={normalizedPath === "/register" ? "register" : "login"}
        nextPath={authNextPath}
        onNavigate={navigate}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (normalizedPath === "/catalog") {
    return <CatalogPage onNavigate={navigate} />;
  }

  const publicDeckRoute = publicDeckRouteFromPath(path);
  if (publicDeckRoute) {
    return (
      <PublicDeckPage
        key={`${publicDeckRoute.handle}:${publicDeckRoute.deckId}`}
        handle={publicDeckRoute.handle}
        deckId={publicDeckRoute.deckId}
        currentUser={currentUser}
        onNavigate={navigate}
        onSignOut={handleSignOut}
      />
    );
  }

  if (normalizedPath === "/profile") {
    if (!currentUser) {
      return <RouteRedirect to={protectedLoginRoute("/profile")} onNavigate={replaceRoute} />;
    }

    return (
      <ProfilePage
        currentUser={currentUser}
        onNavigate={navigate}
        onProfileUpdated={(profile) => setAuthState({ status: "signedIn", user: profile })}
        onSignOut={handleSignOut}
      />
    );
  }

  if (normalizedPath === "/settings") {
    return (
      <SettingsPage
        preferencesState={preferences.state}
        isSignedIn={Boolean(currentUser)}
        onNavigate={navigate}
        onSave={preferences.save}
        onRefresh={preferences.refresh}
        onSignOut={handleSignOut}
      />
    );
  }

  if (normalizedPath === "/decks") {
    if (!currentUser) {
      return <RouteRedirect to={protectedLoginRoute("/decks")} onNavigate={replaceRoute} />;
    }

    return (
      <DecksPage
        currentUser={currentUser}
        onNavigate={navigate}
        onSignOut={handleSignOut}
      />
    );
  }

  if (path === "/" || path === "") {
    return <MatchPicker onNavigate={navigate} currentUser={currentUser} onSignOut={handleSignOut} />;
  }

  if (normalizedPath === "/matches") {
    if (!currentUser) {
      return <RouteRedirect to={protectedLoginRoute("/matches")} onNavigate={replaceRoute} />;
    }

    return (
      <MatchArchivePage
        onNavigate={navigate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
      />
    );
  }

  const replayRoute = replayRouteFromPath(path);
  if (replayRoute) {
    return (
      <ReplayPage
        key={replayRoute}
        matchId={replayRoute}
        onNavigate={navigate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        visualPreferences={visualPreferences}
      />
    );
  }

  const sharedMatchRoute = sharedMatchRouteFromPath(path);
  if (sharedMatchRoute) {
    return (
      <SharedMatchPage
        key={`${sharedMatchRoute.matchId}:${sharedMatchRoute.seatToken}`}
        matchId={sharedMatchRoute.matchId}
        seatToken={sharedMatchRoute.seatToken}
        onNavigate={navigate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        visualPreferences={visualPreferences}
      />
    );
  }

  const matchRoute = matchRouteFromPath(path);
  if (matchRoute) {
    return (
      <MatchPage
        key={matchRoute}
        matchId={matchRoute}
        onNavigate={navigate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        visualPreferences={visualPreferences}
      />
    );
  }

  return (
    <ShellMessage
      title="Rune Lanes"
      message="Route not found"
      actions={
        <button className="primary-button" type="button" onClick={() => navigate("/")}>
          Open match picker
        </button>
      }
    />
  );
}
