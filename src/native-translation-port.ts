import { ModelError } from "./providers.js";
import { randomUUID } from "./uuid.js";
import type { NativeTranslationReply } from "./types.js";

export function nativeTranslationPort(port: chrome.runtime.Port) {
  return (
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    signal: AbortSignal,
  ): Promise<string[]> =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => {
        port.onMessage.removeListener(receive);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(new ModelError("cancelled"));
      };
      const receive = (message: NativeTranslationReply) => {
        if (message?.type !== "native-result" || message.id !== id) return;
        cleanup();
        if (message.error)
          reject(
            new ModelError(
              [
                "translationUnavailable",
                "translationLanguageUnavailable",
                "translationDownload",
                "translationDetection",
                "cancelled",
              ].includes(message.error)
                ? message.error
                : "translationFailed",
              typeof message.detail === "string" ? message.detail : "",
            ),
          );
        else if (
          !Array.isArray(message.texts) ||
          message.texts.length !== texts.length ||
          message.texts.some((text) => typeof text !== "string")
        )
          reject(new ModelError("translationFailed"));
        else resolve(message.texts);
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      port.onMessage.addListener(receive);
      try {
        port.postMessage({
          type: "native-translate",
          id,
          texts,
          sourceLanguage,
          targetLanguage,
        });
      } catch {
        cleanup();
        reject(new ModelError("interrupted"));
      }
    });
}
