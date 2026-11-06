import { trackNativePacks } from "./native-pack-channel.js";
import type { NativePackProgress } from "./native-packs.js";
import { NativeTranslationSession } from "./native-translation.js";
import type {
  WaitForNativeActivation,
  nativeTranslate,
} from "./native-translation.js";
import { ModelError } from "./providers.js";
import type {
  RequestMap,
  ProcessPayload,
  ProcessJob,
  ProcessMessage,
  ProcessResult,
  ResultPart,
  ProcessStats,
} from "./types.js";
export async function request<K extends keyof RequestMap>(
  type: K,
  ...args: {} extends RequestMap[K]["payload"]
    ? [payload?: RequestMap[K]["payload"]]
    : [payload: RequestMap[K]["payload"]]
): Promise<RequestMap[K]["result"]> {
  const response = await chrome.runtime.sendMessage({ type, ...args[0] });
  if (!response?.ok)
    throw new ModelError(response?.error || "interrupted", response?.detail);
  return response.value;
}
export function processRequest(
  payload: ProcessPayload,
  onProgress: (parts: ResultPart[], stats?: ProcessStats) => void = () => {},
  onDelta: (id: string, text: string) => void = () => {},
  onNativeProgress: (event: NativePackProgress) => void = () => {},
  waitForActivation?: WaitForNativeActivation,
  translateNative?: typeof nativeTranslate,
): ProcessJob {
  const port = chrome.runtime.connect({ name: "process" });
  const nativeController = new AbortController();
  let nativeSession: NativeTranslationSession | undefined;
  nativeController.signal.addEventListener(
    "abort",
    () => nativeSession?.destroy(),
    { once: true },
  );
  let finished = false,
    settle: (reason: ModelError) => void;
  const promise = new Promise<ProcessResult>((resolve, reject) => {
    settle = reject;
    port.onMessage.addListener((message: ProcessMessage) => {
      if (finished) return;
      if (message.type === "native-translate") {
        const translate =
          translateNative ??
          (nativeSession ??= new NativeTranslationSession()).translate;
        void trackNativePacks(
          (report) =>
            translate(
              message,
              nativeController.signal,
              report,
              waitForActivation,
            ),
          nativeController.signal,
          onNativeProgress,
        )
          .then(
            (texts) => {
              if (!finished)
                port.postMessage({
                  type: "native-result",
                  id: message.id,
                  texts,
                });
            },
            (error) => {
              if (!finished)
                port.postMessage({
                  type: "native-result",
                  id: message.id,
                  error:
                    error instanceof ModelError
                      ? error.code
                      : "translationFailed",
                  detail:
                    error instanceof ModelError && error.message !== error.code
                      ? error.message
                      : "",
                });
            },
          )
          .catch(() => {
            if (!finished) {
              finished = true;
              nativeController.abort();
              port.disconnect();
              reject(new ModelError("interrupted"));
            }
          });
      } else if (message.type === "delta") onDelta(message.id, message.text);
      else if (message.type === "progress")
        onProgress(message.parts, message.stats);
      else {
        finished = true;
        nativeController.abort();
        port.disconnect();
        if (message.type === "done") resolve(message.result);
        else reject(new ModelError(message.error, message.detail));
      }
    });
    port.onDisconnect.addListener(() => {
      nativeController.abort();
      if (!finished) {
        finished = true;
        reject(new ModelError("interrupted"));
      }
    });
  });
  port.postMessage(payload);
  return {
    promise,
    cancel() {
      if (finished) return;
      finished = true;
      nativeController.abort();
      port.disconnect();
      settle(new ModelError("cancelled"));
    },
  };
}

export function completionText(
  strings: {
    done: string;
    localHits: string;
    sharedItems: string;
    cacheWriteFailed: string;
  },
  stats?: ProcessStats,
): string {
  return [
    strings.done,
    stats?.hits
      ? strings.localHits
          .replace("{hits}", String(stats.hits))
          .replace("{total}", String(stats.total))
      : "",
    stats?.shared
      ? strings.sharedItems.replace("{shared}", String(stats.shared))
      : "",
    stats?.writeFailed ? strings.cacheWriteFailed : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
