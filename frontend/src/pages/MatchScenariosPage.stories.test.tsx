// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as scenarioStories from "./MatchScenariosPage.stories";
import { renderStory, storyArgs } from "../storybook/renderStory";

afterEach(() => cleanup());

describe("match scenario page stories", () => {
  it("renders scenario page states", () => {
    renderStory(scenarioStories.default, scenarioStories.Loading);
    expect(document.body).toHaveTextContent("Loading scenarios");
    cleanup();

    renderStory(scenarioStories.default, scenarioStories.Error);
    expect(document.body).toHaveTextContent("Could not load match scenarios");
    cleanup();

    renderStory(scenarioStories.default, scenarioStories.Loaded);
    expect(document.body).toHaveTextContent("Match Scenarios");
    expect(document.body).toHaveTextContent("Play Unit Card");
  });

  it("runs the loaded story interaction", async () => {
    const { container } = renderStory(scenarioStories.default, scenarioStories.Loaded);

    await scenarioStories.Loaded.play?.({
      canvasElement: container,
      args: storyArgs(scenarioStories.default, scenarioStories.Loaded),
    } as Parameters<NonNullable<typeof scenarioStories.Loaded.play>>[0]);
  });
});
