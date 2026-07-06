// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType, ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import * as scenarioStories from "./MatchScenariosPage.stories";

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

function renderStory(metaInput: unknown, storyInput: unknown) {
  const meta = metaInput as StoryMeta;
  const story = storyInput as StoryDefinition;
  const args = storyArgs(meta, story);
  if (story.render) {
    return render(story.render(args));
  }

  const Component = meta.component;
  if (!Component) {
    throw new Error("Story has no component or render function");
  }

  return render(<Component {...args} />);
}

function storyArgs(metaInput: unknown, storyInput: unknown) {
  const meta = metaInput as StoryMeta;
  const story = storyInput as StoryDefinition;
  return {
    ...(meta.args ?? {}),
    ...(story.args ?? {}),
  };
}

type StoryMeta = {
  component?: ComponentType<any>;
  args?: Record<string, unknown>;
};

type StoryDefinition = {
  args?: Record<string, unknown>;
  render?: (...args: any[]) => ReactElement;
  play?: (context: { canvasElement: HTMLElement; args: Record<string, unknown> }) => Promise<void> | void;
};
