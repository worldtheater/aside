import { C, locale } from "./copy.js";
import { LOCALES } from "./locale.js";
import { enhanceSelects, syncSelects } from "./controls.js";
import { isEdge, isSafari, supportsNativeLanguagePacks } from "./browser.js";
import { escapeHtml as e } from "./html.js";
import { icon, iconButton, selected } from "./ui.js";
import { modelError } from "./providers.js";
import { trackNativePacks } from "./native-pack-channel.js";
import {
  nativePackId,
  nativePackName,
  nativePackStatus,
} from "./native-packs.js";
import type {
  NativePack,
  NativePackProgress,
  NativePackSnapshot,
} from "./native-packs.js";
import {
  hasNativeTranslation,
  nativeLanguage,
  nativePackAvailability,
  prepareNativePack,
} from "./native-translation.js";
import type { Availability } from "./native-translation.js";

// Readiness is scoped to this document's origin. History is evidence of prior
// preparation, not an inventory of the browser's installed language models.
export class LanguagePacksPage {
  private root: HTMLElement | null = null;
  private port: chrome.runtime.Port | null = null;
  private snapshot: NativePackSnapshot = { records: [], active: [] };
  private availability = new Map<string, Availability | "unknown">();
  private checking = new Set<string>();
  private jobs = new Map<string, AbortController>();
  private progress = new Map<string, NativePackProgress>();
  private errors = new Map<string, string>();
  private source = "en";
  private target = "";

  private refreshAvailability = () => {
    if (document.visibilityState !== "visible" || !this.root) return;
    this.availability.clear();
    this.renderList();
  };

  mount(root: HTMLElement) {
    this.unmount();
    this.root = root;
    this.availability.clear();
    const P = C.real.translation.packs;
    // Chrome exposes uninstall only in its own management page, not the API.
    const canManage =
      supportsNativeLanguagePacks &&
      !isEdge &&
      !isSafari &&
      hasNativeTranslation();
    this.target ||= nativeLanguage(LOCALES[locale].output);
    const languages = [
      ...new Map(
        Object.entries(C.languages)
          .filter(([code]) => code !== "auto")
          .map(([code, name]) => [nativeLanguage(code), name]),
      ).entries(),
    ];
    const options = (value: string) =>
      languages
        .map(
          ([code, name]) =>
            `<option value="${e(code)}"${selected(code, value)}>${e(name)}</option>`,
        )
        .join("");
    root.innerHTML = `<div class="pack-prepare"><div class="pack-language-fields translation-fields"><label class="field"><span class="field-label">${e(C.sourceLanguage)}</span><select data-pack-language="source" data-search="false">${options(this.source)}</select></label>${iconButton(C.swapLanguages, "pack-swap-languages", "swap")}<label class="field"><span class="field-label">${e(C.targetLanguage)}</span><select data-pack-language="target" data-search="false">${options(this.target)}</select></label></div><button type="button" class="btn primary" data-pack-prepare>${icon("down")}${e(P.prepare)}</button></div><p class="field-note pack-unavailable" ${hasNativeTranslation() ? "hidden" : ""}>${e(C.real.errors.translationUnavailable)}</p><div class="pack-list"></div><details class="advanced help-details pack-help"><summary>${e(P.helpTitle)}</summary><div class="advanced-body"><ul class="help-list">${P.help.map((item) => `<li>${e(item)}</li>`).join("")}${canManage ? `<li><button type="button" class="pack-remove" data-pack-remove>${e(P.remove)}</button> ${e(P.removeHint)}</li>` : ""}</ul></div></details>`;
    root
      .querySelectorAll<HTMLSelectElement>("[data-pack-language]")
      .forEach((select) =>
        select.addEventListener("change", () => {
          if (select.dataset.packLanguage === "source")
            this.source = select.value;
          else this.target = select.value;
          this.updatePrepare();
        }),
      );
    root.querySelector("[data-pack-prepare]")!.addEventListener(
      "click",
      () =>
        void this.prepare({
          kind: "translator",
          sourceLanguage: this.source,
          targetLanguage: this.target,
        }),
    );
    root.querySelector(".pack-list")!.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-pack-id]",
      );
      if (!button) return;
      const id = button.dataset.packId!;
      if (this.jobs.has(id)) {
        this.jobs.get(id)!.abort();
        return;
      }
      const pack = this.packs().find((pack) => nativePackId(pack) === id);
      if (pack) void this.prepare(pack);
    });
    root
      .querySelector('[data-op="pack-swap-languages"]')!
      .addEventListener("click", () => {
        [this.source, this.target] = [this.target, this.source];
        root.querySelector<HTMLSelectElement>(
          '[data-pack-language="source"]',
        )!.value = this.source;
        root.querySelector<HTMLSelectElement>(
          '[data-pack-language="target"]',
        )!.value = this.target;
        syncSelects(root);
        this.updatePrepare();
      });
    root.querySelector("[data-pack-remove]")?.addEventListener("click", () => {
      void chrome.tabs.create({
        url: "chrome://on-device-translation-internals/",
      });
    });
    document.addEventListener("visibilitychange", this.refreshAvailability);
    enhanceSelects(root);
    const port = chrome.runtime.connect({ name: "native-packs" });
    this.port = port;
    port.onMessage.addListener((snapshot: NativePackSnapshot) => {
      if (this.port !== port) return;
      for (const record of snapshot.records) {
        if (
          record.readyAt !==
          this.snapshot.records.find(
            (item) => nativePackId(item.pack) === nativePackId(record.pack),
          )?.readyAt
        )
          this.availability.delete(nativePackId(record.pack));
      }
      for (const event of this.snapshot.active) {
        if (
          !snapshot.active.some(
            (item) => nativePackId(item.pack) === nativePackId(event.pack),
          )
        )
          this.availability.delete(nativePackId(event.pack));
      }
      this.snapshot = snapshot;
      this.renderList();
    });
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
    });
    port.postMessage("watch");
    this.renderList();
  }
  unmount() {
    document.removeEventListener("visibilitychange", this.refreshAvailability);
    this.port?.disconnect();
    this.port = null;
    this.root = null;
  }
  private packs(): NativePack[] {
    return [
      ...new Map<string, NativePack>([
        ["detector", { kind: "detector" }],
        ...this.snapshot.records.map(({ pack }): [string, NativePack] => [
          nativePackId(pack),
          pack,
        ]),
        ...[...this.progress.values(), ...this.snapshot.active].map(
          ({ pack }): [string, NativePack] => [nativePackId(pack), pack],
        ),
      ]).values(),
    ];
  }
  private updatePrepare() {
    const button = this.root?.querySelector<HTMLButtonElement>(
      "[data-pack-prepare]",
    );
    if (button)
      button.disabled =
        !hasNativeTranslation() ||
        this.source === this.target ||
        this.jobs.has(`${this.source}:${this.target}`);
  }
  private async check(pack: NativePack) {
    const id = nativePackId(pack);
    this.checking.add(id);
    try {
      this.availability.set(id, await nativePackAvailability(pack));
    } catch {
      this.availability.set(id, "unknown");
    } finally {
      this.checking.delete(id);
      this.renderList();
    }
  }
  private renderList() {
    if (!this.root?.isConnected) return;
    const P = C.real.translation.packs;
    this.root.querySelector(".pack-list")!.innerHTML = this.packs()
      .map((pack) => {
        const id = nativePackId(pack);
        const live =
          this.progress.get(id) ||
          this.snapshot.active.find((item) => nativePackId(item.pack) === id);
        const busy =
          live && ["checking", "downloading", "preparing"].includes(live.state);
        const availability = this.availability.get(id);
        const ready =
          availability === "available" ||
          this.progress.get(id)?.state === "ready";
        const error = this.errors.get(id);
        // Keep current operations visible, but do not present history as installed packs.
        if (!ready && !busy && !error) return "";
        const status =
          error || (live ? nativePackStatus(live, P.states) : P.states.ready);
        const ownJob = this.jobs.has(id);
        return `<div class="pack-row" data-pack-row="${e(id)}"><div class="pack-description"><span class="pack-name">${e(nativePackName(pack, C.languages, P.detector))}</span><span class="pack-status ${this.errors.has(id) ? "error-text" : ""}" role="status">${e(status)}</span>${busy ? `<progress max="1" ${live.progress !== undefined ? `value="${live.progress}"` : ""} aria-label="${e(status)}"></progress>` : ""}</div>${ready && !ownJob ? `<span class="pack-ready" aria-label="${e(P.states.ready)}">${icon("check")}</span>` : `<button type="button" class="btn ghost compact" data-pack-id="${e(id)}" ${!ownJob && (busy || availability === "unavailable" || !hasNativeTranslation()) ? "disabled" : ""}>${ownJob ? e(C.cancel) : e(P.prepare)}</button>`}</div>`;
      })
      .join("");
    this.updatePrepare();
    for (const pack of this.packs()) {
      const id = nativePackId(pack);
      if (!this.availability.has(id) && !this.checking.has(id))
        void this.check(pack);
    }
  }
  private async prepare(pack: NativePack) {
    const id = nativePackId(pack);
    if (this.jobs.has(id) || !hasNativeTranslation()) return;
    const controller = new AbortController();
    this.jobs.set(id, controller);
    this.errors.delete(id);
    const report = (event: NativePackProgress) => {
      this.progress.set(id, event);
      this.renderList();
    };
    try {
      await trackNativePacks(
        (emit) => prepareNativePack(pack, controller.signal, emit),
        controller.signal,
        report,
      );
      this.availability.set(id, "available");
    } catch (error) {
      const { code } = modelError(error);
      if (code !== "cancelled")
        this.errors.set(
          id,
          C.real.errors[code as keyof typeof C.real.errors] ||
            C.real.errors.translationFailed,
        );
    } finally {
      this.jobs.delete(id);
      this.progress.delete(id);
      await this.check(pack);
    }
  }
}
