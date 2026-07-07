import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { TutorialIntroOverlay, TutorialObjectivePanel } from "./TutorialOverlay";
import { TUTORIAL_STEPS } from "./tutorialReducer";

const meta = {
  title: "Components/TutorialOverlay",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Intro: Story = {
  render: () => (
    <TutorialIntroOverlay
      step={TUTORIAL_STEPS[0]}
      canGoBack={false}
      onContinue={fn()}
      onBack={fn()}
      onRestart={fn()}
      onExit={fn()}
    />
  ),
};

export const Objective: Story = {
  render: () => (
    <main className="app-shell match-app-shell">
      <TutorialObjectivePanel
        step={TUTORIAL_STEPS[0]}
        hint="Select your hero to inspect movement options."
        completed={false}
        onRestart={fn()}
        onExit={fn()}
      />
    </main>
  ),
};
