import type { NativePackProgress } from "./native-packs.js";

// A port keeps active progress scoped to the document doing the preparation.
// Disconnecting removes stale progress when a tab closes or a request is cancelled.
export async function trackNativePacks<T>(
  run: (report: (event: NativePackProgress) => void) => Promise<T>,
  signal: AbortSignal,
  onProgress: (event: NativePackProgress) => void = () => {},
): Promise<T> {
  const port = chrome.runtime.connect({ name: "native-packs" });
  let disconnected = false;
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    port.disconnect();
  };
  port.onDisconnect.addListener(() => {
    disconnected = true;
  });
  signal.addEventListener("abort", disconnect, { once: true });
  try {
    signal.throwIfAborted();
    return await run((event) => {
      if (signal.aborted) return;
      if (!disconnected) {
        try {
          port.postMessage(event);
        } catch {
          disconnected = true;
        }
      }
      onProgress(event);
    });
  } finally {
    signal.removeEventListener("abort", disconnect);
    disconnect();
  }
}
