import { processRequest } from "./client.js";
import { escapeHtml as escape } from "./html.js";
import { HoverTips } from "./hover-tips.js";
import { resolveLocale } from "./locale.js";
import { renderMarkdown } from "./result-content.js";
import {
  bindPanelGeometry,
  panelResizeButton,
  selectionResultMarkup,
} from "./selection-tools.js";
import { hasSameLanguages } from "./translation.js";
import { icon } from "./ui.js";
import type {
  Action,
  ProcessJob,
  PublicConfig,
  TranslationLanguages,
} from "./types.js";

// Arbitrary text stays in this panel; it is never extracted from the page.
export class TextTranslationPanel {
  readonly element = document.createElement("section");
  private actionId = "";
  private job: ProcessJob | null = null;
  private text = "";
  private tips: HoverTips;

  constructor(
    private options: {
      config(): PublicConfig;
      error(error: unknown): string;
      notify(message: string): void;
    },
  ) {
    const panel = this.element;
    panel.id = "text-translation";
    panel.className = "panel result text-translation";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "text-translation-title");
    this.tips = new HoverTips(
      panel,
      ".selection-button,.selection-result-actions button,.selection-resize",
    );
    bindPanelGeometry(panel, ".header", (left, top) =>
      this.position(left, top),
    );
    const edit = () => {
      this.text = "";
      this.renderOutput("");
      this.status("");
      this.updateControls();
    };
    panel.addEventListener("input", edit);
    panel.addEventListener("change", edit);
    panel.addEventListener("keydown", (event) => {
      if (!event.isTrusted || event.isComposing || event.repeat) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
      } else if (
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        void this.translate();
      }
    });
    panel.addEventListener("click", async (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-text-command]",
      );
      if (!event.isTrusted || !button || button.disabled) return;
      event.stopPropagation();
      switch (button.dataset.textCommand) {
        case "close":
          this.close();
          break;
        case "run":
          void this.translate();
          break;
        case "stop":
          this.cancel();
          this.status(this.options.config().strings.errors.cancelled);
          this.updateControls();
          break;
        case "copy":
          try {
            await navigator.clipboard.writeText(this.text);
            this.options.notify(this.options.config().strings.copied);
          } catch (error) {
            this.status(this.options.error(error), true);
          }
          break;
      }
    });
  }

  private get input() {
    return this.element.querySelector<HTMLTextAreaElement>("textarea")!;
  }
  private get action() {
    return this.options
      .config()
      .actions.find(
        (action) => action.id === this.actionId && action.kind === "translate",
      );
  }
  private get languages(): TranslationLanguages {
    return {
      sourceLanguage: this.element.querySelector<HTMLSelectElement>(
        "[data-text-language=sourceLanguage]",
      )!.value,
      targetLanguage: this.element.querySelector<HTMLSelectElement>(
        "[data-text-language=targetLanguage]",
      )!.value,
    };
  }
  private command(name: string) {
    return this.element.querySelector<HTMLButtonElement>(
      `[data-text-command=${name}]`,
    )!;
  }
  private status(text: string, error = false) {
    const status = this.element.querySelector<HTMLElement>(
      ".text-translation-status",
    )!;
    status.textContent = text;
    status.classList.toggle("error", error);
  }

  open(action: Action) {
    if (!this.element.hidden) {
      (this.job ? this.command("stop") : this.input).focus({
        preventScroll: true,
      });
      return;
    }
    this.cancel();
    this.actionId = action.id;
    this.text = "";
    const S = this.options.config().strings;
    const languages = (["sourceLanguage", "targetLanguage"] as const)
      .map((field) => {
        const value =
          field === "sourceLanguage"
            ? "auto"
            : action.targetLanguage || "interface";
        const choices =
          field === "sourceLanguage"
            ? Object.entries(S.languages)
            : [
                ["interface", S.followInterfaceLanguage],
                ...(action.instruction.trim()
                  ? [["instruction", S.followInstructionLanguage]]
                  : []),
                ...Object.entries(S.languages).filter(
                  ([code]) => code !== "auto",
                ),
              ];
        return `<label><span class="field-label">${escape(S[field])}</span><span class="selection-select"><select data-text-language="${field}">${choices.map(([code, label]) => `<option value="${escape(code)}" ${code === value ? "selected" : ""}>${escape(label)}</option>`).join("")}</select></span></label>`;
      })
      .join("");
    this.element.innerHTML = `<div class="header"><strong id="text-translation-title">${escape(S.textTranslation)}</strong><button class="selection-button" data-text-command="close" aria-label="${escape(S.close)}">${icon("close")}</button></div>
      <div class="selection-settings text-translation-form">
        <div class="selection-languages">${languages}</div>
        <label><span class="field-label">${escape(S.source)}</span><textarea placeholder="${escape(S.textTranslationPlaceholder)}"></textarea></label>
      </div>
      <div class="text-translation-heading">${escape(S.output)}</div>
      ${selectionResultMarkup(
        `<div class="output" hidden></div><p class="text-translation-empty">${escape(S.textTranslationEmpty)}</p>`,
        '<span class="selection-result-status text-translation-status" role="status"></span>',
        `<div class="selection-result-actions"><button class="icon" data-text-command="copy" aria-label="${escape(S.copy)}" disabled>${icon("copy")}</button></div><button class="selection-button selection-text-button" data-text-command="stop" hidden>${escape(S.stop)}</button><button class="selection-button selection-text-button" data-text-command="run" aria-keyshortcuts="Meta+Enter Control+Enter" disabled>${escape(S.translateText)}</button>${panelResizeButton(S.resizePanel)}`,
      )}`;
    this.element.append(this.tips.element);
    this.element.style.cssText = "";
    this.element.hidden = false;
    const rect = this.element.getBoundingClientRect();
    this.position(
      (innerWidth - rect.width) / 2,
      (innerHeight - rect.height) / 2,
    );
    this.updateControls();
    this.input.focus();
  }

  private updateControls() {
    const busy = Boolean(this.job),
      S = this.options.config().strings;
    const same = hasSameLanguages(
      { ...this.action, ...this.languages },
      resolveLocale(this.options.config().preferences.locale),
    );
    this.input.disabled = busy;
    this.element
      .querySelectorAll<HTMLSelectElement>("select")
      .forEach((select) => {
        select.disabled = busy;
      });
    this.command("run").hidden = busy;
    this.command("run").disabled =
      busy || !this.action || !this.input.value.trim() || same;
    this.command("stop").hidden = !busy;
    this.command("copy").disabled = busy || !this.text;
    this.element
      .querySelector(".output")!
      .setAttribute("aria-busy", String(busy));
    if (!busy && same) this.status(S.errors.sameLanguages, true);
    else if (
      !busy &&
      this.element.querySelector(".text-translation-status")!.textContent ===
        S.errors.sameLanguages
    )
      this.status("");
  }

  private renderOutput(text: string) {
    const output = this.element.querySelector<HTMLElement>(".output")!;
    const scroller = output.parentElement!;
    const follow =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32;
    output.hidden = !text;
    this.element.querySelector<HTMLElement>(".text-translation-empty")!.hidden =
      Boolean(text);
    renderMarkdown(output, text);
    if (follow) scroller.scrollTop = scroller.scrollHeight;
  }

  private async translate() {
    if (this.element.hidden || this.job || this.command("run").disabled) return;
    const S = this.options.config().strings;
    let job: ProcessJob | null = null;
    let draft = "";
    this.text = "";
    this.renderOutput("");
    this.status(S.processing);
    try {
      job = processRequest(
        {
          source: "text",
          actionId: this.actionId,
          translation: this.languages,
          stream: true,
          blocks: [{ id: "text", text: this.input.value.trim() }],
        },
        undefined,
        (_id, delta) => {
          if (this.job !== job) return;
          draft += delta;
          this.renderOutput(draft);
        },
      );
      this.job = job;
      this.updateControls();
      const result = await job.promise;
      if (this.job !== job) return;
      this.text = result.parts.map((part) => part.text).join("\n\n");
      this.renderOutput(this.text);
      this.status(S.done);
    } catch (error) {
      if (this.job === job) this.status(this.options.error(error), true);
    } finally {
      if (this.job === job) {
        this.job = null;
        this.updateControls();
      }
    }
  }

  private cancel() {
    const job = this.job;
    this.job = null;
    job?.cancel();
  }
  close() {
    this.cancel();
    this.element.hidden = true;
    this.tips.hide();
  }
  position(left?: number, top?: number) {
    if (this.element.hidden) return;
    const rect = this.element.getBoundingClientRect();
    this.element.style.left = `${Math.max(12, Math.min(innerWidth - rect.width - 12, left ?? rect.left))}px`;
    this.element.style.top = `${Math.max(12, Math.min(innerHeight - rect.height - 12, top ?? rect.top))}px`;
    this.element.style.right = this.element.style.bottom = "auto";
  }
  destroy() {
    this.close();
    this.tips.destroy();
    this.element.remove();
  }
}
