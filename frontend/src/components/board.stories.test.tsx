// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import * as boardStories from "./board.stories";

afterEach(() => cleanup());

describe("board stories", () => {
  it("renders board state stories", () => {
    renderStory(boardStories.default, boardStories.OpeningBoard);
    expect(screen.getByRole("region", { name: "Hex board" })).toBeInTheDocument();
    cleanup();

    renderStory(boardStories.default, boardStories.SelectedCardTargets);
    expect(screen.getByRole("region", { name: "Hex board" })).toBeInTheDocument();
  });

  it("renders card, stack, and pile stories", () => {
    renderStory(boardStories.default, boardStories.CardButtonStates);
    expect(document.body).toHaveTextContent("Ember Squire");
    cleanup();

    renderStory(boardStories.default, boardStories.StackAndPiles);
    expect(document.body).toHaveTextContent("Stack");
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
};
