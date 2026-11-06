import { ModelError } from "./providers.js";
import type { AppleCommand, AppleReply } from "./apple-translation-protocol.js";
import type { Availability } from "./native-translation.js";
import type { NativePack } from "./native-packs.js";
import { randomUUID } from "./uuid.js";

// One port owns one native session. Closing a page or retrying releases it in
// the background, even when no further JavaScript can run in the document.
class AppleTranslationConnection {
  private readonly port = chrome.runtime.connect({ name: "apple-translation" });
  private readonly pending = new Map<string, (reply: AppleReply) => void>();
  private closed = false;
  constructor() {
    this.port.onMessage.addListener((reply: AppleReply) =>
      this.pending.get(reply.id)?.(reply),
    );
    this.port.onDisconnect.addListener(() => this.closePending());
  }
  request<T>(command: AppleCommand, signal?: AbortSignal): Promise<T> {
    if (this.closed)
      return Promise.reject(new ModelError("extensionDisconnected"));
    if (signal?.aborted) return Promise.reject(new ModelError("cancelled"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        try {
          this.port.postMessage({
            command: "cancel",
            id: randomUUID(),
            requestId: id,
          });
        } catch {
          /* The background may already have disconnected. */
        }
        finish({ id, error: "cancelled" });
      };
      const finish = (reply: AppleReply) => {
        this.pending.delete(id);
        signal?.removeEventListener("abort", abort);
        if (reply.error) reject(new ModelError(reply.error, reply.detail));
        else resolve(reply.value as T);
      };
      this.pending.set(id, finish);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.port.postMessage({ ...command, id });
      } catch {
        finish({ id, error: "extensionDisconnected" });
      }
    });
  }
  private closePending() {
    this.closed = true;
    for (const [id, finish] of this.pending)
      finish({ id, error: "extensionDisconnected" });
  }
  destroy() {
    if (this.closed) return;
    this.closePending();
    this.port.disconnect();
  }
}
async function once<T>(
  command: AppleCommand,
  signal?: AbortSignal,
): Promise<T> {
  const connection = new AppleTranslationConnection();
  try {
    return await connection.request<T>(command, signal);
  } finally {
    connection.destroy();
  }
}
export function applePackAvailability(pack: NativePack): Promise<Availability> {
  return pack.kind === "detector"
    ? Promise.resolve("available")
    : once({
        command: "availability",
        sourceLanguage: pack.sourceLanguage,
        targetLanguage: pack.targetLanguage,
      });
}
export function appleDetect(
  text: string,
  signal: AbortSignal,
): Promise<string> {
  return once({ command: "detect", text }, signal);
}
export async function createAppleTranslator(options: {
  sourceLanguage: string;
  targetLanguage: string;
  signal: AbortSignal;
}) {
  options.signal.throwIfAborted();
  const connection = new AppleTranslationConnection();
  const abort = () => connection.destroy();
  options.signal.addEventListener("abort", abort, { once: true });
  const destroy = () => {
    options.signal.removeEventListener("abort", abort);
    connection.destroy();
  };
  try {
    const pair = {
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
    };
    const availability = await connection.request<Availability>(
      { command: "availability", ...pair },
      options.signal,
    );
    if (availability === "unavailable")
      throw new ModelError("translationLanguageUnavailable");
    if (availability !== "available")
      await connection.request({ command: "prepare", ...pair }, options.signal);
    await connection.request({ command: "create", ...pair }, options.signal);
    return {
      translate: (text: string, opts?: { signal: AbortSignal }) =>
        connection
          .request<string[]>(
            { command: "translate", texts: [text] },
            opts?.signal,
          )
          .then((texts) => texts[0]),
      translateBatch: (texts: string[], signal: AbortSignal) =>
        connection.request<string[]>({ command: "translate", texts }, signal),
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
