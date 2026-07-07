// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useBoardRendererDegradation,
  type BoardRendererDegradation,
} from "./boardRendererDegradation";
import type { BoardVisualMode } from "./types";

afterEach(() => cleanup());

describe("board renderer degradation", () => {
  it("starts in 2D fallback when WebGL is unavailable", () => {
    renderPolicy({ requestedMode: "3d", canUseWebGL: () => false });

    expect(screen.getByTestId("renderer")).toHaveTextContent("2d");
    expect(screen.getByTestId("fallback")).toHaveTextContent("3D board unavailable, using 2D.");
  });

  it("falls back after a fatal 3D render failure", () => {
    renderPolicy({ requestedMode: "3d", canUseWebGL: () => true });
    expect(screen.getByTestId("renderer")).toHaveTextContent("3d");

    fireEvent.click(screen.getByRole("button", { name: "fatal" }));

    expect(screen.getByTestId("renderer")).toHaveTextContent("2d");
    expect(screen.getByTestId("fallback")).toHaveTextContent("3D board failed to start, using 2D.");
  });

  it("counts asset failures and resets them for explicit 2D preference", () => {
    const canUseWebGL = vi.fn(() => true);
    const { rerender } = render(
      <PolicyProbe requestedMode="3d" readOnly={false} disabled={false} canUseWebGL={canUseWebGL} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "asset" }));
    fireEvent.click(screen.getByRole("button", { name: "asset" }));
    expect(screen.getByTestId("asset-failures")).toHaveTextContent("2");

    rerender(
      <PolicyProbe requestedMode="2d" readOnly={false} disabled={false} canUseWebGL={canUseWebGL} />,
    );

    expect(screen.getByTestId("renderer")).toHaveTextContent("2d");
    expect(screen.getByTestId("fallback")).toBeEmptyDOMElement();
    expect(screen.getByTestId("asset-failures")).toHaveTextContent("0");
  });

  it("updates renderer and interactivity for requested mode, read-only, and disabled changes", () => {
    const canUseWebGL = vi.fn(() => true);
    const { rerender } = render(
      <PolicyProbe requestedMode="2d" readOnly={false} disabled={false} canUseWebGL={canUseWebGL} />,
    );

    expect(screen.getByTestId("renderer")).toHaveTextContent("2d");
    expect(screen.getByTestId("interactive")).toHaveTextContent("true");

    rerender(
      <PolicyProbe requestedMode="3d" readOnly={true} disabled={false} canUseWebGL={canUseWebGL} />,
    );
    expect(screen.getByTestId("renderer")).toHaveTextContent("3d");
    expect(screen.getByTestId("interactive")).toHaveTextContent("false");

    rerender(
      <PolicyProbe requestedMode="3d" readOnly={false} disabled={true} canUseWebGL={canUseWebGL} />,
    );
    expect(screen.getByTestId("interactive")).toHaveTextContent("false");
  });
});

function renderPolicy({
  requestedMode,
  canUseWebGL,
}: {
  requestedMode: BoardVisualMode;
  canUseWebGL: () => boolean;
}) {
  return render(
    <PolicyProbe
      requestedMode={requestedMode}
      readOnly={false}
      disabled={false}
      canUseWebGL={canUseWebGL}
    />,
  );
}

function PolicyProbe({
  requestedMode,
  readOnly,
  disabled,
  canUseWebGL,
}: {
  requestedMode: BoardVisualMode;
  readOnly: boolean;
  disabled: boolean;
  canUseWebGL: () => boolean;
}) {
  const policy: BoardRendererDegradation = useBoardRendererDegradation({
    requestedMode,
    readOnly,
    disabled,
    canUseWebGL,
  });

  return (
    <div>
      <span data-testid="renderer">{policy.renderer}</span>
      <span data-testid="interactive">{String(policy.isInteractive)}</span>
      <span data-testid="fallback">{policy.fallbackMessage}</span>
      <span data-testid="asset-failures">{policy.assetFailureCount}</span>
      <button type="button" onClick={policy.reportFatalRenderError}>
        fatal
      </button>
      <button type="button" onClick={policy.reportAssetFailure}>
        asset
      </button>
    </div>
  );
}
