import { render } from "@testing-library/react";
import type { ComponentType, ReactElement } from "react";

export function renderStory(metaInput: unknown, storyInput: unknown) {
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

export function storyArgs(metaInput: unknown, storyInput: unknown) {
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
