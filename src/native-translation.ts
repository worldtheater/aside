import { ModelError } from "./providers.js";
import type { NativeTranslationRequest } from "./types.js";
import type { NativePack, NativePackProgress } from "./native-packs.js";
import { isSafari } from "./browser.js";
import {
  appleDetect,
  applePackAvailability,
  createAppleTranslator,
} from "./apple-translation.js";
type Report = (event: NativePackProgress) => void;
export type WaitForNativeActivation = (
  pack: NativePack,
  signal: AbortSignal,
) => Promise<void>;
interface CreateOptions {
  signal: AbortSignal;
  monitor?: (monitor: EventTarget) => void;
}

export type Availability =
  "available" | "downloadable" | "downloading" | "unavailable";
interface TranslatorInstance {
  translate(text: string, options?: { signal: AbortSignal }): Promise<string>;
  translateBatch?(texts: string[], signal: AbortSignal): Promise<string[]>;
  destroy(): void;
}
interface DetectorInstance {
  detect(
    text: string,
  ): Promise<{ detectedLanguage: string; confidence: number }[]>;
  destroy(): void;
}
interface NativeAPIs {
  Translator?: {
    availability(options: {
      sourceLanguage: string;
      targetLanguage: string;
    }): Promise<Availability>;
    create(
      options: {
        sourceLanguage: string;
        targetLanguage: string;
      } & CreateOptions,
    ): Promise<TranslatorInstance>;
  };
  LanguageDetector?: {
    availability(): Promise<Availability>;
    create(options: CreateOptions): Promise<DetectorInstance>;
  };
}
function nativeError(code: string, error: unknown): ModelError {
  const detail =
    error instanceof Error || error instanceof DOMException
      ? error.toString()
      : typeof error === "string"
        ? error
        : "";
  return new ModelError(code, detail);
}
// Web APIs exist in the calling document (including Chrome isolated content
// scripts), not in the extension service worker. No page-world code is injected.
export function nativeLanguage(code: string): string {
  if (code === "zh-Hans") return "zh";
  if (code === "pt-BR") return "pt";
  return code;
}
export function hasNativeTranslation(): boolean {
  return (
    isSafari ||
    (!!(globalThis as NativeAPIs).Translator && !!globalThis.isSecureContext)
  );
}
export async function nativePackAvailability(
  pack: NativePack,
): Promise<Availability> {
  if (isSafari) return applePackAvailability(pack);
  const api = globalThis as NativeAPIs;
  if (!globalThis.isSecureContext) return "unavailable";
  if (pack.kind === "detector")
    return api.LanguageDetector
      ? api.LanguageDetector.availability()
      : "unavailable";
  return api.Translator
    ? api.Translator.availability({
        sourceLanguage: pack.sourceLanguage,
        targetLanguage: pack.targetLanguage,
      })
    : "unavailable";
}
async function createResource<T extends { destroy(): void }>(
  pack: NativePack,
  signal: AbortSignal,
  report: Report,
  create: (options: CreateOptions) => Promise<T>,
  waitForActivation?: WaitForNativeActivation,
): Promise<T> {
  report({ pack, state: "checking" });
  try {
    signal.throwIfAborted();
    const availability = await nativePackAvailability(pack);
    signal.throwIfAborted();
    if (availability === "unavailable")
      throw new ModelError("translationLanguageUnavailable");
    // availability() may mask installed resources as downloadable. Let create()
    // decide whether a gesture or download is actually necessary.
    report({ pack, state: "preparing" });
    const options: CreateOptions = {
      signal,
      monitor(monitor) {
        // An available resource may still emit initialization progress. It is
        // not a new download and must not reopen the language-pack notice.
        if (availability === "available") return;
        monitor.addEventListener(
          "downloadprogress",
          (event) => {
            if (signal.aborted) return;
            const loaded = (event as Event & { loaded: number }).loaded;
            if (Number.isFinite(loaded))
              report({
                pack,
                state: loaded > 0 && loaded < 1 ? "downloading" : "preparing",
                progress: Math.min(1, Math.max(0, loaded)),
              });
          },
          { signal },
        );
      },
    };
    let resource: T;
    try {
      resource = await create(options);
    } catch (error) {
      signal.throwIfAborted();
      // NotAllowedError also covers Permissions Policy. Only an explicit
      // activation error can be resolved by asking for a click.
      if (
        !(error instanceof DOMException) ||
        error.name !== "NotAllowedError" ||
        !/user activation|user gesture/i.test(error.message)
      )
        throw error;
      report({ pack, state: "activation" });
      if (!waitForActivation)
        throw new ModelError("translationDownload", error.toString());
      await waitForActivation(pack, signal);
      signal.throwIfAborted();
      report({ pack, state: "preparing" });
      resource = await create(options);
    }
    if (signal.aborted) {
      resource.destroy();
      throw new ModelError("cancelled");
    }
    report({ pack, state: "ready" });
    return resource;
  } catch (error) {
    if (!(error instanceof ModelError && error.code === "translationDownload"))
      report({ pack, state: "error" });
    if (signal.aborted) throw new ModelError("cancelled");
    if (error instanceof ModelError) throw error;
    // NotAllowedError may also mean Permissions Policy; do not mislabel it as a download.
    throw nativeError("translationFailed", error);
  }
}
export async function prepareNativePack(
  pack: NativePack,
  signal: AbortSignal,
  report: Report = () => {},
): Promise<void> {
  const api = globalThis as NativeAPIs;
  if (!hasNativeTranslation()) throw new ModelError("translationUnavailable");
  if (isSafari && pack.kind === "detector") {
    report({ pack, state: "ready" });
    return;
  }
  const resource =
    pack.kind === "detector"
      ? await createResource(pack, signal, report, (options) => {
          if (!api.LanguageDetector)
            throw new ModelError("translationUnavailable");
          return api.LanguageDetector.create(options);
        })
      : await createResource(pack, signal, report, (options) =>
          (isSafari
            ? createAppleTranslator
            : api.Translator!.create.bind(api.Translator))({
            sourceLanguage: pack.sourceLanguage,
            targetLanguage: pack.targetLanguage,
            ...options,
          }),
        );
  resource.destroy();
}
export async function detectNativeLanguage(
  text: string,
  signal: AbortSignal,
  report: Report = () => {},
  waitForActivation?: WaitForNativeActivation,
): Promise<string> {
  if (isSafari) {
    const language = await appleDetect(text, signal);
    report({ pack: { kind: "detector" }, state: "ready" });
    return nativeLanguage(language);
  }
  const api = globalThis as NativeAPIs;
  if (!api.LanguageDetector || !globalThis.isSecureContext)
    throw new ModelError("translationUnavailable");
  let detector: DetectorInstance | undefined;
  const dispose = () => {
    detector?.destroy();
    detector = undefined;
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    detector = await createResource(
      { kind: "detector" },
      signal,
      report,
      (options) => api.LanguageDetector!.create(options),
      waitForActivation,
    );
    signal.throwIfAborted();
    const language = (await detector.detect(text))[0]?.detectedLanguage;
    signal.throwIfAborted();
    if (!language || language === "und")
      throw new ModelError("translationDetection");
    return nativeLanguage(language);
  } catch (error) {
    if (signal.aborted) throw new ModelError("cancelled");
    const failure =
      error instanceof ModelError
        ? error
        : nativeError("translationDetection", error);
    if (!["cancelled", "translationDownload"].includes(failure.code))
      console.error("[Aside] Native language detection failed", {
        stage: detector ? "detect-language" : "prepare-detector",
        text,
        error: failure.message,
      });
    throw failure;
  } finally {
    signal.removeEventListener("abort", dispose);
    dispose();
  }
}
// Owned by a page translation session, not by an individual batch or port.
export class NativeTranslationSession {
  private readonly lifetime = new AbortController();
  private translator?: TranslatorInstance;
  private pair = "";
  private failure?: ModelError;
  private queue: Promise<void> = Promise.resolve();

  destroy(): void {
    this.lifetime.abort();
    const translator = this.translator;
    this.translator = undefined;
    translator?.destroy();
  }

  readonly translate = (
    request: NativeTranslationRequest,
    signal: AbortSignal,
    report: Report = () => {},
    waitForActivation?: WaitForNativeActivation,
  ): Promise<string[]> => {
    // Includes creation, so overlapping scroll jobs cannot create duplicates.
    const pending = this.queue.then(() =>
      this.run(request, signal, report, waitForActivation),
    );
    this.queue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  };

  private async run(
    request: NativeTranslationRequest,
    requestSignal: AbortSignal,
    report: Report,
    waitForActivation?: WaitForNativeActivation,
  ): Promise<string[]> {
    // Queued jobs report the original failure, never turn a pause into a cancel.
    if (this.failure) throw this.failure;
    const signal = AbortSignal.any([requestSignal, this.lifetime.signal]);
    const api = globalThis as NativeAPIs;
    let sourceLanguage = nativeLanguage(request.sourceLanguage);
    const targetLanguage = nativeLanguage(request.targetLanguage);
    const results: string[] = [];
    let translating = false;
    try {
      signal.throwIfAborted();
      if (!hasNativeTranslation())
        throw new ModelError("translationUnavailable");
      if (sourceLanguage === "auto")
        sourceLanguage = await detectNativeLanguage(
          request.texts.join("\n\n"),
          signal,
          report,
          waitForActivation,
        );
      signal.throwIfAborted();
      const pair = JSON.stringify([sourceLanguage, targetLanguage]);
      if (pair !== this.pair) {
        this.translator?.destroy();
        this.translator = undefined;
        this.pair = pair;
      }
      if (sourceLanguage === targetLanguage) return [...request.texts];
      if (!this.translator) {
        const options = { sourceLanguage, targetLanguage };
        this.translator = await createResource(
          { kind: "translator", ...options },
          // A completed batch's signal must not destroy the shared instance.
          this.lifetime.signal,
          report,
          (createOptions) =>
            (isSafari
              ? createAppleTranslator
              : api.Translator!.create.bind(api.Translator))({
              ...options,
              ...createOptions,
            }),
          waitForActivation,
        );
      }
      if (this.translator.translateBatch) {
        translating = true;
        results.push(
          ...(await this.translator.translateBatch(request.texts, signal)),
        );
      } else
        for (const text of request.texts) {
          signal.throwIfAborted();
          translating = true;
          results.push(await this.translator.translate(text, { signal }));
        }
      signal.throwIfAborted();
      return results;
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof ModelError && error.code === "cancelled")
      )
        throw new ModelError("cancelled");
      const failure =
        error instanceof ModelError
          ? error
          : nativeError("translationFailed", error);
      // Failed auto-detection logs its own input before a language is resolved.
      if (sourceLanguage !== "auto" && failure.code !== "translationDownload")
        console.error("[Aside] Native translation failed", {
          requestId: request.id,
          stage: translating ? "translate" : "prepare-translator",
          sourceLanguage,
          targetLanguage,
          failedTextIndex: translating ? results.length : null,
          texts: [...request.texts],
          error: failure.message,
        });
      this.failure = failure;
      this.destroy();
      throw failure;
    }
  }
}

export async function nativeTranslate(
  request: NativeTranslationRequest,
  signal: AbortSignal,
  report: Report = () => {},
  waitForActivation?: WaitForNativeActivation,
): Promise<string[]> {
  const session = new NativeTranslationSession();
  const cancel = () => session.destroy();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await session.translate(request, signal, report, waitForActivation);
  } finally {
    signal.removeEventListener("abort", cancel);
    session.destroy();
  }
}
