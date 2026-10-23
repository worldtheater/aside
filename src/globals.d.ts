import type { ExtractedBlock, UiContext } from "./types.js";
declare global {
  // Navigation API is available in supported Chrome versions but absent from
  // this TypeScript DOM library.
  interface Window {
    readonly navigation: EventTarget;
  }
  var __asideLights: boolean | undefined;
  var PageworkExtract: {
    extract(scope?: string, within?: HTMLElement): ExtractedBlock[];
    context(element: HTMLElement, text: string): UiContext | undefined;
  };
  var __pagework: Promise<void> | undefined;
}
export {};
