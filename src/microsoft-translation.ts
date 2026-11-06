import { ModelError } from "./providers.js";
import { MICROSOFT_ORIGIN } from "./translation-engine.js";

const TRANSLATE_URL = "https://edge.microsoft.com/translate/translatetext";
export function parseMicrosoftTranslation(
  value: unknown,
  count: number,
): string[] {
  if (!Array.isArray(value) || value.length !== count)
    throw new ModelError("translationFailed");
  return value.map((item) => {
    const text: unknown = item?.translations?.[0]?.text;
    if (typeof text !== "string" || !text.trim())
      throw new ModelError("translationFailed");
    return text;
  });
}
export async function microsoftTranslate(
  texts: string[],
  source: string,
  target: string,
  signal: AbortSignal,
): Promise<string[]> {
  if (signal.aborted) throw new ModelError("cancelled");
  if (!(await chrome.permissions.contains({ origins: [MICROSOFT_ORIGIN] })))
    throw new ModelError("translationPermission");
  const url = new URL(TRANSLATE_URL);
  url.searchParams.set("isEnterpriseClient", "false");
  url.searchParams.set("to", target === "pt-BR" ? "pt" : target);
  if (source !== "auto")
    url.searchParams.set("from", source === "pt-BR" ? "pt" : source);
  const timeout = AbortSignal.timeout(30000);
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(texts),
      signal: AbortSignal.any([signal, timeout]),
    });
    if (response.status === 429) throw new ModelError("rateLimited");
    if (!response.ok) throw new ModelError("translationFailed");
    return parseMicrosoftTranslation(await response.json(), texts.length);
  } catch (error) {
    if (signal.aborted) throw new ModelError("cancelled");
    if (timeout.aborted) throw new ModelError("translationTimeout");
    if (error instanceof ModelError) throw error;
    // Provider bodies and network errors must never become UI/log output.
    throw new ModelError("translationFailed");
  }
}
