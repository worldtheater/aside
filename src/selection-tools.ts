import { randomUUID } from "./uuid.js";
import { escapeHtml as escape } from "./html.js";
import { HoverTips } from "./hover-tips.js";
import brandMark from "../icons/brand-mark.svg";
import {
  hasOutputLanguage,
  hasDefaultInstructions,
  followsInstructionLanguage,
  requiresInstructions,
  DEFAULT_OUTPUT_LENGTH,
} from "./prompts.js";
import { MAX_ACTIONS, toolbarActions } from "./action-policy.js";
import { ModelError, hasDefaultModel } from "./providers.js";
import { request } from "./client.js";
import { hasSameLanguages } from "./translation.js";
import { resolveLocale } from "./locale.js";
import type { Action, ActionEdit, PublicConfig } from "./types.js";

const fields = (a: Action): ActionEdit => ({
  id: a.id,
  name: a.name,
  instruction: a.instruction,
  model: a.model,
  ...(a.kind === "qa"
    ? { outputLength: a.outputLength || DEFAULT_OUTPUT_LENGTH }
    : {}),
  ...(a.kind === "translate"
    ? { sourceLanguage: a.sourceLanguage, targetLanguage: a.targetLanguage }
    : hasOutputLanguage(a)
      ? { outputLanguage: a.outputLanguage || "interface" }
      : {}),
});

export function selectionResultMarkup(
  output: string,
  status: string,
  actions: string,
) {
  return `<div class="selection-result-body">${output}</div><div class="selection-result-footer"><div class="selection-result-meta">${status}</div>${actions}</div>`;
}

export function panelResizeButton(label: string, hidden = false) {
  return `<button type="button" class="selection-resize" aria-label="${escape(label)}" ${hidden ? "hidden" : ""}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m5 11 6-6m-2 6 2-2"/></svg></button>`;
}

// Selection and independent result panels share drag and resize behavior.
export function bindPanelGeometry(
  root: HTMLElement,
  dragHandle: string,
  move: (left: number, top: number) => void,
) {
  const resize = (width: number, height: number) => {
    const rect = root.getBoundingClientRect();
    root.style.setProperty(
      "--selection-panel-width",
      `${Math.min(Math.max(260, width), innerWidth - rect.left - 10)}px`,
    );
    root.style.setProperty(
      "--selection-panel-height",
      `${Math.min(Math.max(180, height), innerHeight - rect.top - 10)}px`,
    );
  };
  root.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    const resizing = Boolean(target.closest(".selection-resize:not([hidden])"));
    if (
      event.button !== 0 ||
      target.closest(".selection-tools,.panel.result") !== root ||
      (!resizing &&
        (!target.closest(dragHandle) ||
          target.closest("button,input,select,textarea")))
    )
      return;
    const start = root.getBoundingClientRect(),
      dx = event.clientX - start.left,
      dy = event.clientY - start.top;
    event.preventDefault();
    if (resizing) {
      // Fit the size before fixing the anchor: a preview can touch the window edge.
      resize(start.width, start.height);
      move(start.left, start.top);
    }
    root.setPointerCapture(event.pointerId);
    root.classList.add("selection-dragging");
    root.onpointermove = (pointer) => {
      if (resizing)
        resize(
          start.width + pointer.clientX - event.clientX,
          start.height + pointer.clientY - event.clientY,
        );
      else move(pointer.clientX - dx, pointer.clientY - dy);
    };
    const finish = () => {
      root.classList.remove("selection-dragging");
      root.onpointermove =
        root.onpointerup =
        root.onpointercancel =
        root.onlostpointercapture =
          null;
      if (root.hasPointerCapture(event.pointerId))
        root.releasePointerCapture(event.pointerId);
    };
    root.onpointerup =
      root.onpointercancel =
      root.onlostpointercapture =
        finish;
  });
  root.addEventListener("keydown", (event) => {
    if (
      (event.target as HTMLElement).closest(
        ".selection-tools,.panel.result",
      ) === root &&
      (event.target as HTMLElement).closest(".selection-resize") &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const rect = root.getBoundingClientRect(),
        step = event.shiftKey ? 40 : 10;
      resize(
        rect.width +
          (event.key === "ArrowRight"
            ? step
            : event.key === "ArrowLeft"
              ? -step
              : 0),
        rect.height +
          (event.key === "ArrowDown"
            ? step
            : event.key === "ArrowUp"
              ? -step
              : 0),
      );
      move(rect.left, rect.top);
    }
  });
}

// Only webpage text is executable; text selected inside controls or extension UI is not.
export function selectedPageText(scope: Node | null = document): string {
  const selection = getSelection();
  if (
    !scope ||
    !selection ||
    selection.isCollapsed ||
    !scope.contains(selection.anchorNode) ||
    !scope.contains(selection.focusNode)
  )
    return "";
  const excluded =
    "input,textarea,select,[contenteditable]:not([contenteditable=false]),.selection-tools,[data-pagework]";
  if (
    [selection.anchorNode, selection.focusNode].some((node) =>
      (node instanceof Element ? node : node?.parentElement)?.closest(excluded),
    )
  )
    return "";
  return selection.toString().trim();
}

// The injected toolbar and web preview share the same editing and save behavior.
export class SelectionTools {
  private drafts: Action[] | null = null;
  private originals = new Map<string, string>();
  private selected = "";
  private expanded = false;
  private busy = false;
  private error = "";
  private tips: HoverTips;
  private result: { element: HTMLElement; actionId: string } | null = null;

  constructor(
    private root: HTMLElement,
    private options: {
      config(): PublicConfig;
      selected(): string;
      icon(name: string): string;
      selection(): string;
      run(id: string, text: string): Promise<void>;
      dismissResult(): void;
      pinned(): boolean;
      togglePin(): void;
      move?(left: number, top: number): void;
      home(): void | Promise<void>;
      saved(config: PublicConfig, selected: string): void;
      layout?(): void;
      error(caught: unknown): string;
    },
  ) {
    this.tips = new HoverTips(
      root,
      ".selection-toolbar-row .selection-button:not([data-selection-command=close]),.selection-result-actions button,.selection-resize",
      () => !root.classList.contains("selection-dragging"),
    );
    if (this.options.move)
      bindPanelGeometry(
        root,
        ".selection-draggable .selection-toolbar-row",
        this.options.move,
      );
    // Toolbar clicks must not replace the page selection. Form controls still
    // receive their normal pointer behavior so they can be edited.
    root.addEventListener("mousedown", (event) => {
      if (
        event.button === 0 &&
        !(event.target as HTMLElement).closest(
          "input,textarea,select,.select-trigger,.selection-result-body",
        )
      )
        event.preventDefault();
    });
    root.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-selection-command]",
      );
      if (!event.isTrusted || !button) return;
      event.stopPropagation();
      void this.click(button).catch((caught) => {
        this.error = this.options.error(caught);
        this.render();
      });
    });
    const change = (event: Event) => {
      const input = event.target as HTMLInputElement;
      if (!input.dataset.selectionField || !this.drafts || this.busy) return;
      const draft = this.drafts.find((a) => a.id === this.selected)!;
      Object.assign(draft, { [input.dataset.selectionField]: input.value });
      this.error = "";
      const error = root.querySelector<HTMLElement>(".selection-error");
      if (error) error.hidden = true;
      if (
        input.dataset.selectionField === "targetLanguage" ||
        input.dataset.selectionField === "outputLanguage"
      )
        this.render();
    };
    root.addEventListener("input", change);
    root.addEventListener("focusin", () => this.updateSelection());
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || (!this.drafts && !this.expanded)) return;
      event.stopPropagation();
      event.preventDefault();
      if (this.busy) return;
      if (this.visibleResultAction()) {
        void this.click(
          this.root.querySelector<HTMLButtonElement>(
            "[data-selection-command=close]",
          )!,
        );
        return;
      }
      if (this.drafts) {
        this.drafts = null;
        this.selected = this.options.selected();
      } else this.expanded = false;
      this.error = "";
      this.render();
      root
        .querySelector<HTMLButtonElement>(
          this.expanded
            ? "[data-selection-command=settings]"
            : "[data-selection-command=expand]",
        )
        ?.focus();
    });
    this.reset();
  }

  refreshTips() {
    this.tips.refresh();
  }

  destroy() {
    this.tips.destroy();
  }

  updatePin() {
    const button = this.root.querySelector<HTMLButtonElement>(
      "[data-selection-command=pin]",
    );
    if (!button) return;
    button.hidden = !this.visibleResultAction();
    button.setAttribute("aria-pressed", String(this.options.pinned()));
    button.setAttribute(
      "aria-label",
      this.options.pinned()
        ? this.options.config().strings.unpin
        : this.options.config().strings.pin,
    );
  }

  reset() {
    this.drafts = null;
    this.expanded = Boolean(this.visibleResultAction());
    this.error = "";
    this.selected = this.options.selected();
    this.render();
  }

  setResult(result: HTMLElement | null) {
    this.result = result
      ? { element: result, actionId: this.options.selected() }
      : null;
    this.drafts = null;
    if (result) this.expanded = true;
    this.selected = this.options.selected();
    this.render();
  }

  updateResultVisibility() {
    const slot = this.root.querySelector<HTMLElement>(".selection-result-slot");
    if (!slot) return;
    slot.hidden =
      !this.result || this.result.element.hidden || Boolean(this.drafts);
    this.root.classList.toggle("selection-showing-result", !slot.hidden);
    this.root.classList.toggle(
      "selection-draggable",
      Boolean(this.options.move) &&
        Boolean(this.drafts || this.expanded || !slot.hidden),
    );
    this.root.querySelector<HTMLButtonElement>(
      "[data-selection-command=close]",
    )!.hidden = slot.hidden;
    const collapse = this.root.querySelector<HTMLButtonElement>(
      "[data-selection-command=collapse]",
    );
    if (collapse) collapse.hidden = !slot.hidden;
    const resizable =
      Boolean(this.options.move) && Boolean(this.drafts || !slot.hidden);
    this.root.classList.toggle("selection-resizable", resizable);
    const resize =
      this.root.querySelector<HTMLButtonElement>(".selection-resize");
    if (resize) {
      resize.hidden = !resizable;
      const footer = this.drafts
        ? this.root.querySelector(":scope > .selection-settings-footer")
        : this.result?.element.querySelector(
            ".selection-settings-footer,.selection-result-footer",
          );
      footer?.append(resize);
    }
    this.updatePin();
    this.updateSelection();
    this.options.layout?.();
  }

  private visibleResultAction() {
    return !this.drafts && this.result && !this.result.element.hidden
      ? this.result.actionId
      : "";
  }

  updateSelection() {
    const source = this.options.selection(),
      active = this.visibleResultAction(),
      needsSetup =
        !hasDefaultModel(this.options.config()) &&
        !this.root.closest("[inert]");
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-selection-command=action]")
      .forEach((button) => {
        const isResult = button.dataset.selectionAction === active;
        button.disabled =
          needsSetup || this.busy || (!this.drafts && !source && !isResult);
        if (!this.drafts) {
          if (isResult) button.setAttribute("aria-pressed", "true");
          else button.removeAttribute("aria-pressed");
        }
      });
    this.tips.refresh();
  }

  private begin() {
    this.expanded = true;
    if (this.drafts) return;
    this.drafts = structuredClone(this.options.config().actions);
    this.originals = new Map(
      this.drafts.map((a) => [a.id, JSON.stringify(fields(a))]),
    );
    if (!this.drafts.some((a) => a.id === this.selected))
      this.selected = this.drafts[0]?.id || "";
  }

  private async click(button: HTMLButtonElement) {
    const command = button.dataset.selectionCommand!;
    // Navigation remains available while processing or saving toolbar settings.
    if (command === "home") {
      await this.options.home();
      return;
    }
    if (this.busy || button.disabled) return;
    this.error = "";
    if (command === "action") {
      // Check again during the click: selectionchange can arrive after the click event.
      this.updateSelection();
      const actionId = button.dataset.selectionAction!;
      const action = this.options
        .config()
        .actions.find((item) => item.id === actionId);
      if (actionId === this.visibleResultAction() && action?.kind !== "qa") {
        this.options.dismissResult();
        return;
      }
      const source = this.options.selection();
      if (!this.drafts && !source) return;
      this.selected = actionId;
      if (!this.drafts) {
        await this.options.run(this.selected, source);
        return;
      }
    } else if (command === "close") {
      if (this.result && !this.result.element.hidden) {
        if (this.options.pinned()) this.options.togglePin();
        this.options.dismissResult();
      }
      this.reset();
      this.root.hidden = true;
      return;
    } else if (command === "pin") {
      this.options.togglePin();
      this.updatePin();
      return;
    } else if (command === "expand") this.expanded = true;
    else if (command === "collapse") this.expanded = false;
    else if (command === "settings") {
      this.begin();
    } else if (command === "cancel") {
      this.drafts = null;
      this.selected = this.options.selected();
    } else if (command === "add") {
      if ((this.drafts || this.options.config().actions).length >= MAX_ACTIONS)
        throw new ModelError("actionLimit");
      this.begin();
      const draft: Action = {
        id: randomUUID(),
        name: "",
        instruction: "",
        model: "default",
        kind: "custom",
        icon: "spark",
        mode: "whole",
        placement: "panel",
        quick: false,
      };
      this.drafts!.push(draft);
      this.selected = draft.id;
    } else if (command === "save") {
      await this.save();
      return;
    }
    this.render();
    const focus =
      command === "add"
        ? "[data-selection-field]:not([hidden]), .select-trigger"
        : command === "settings"
          ? `[data-selection-action="${this.selected}"]`
          : command === "cancel"
            ? "[data-selection-command=settings]"
            : command === "action"
              ? `[data-selection-action="${this.selected}"]`
              : command === "expand"
                ? "[data-selection-command=collapse]"
                : command === "collapse"
                  ? "[data-selection-command=expand]"
                  : `[data-selection-command="${command}"]`;
    (
      this.root.querySelector<HTMLElement>(focus) ||
      this.root.querySelector<HTMLElement>(
        "[data-selection-field]:not([hidden]), .select-trigger",
      )
    )?.focus();
  }

  private async save() {
    if (!this.drafts) return;
    const S = this.options.config().strings;
    const changes = this.drafts.filter(
      (a) => JSON.stringify(fields(a)) !== this.originals.get(a.id),
    );
    for (const action of changes) {
      const error =
        !action.name.trim() ||
        (requiresInstructions(action) && !action.instruction.trim())
          ? S.requiredAction
          : hasSameLanguages(
                action,
                resolveLocale(this.options.config().preferences.locale),
              )
            ? S.errors.sameLanguages
            : "";
      if (error) {
        this.selected = action.id;
        this.error = error;
        this.render();
        return;
      }
    }
    this.busy = true;
    this.render();
    try {
      if (changes.length) {
        const config = await request("actions.save", {
          changes: changes.map((a) => ({
            ...fields(a),
            create: !this.originals.has(a.id),
          })),
        });
        this.options.saved(config, this.selected);
      }
      this.drafts = null;
      this.expanded = false;
    } catch (caught) {
      this.error = this.options.error(caught);
    } finally {
      this.busy = false;
      this.render();
      this.root
        .querySelector<HTMLElement>(
          this.drafts
            ? "[data-selection-command=save]"
            : "[data-selection-command=expand]",
        )
        ?.focus();
    }
  }

  render() {
    this.root.querySelector(".selection-resize")?.remove();
    this.tips.hide(true);
    const config = this.options.config(),
      S = config.strings,
      needsSetup = !hasDefaultModel(config) && !this.root.closest("[inert]");
    const actions = this.drafts || config.actions;
    const active = actions.find((a) => a.id === this.selected);
    const visibleActions = toolbarActions(actions, this.expanded);
    this.root.style.setProperty(
      "--selection-action-count",
      String(visibleActions.length),
    );
    const glyph = this.options.icon;
    const button = (command: string, label: string, name = "", attrs = "") =>
      `<button type="button" class="selection-button${name ? "" : " selection-text-button"}" data-selection-command="${command}" ${attrs} aria-label="${escape(label)}" ${this.busy || needsSetup ? "disabled" : ""}>${name ? glyph(name) : escape(label)}</button>`;
    const actionButton = (a: Action) =>
      button(
        "action",
        a.name || S.addAction,
        a.icon,
        `data-op="selection-run" data-id="${escape(a.id)}" data-selection-action="${escape(a.id)}"${this.drafts ? ` aria-pressed="${a.id === this.selected}"` : ""}`,
      );
    this.root.classList.toggle(
      "selection-expanded",
      Boolean(this.drafts || this.expanded),
    );
    this.root.classList.toggle("selection-editing", Boolean(this.drafts));
    this.root.setAttribute("aria-busy", String(this.busy));
    // Keep the toolbar and extra-controls container mounted so both entering and
    // leaving controls can transition, including rapid expand/collapse changes.
    let toolbar = this.root.querySelector<HTMLElement>(
      ".selection-toolbar-row",
    );
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "selection-toolbar-row";
      toolbar.innerHTML = `<button type="button" class="selection-brand selection-button" data-selection-command="home">${brandMark}</button><div class="selection-actions"></div><span class="selection-spacer"></span><div class="selection-controls"><div class="selection-extra-controls"></div><div class="selection-primary-controls"></div></div>`;
      this.root.prepend(toolbar);
    }
    const brand = toolbar.querySelector<HTMLButtonElement>(".selection-brand")!;
    brand.setAttribute("aria-label", needsSetup ? S.settings : S.openHome);
    brand.disabled = false;
    toolbar.querySelector(".selection-actions")!.innerHTML = visibleActions
      .map(actionButton)
      .join("");
    const extras = toolbar.querySelector<HTMLElement>(
      ".selection-extra-controls",
    )!;
    extras.inert = !this.expanded || Boolean(this.drafts);
    extras.setAttribute("aria-hidden", String(extras.inert));
    extras.innerHTML =
      button(
        "add",
        actions.length >= MAX_ACTIONS ? S.errors.actionLimit : S.addAction,
        "plus",
        actions.length >= MAX_ACTIONS ? "disabled" : "",
      ) + button("settings", S.settings, "settings");
    const controls = this.drafts
      ? ""
      : this.expanded
        ? button(
            "collapse",
            S.collapseToolbar,
            "collapse",
            'aria-expanded="true" aria-pressed="true"',
          )
        : button("expand", S.expandToolbar, "expand", 'aria-expanded="false"');
    toolbar.querySelector(".selection-primary-controls")!.innerHTML =
      `${controls}
      ${button("pin", this.options.pinned() ? S.unpin : S.pin, "pin", "hidden")}
      ${button("close", S.close, "close", "hidden")}`;
    for (const child of [...this.root.children]) {
      if (child !== toolbar) child.remove();
    }
    this.root.insertAdjacentHTML(
      "beforeend",
      `
      <div class="selection-result-slot" hidden></div>
      ${this.drafts && active ? this.editor(active, config) : ""}
      <p class="selection-error" role="alert" ${this.error ? "" : "hidden"}>${escape(this.error)}</p>
      ${this.drafts ? `<div class="selection-settings-footer">${button("cancel", S.cancel)}${button("save", S.save)}</div>` : ""}
      ${this.options.move ? panelResizeButton(S.resizePanel, true) : ""}`,
    );
    this.root.append(this.tips.element);
    if (this.result)
      this.root
        .querySelector(".selection-result-slot")!
        .append(this.result.element);
    this.updateResultVisibility();
    this.updateSelection();
    this.tips.setHint(needsSetup ? brand : null, S.configureModelHint);
    const selectedAction = this.root.querySelector<HTMLElement>(
      ".selection-actions [aria-pressed=true]",
    );
    if (selectedAction) {
      const strip = selectedAction.parentElement!;
      strip.scrollLeft = Math.max(
        0,
        selectedAction.offsetLeft +
          selectedAction.offsetWidth -
          strip.clientWidth,
      );
    }
  }

  private editor(a: Action, config: PublicConfig) {
    const S = config.strings;
    const instructionLabel = followsInstructionLanguage(a)
      ? S.additionalInstructionsRequired
      : hasDefaultInstructions(a)
        ? S.additionalInstructions
        : S.instruction;
    const instructionPlaceholder = followsInstructionLanguage(a)
      ? S.instructionLanguageHint
      : hasDefaultInstructions(a)
        ? S.additionalInstructionsPlaceholder
        : "";
    const options = (entries: [string, string][], value: string | undefined) =>
      entries
        .map(
          ([id, label]) =>
            `<option value="${escape(id)}" ${id === value ? "selected" : ""}>${escape(label)}</option>`,
        )
        .join("");
    const select = (
      field: string,
      label: string,
      entries: [string, string][],
      value: string | undefined,
    ) =>
      `<label><span class="field-label">${escape(label)}</span><span class="selection-select"><select data-selection-field="${field}" aria-label="${escape(label)}" ${this.busy ? "disabled" : ""}>${options(entries, value)}</select></span></label>`;
    const defaultModel = config.connections.find(
      (c) => c.id === config.defaultConnection,
    )?.model;
    return `<div class="selection-settings">
      ${this.originals.has(a.id) ? `<strong class="selection-action-name">${escape(a.name)}</strong>` : `<label><span class="field-label">${escape(S.actionName)}</span><input data-selection-field="name" aria-label="${escape(S.actionName)}" value="${escape(a.name)}" ${this.busy ? "disabled" : ""}></label>`}
      ${
        a.kind === "translate"
          ? `<div class="selection-languages">${select("sourceLanguage", S.sourceLanguage, Object.entries(S.languages), a.sourceLanguage)}${select(
              "targetLanguage",
              S.targetLanguage,
              [
                ["interface", S.followInterfaceLanguage],
                ["instruction", S.followInstructionLanguage],
                ...Object.entries(S.languages).filter(([id]) => id !== "auto"),
              ],
              a.targetLanguage,
            )}</div>`
          : hasOutputLanguage(a)
            ? select(
                "outputLanguage",
                S.outputLanguage,
                [
                  ["interface", S.followInterfaceLanguage],
                  ["instruction", S.followInstructionLanguage],
                  ...Object.entries(S.languages).filter(
                    ([id]) => id !== "auto",
                  ),
                ],
                a.outputLanguage || "interface",
              )
            : ""
      }
      ${a.kind === "qa" ? select("outputLength", S.outputLength, Object.entries(S.outputLengths), a.outputLength || DEFAULT_OUTPUT_LENGTH) : ""}
      ${select("model", S.model, [["default", `${S.defaultModel}${defaultModel ? ` · ${defaultModel}` : ""}`], ...config.connections.filter((c) => c.connected && c.protocol !== "typesafe").map((c) => [c.id!, `${c.name} · ${c.model}`] as [string, string])], a.model)}
      <label><span class="field-label">${escape(instructionLabel)}</span><textarea rows="4" data-selection-field="instruction" aria-label="${escape(instructionLabel)}" placeholder="${escape(instructionPlaceholder)}" ${this.busy ? "disabled" : ""}>${escape(a.instruction)}</textarea></label>
    </div>`;
  }
}
