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
): ProcessJob {
  const port = chrome.runtime.connect({ name: "process" });
  let finished = false,
    settle: (reason: ModelError) => void;
  const promise = new Promise<ProcessResult>((resolve, reject) => {
    settle = reject;
    port.onMessage.addListener((message: ProcessMessage) => {
      if (finished) return;
      if (message.type === "delta") onDelta(message.id, message.text);
      else if (message.type === "progress")
        onProgress(message.parts, message.stats);
      else {
        finished = true;
        port.disconnect();
        if (message.type === "done") resolve(message.result);
        else reject(new ModelError(message.error, message.detail));
      }
    });
    port.onDisconnect.addListener(() => {
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
