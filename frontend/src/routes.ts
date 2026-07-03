export type SharedMatchRoute = {
  matchId: string;
  seatToken: string;
};

export function currentRoutePath() {
  return `${window.location.pathname}${window.location.search}`;
}

export function routeFromPath(path: string) {
  const url = new URL(path, window.location.origin);
  return {
    pathname: url.pathname,
    searchParams: url.searchParams,
  };
}

export function safeAuthNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/profile";
  }

  try {
    const nextUrl = new URL(value, window.location.origin);
    if (nextUrl.origin !== window.location.origin) {
      return "/profile";
    }

    const normalizedNextPath = nextUrl.pathname.replace(/\/+$/, "");
    if (normalizedNextPath === "/login" || normalizedNextPath === "/register") {
      return "/profile";
    }

    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return "/profile";
  }
}

export function authRouteLink(mode: "register" | "login", nextPath: string) {
  const path = mode === "register" ? "/register" : "/login";
  return nextPath === "/profile" ? path : `${path}?next=${encodeURIComponent(nextPath)}`;
}

export function protectedLoginRoute(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}


export function matchRouteFromPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const match = normalized.match(/^\/match\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function replayRouteFromPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const match = normalized.match(/^\/matches\/([^/]+)\/replay$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function sharedMatchRouteFromPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const match = normalized.match(/^\/match\/([^/]+)\/([^/]+)$/);
  return match
    ? {
        matchId: decodeURIComponent(match[1]),
        seatToken: decodeURIComponent(match[2]),
      }
    : null;
}
