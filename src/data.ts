import type {
  Action,
  Sample,
  AppearanceTarget,
  DisplayStyle,
} from "./types.js";
import { C, locale } from "./copy.js";
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
        targetLanguage: locale === "zh-CN" ? "zh-Hans" : "en",
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
        id: "summary",
        icon: "list",
        mode: "whole",
        placement: "panel",
        quick: false,
        kind: "summary",
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
  category: "FIELD NOTES / 004",
  paragraphs: [
    "Reading is not simply the act of collecting information. It is a conversation between what we already know and what we are trying to understand.",
    "A useful note does more than repeat a sentence. It connects an idea to a question, an experience, or another idea. Those connections make knowledge easier to recall and use.",
    "Before highlighting a paragraph, pause and ask: what changed in my understanding? Write that change in your own words. A small, precise note is often more valuable than a page of copied text.",
  ],
  translations: [
    "阅读不只是收集信息的过程。它是我们已有的知识与正在尝试理解的事物之间的一场对话。",
    "有用的笔记不仅仅是复述一句话。它把一个想法与某个问题、一段经历或另一个想法联系起来。这些联系让知识更容易被记住和运用。",
    "在标记一段文字之前，先停下来问问自己：我的理解发生了什么变化？用自己的话写下这个变化。一则简短而准确的笔记，往往比一整页抄录更有价值。",
  ],
};
export const defaultAppearance: Record<AppearanceTarget, DisplayStyle> = {
  page: {
    color: "auto",
    size: 16,
    line: 1.4,
    tint: false,
    customTypography: false,
  },
  selection: { color: "auto", size: 15, line: 1.4, tint: false },
};
