import type {
  Action,
  Sample,
  AppearanceTarget,
  DisplayStyle,
} from "./types.js";
import { C } from "./copy.js";
import { DEFAULT_OUTPUT_LENGTH } from "./prompts.js";

export function getPresets(): Action[] {
  return (
    [
      {
        id: "translate",
        icon: "translate",
        mode: "paragraph",
        placement: "inline",
        quick: true,
        kind: "translate",
        sourceLanguage: "auto",
        targetLanguage: "interface",
      },
      {
        id: "plain",
        icon: "book",
        mode: "paragraph",
        placement: "inline",
        quick: true,
        kind: "plain",
      },
      {
        id: "explain",
        icon: "explain",
        mode: "whole",
        placement: "panel",
        quick: true,
        kind: "explain",
      },
      {
        id: "qa",
        icon: "question",
        mode: "whole",
        placement: "panel",
        quick: true,
        kind: "qa",
        outputLength: DEFAULT_OUTPUT_LENGTH,
      },
      {
        id: "summary",
        icon: "list",
        mode: "whole",
        placement: "panel",
        quick: false,
        kind: "summary",
      },
    ] as Omit<Action, "name" | "instruction" | "model">[]
  ).map((p) => ({
    ...p,
    ...C.presets[p.kind as keyof typeof C.presets],
    model: "default",
    ...(p.kind === "translate" ? {} : { outputLanguage: "interface" }),
    builtin: true,
  }));
}
export const sample: Sample = {
  title: "Good notes begin with a question",
  paragraphs: [
    "Reading is not simply the act of collecting information. It is a conversation between what we already know and what we are trying to understand.",
    "A useful note does more than repeat a sentence. It connects an idea to a question, an experience, or another idea. Those connections make knowledge easier to recall and use.",
    "Before highlighting a paragraph, pause and ask: what changed in my understanding? Write that change in your own words. A small, precise note is often more valuable than a page of copied text.",
  ],
};
export const defaultAppearance: Record<AppearanceTarget, DisplayStyle> = {
  page: {
    color: "theme",
    size: 16,
    line: 1.4,
    tint: false,
    customTypography: false,
  },
  selection: { color: "auto", size: 15, line: 1.4, tint: false },
};
