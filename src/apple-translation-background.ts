import { isSafari } from "./browser.js";
import { isAppleCommand } from "./apple-translation-protocol.js";
import type { AppleReply } from "./apple-translation-protocol.js";

export function registerAppleTranslation() {
  if (!isSafari) return;
  // Safari ignores this argument and routes only to our containing extension.
  const application = chrome.runtime.id;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "apple-translation") return;
    const sender = port.sender;
    if (
      sender?.id !== chrome.runtime.id ||
      !sender.url ||
      !(
        sender.url.startsWith(chrome.runtime.getURL("")) ||
        (sender.tab && /^https?:\/\//.test(sender.url))
      )
    ) {
      port.disconnect();
      return;
    }
    const sessionId = crypto.randomUUID();
    const preparations = new Map<string, () => void>();
    let closed = false;
    const send = (message: object): Promise<AppleReply> =>
      chrome.runtime.sendNativeMessage(application, { ...message, sessionId });
    const reply = (message: AppleReply) => {
      if (!closed) port.postMessage(message);
    };
    port.onMessage.addListener(async (message: unknown) => {
      if (!isAppleCommand(message)) {
        const id =
          message &&
          typeof message === "object" &&
          "id" in message &&
          typeof message.id === "string"
            ? message.id
            : "";
        reply({ id, error: "invalidRequest" });
        return;
      }
      const { id, command } = message;
      if (command === "cancel") {
        preparations.get(message.requestId)?.();
        await send(message).catch(() => {});
        return;
      }
      try {
        if (command !== "prepare") {
          reply({ ...(await send(message)), id });
          return;
        }
        // Connect before launching the host so a fast/previously installed
        // preparation cannot finish before the listener exists.
        const native = chrome.runtime.connectNative(application);
        const prepared = await new Promise<AppleReply>((resolve) => {
          let done = false;
          const finish = (result: AppleReply) => {
            if (done) return;
            done = true;
            preparations.delete(id);
            native.disconnect();
            resolve(result);
          };
          preparations.set(id, () => finish({ id, error: "cancelled" }));
          native.onMessage.addListener((event) => {
            if (
              event?.name === "translation-prepared" &&
              event.userInfo?.requestId === id
            )
              finish({ id, ...event.userInfo });
          });
          native.onDisconnect.addListener(() =>
            finish({ id, error: "extensionDisconnected" }),
          );
          void send(message).then(
            (result) => {
              if (result.error) finish({ ...result, id });
            },
            (error) =>
              finish({ id, error: "translationFailed", detail: String(error) }),
          );
        });
        reply(prepared);
      } catch (error) {
        reply({ id, error: "translationFailed", detail: String(error) });
      }
    });
    port.onDisconnect.addListener(() => {
      closed = true;
      for (const cancel of preparations.values()) cancel();
      void send({ command: "destroy" }).catch(() => {});
    });
  });
}
