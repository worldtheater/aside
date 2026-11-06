import { escapeHtml as e } from "./html.js";
import { icon } from "./ui.js";
import { ModelError } from "./providers.js";
import { nativePackId, nativeProgressText } from "./native-packs.js";
import type { NativePack, NativePackProgress } from "./native-packs.js";
import type { WaitForNativeActivation } from "./native-translation.js";
import type { PublicConfig } from "./types.js";

// Keep the original request pending while a language pack needs a user gesture.
export class NativeDownloadNotice {
  readonly element = document.createElement("div");
  private updates = new Map<object, NativePackProgress>();
  private waiting = new Map<
    object,
    {
      pack: NativePack;
      resume(): void;
      cancel(): void;
    }
  >();
  constructor(private config: () => PublicConfig) {
    this.element.className = "native-download notice";
    this.element.hidden = true;
    this.element.addEventListener("click", (event) => {
      const command = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-native-command]",
      )?.dataset.nativeCommand;
      if (command === "dismiss") {
        for (const waiter of [...this.waiting.values()]) waiter.cancel();
        this.updates.clear();
        this.render();
      }
      if (command === "prepare") this.prepare();
      if (command === "manage")
        void chrome.runtime
          .sendMessage({ type: "settings.open", route: "language-packs" })
          .catch(() => {});
    });
  }
  track() {
    const key = {};
    const waitForActivation: WaitForNativeActivation = (pack, signal) =>
      new Promise<void>((resolve, reject) => {
        const finish = (cancelled: boolean) => {
          signal.removeEventListener("abort", cancel);
          this.waiting.delete(key);
          if (cancelled) {
            this.updates.delete(key);
            this.render();
            reject(new ModelError("cancelled"));
          } else resolve();
        };
        const cancel = () => finish(true);
        if (signal.aborted) {
          cancel();
          return;
        }
        this.waiting.set(key, { pack, resume: () => finish(false), cancel });
        signal.addEventListener("abort", cancel, { once: true });
      });
    return {
      report: (event: NativePackProgress) => {
        if (event.state === "ready" || event.state === "error")
          this.updates.delete(key);
        else if (
          event.state === "activation" ||
          event.state === "downloading" ||
          this.updates.has(key)
        )
          this.updates.set(key, event);
        this.render();
      },
      waitForActivation,
      clear: () => {
        this.waiting.get(key)?.cancel();
        this.updates.delete(key);
        this.render();
      },
    };
  }
  private render() {
    const current = [...this.updates.values()].at(-1);
    this.element.hidden = !current;
    if (!current) return;
    const S = this.config().strings,
      P = S.translation.packs;
    const text = nativeProgressText(current, P, S.languages);
    const progress =
      current.state === "downloading" || current.state === "preparing";
    this.element.innerHTML = `<div class="native-download-heading"><span role="status">${e(text)}</span>${progress ? "" : `<button type="button" class="icon" data-native-command="dismiss" aria-label="${e(S.close)}">${icon("close")}</button>`}</div>${progress ? `<progress max="1" ${current.progress !== undefined ? `value="${current.progress}"` : ""} aria-label="${e(text)}"></progress>` : ""}<div class="native-download-actions">${current.state === "activation" ? `<button type="button" data-native-command="prepare">${e(P.prepare)}</button>` : ""}<button type="button" data-native-command="manage">${e(P.title)}</button></div>`;
  }
  private prepare() {
    const pack = [...this.updates.values()].findLast(
      (event) => event.state === "activation",
    )?.pack;
    if (!pack) return;
    for (const waiter of [...this.waiting.values()])
      if (nativePackId(waiter.pack) === nativePackId(pack)) waiter.resume();
  }
  destroy() {
    for (const waiter of [...this.waiting.values()]) waiter.cancel();
    this.updates.clear();
    this.element.remove();
  }
}
