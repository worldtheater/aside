import type {
  ProcessingAction,
  PublicSettings,
  TranslationEngine,
} from "./types.js";
import { ModelError } from "./providers.js";
import { isFirefox } from "./browser.js";

export const TRANSLATION_ENGINES: readonly TranslationEngine[] = [
  "ai",
  "microsoft",
  "browser",
];
// Keep the stored/synced engine vocabulary portable; choices follow this browser's integration.
export const AVAILABLE_TRANSLATION_ENGINES: readonly TranslationEngine[] =
  TRANSLATION_ENGINES.filter((engine) => engine !== "browser" || !isFirefox);
export const MICROSOFT_ORIGIN = "https://edge.microsoft.com/*";
export function translationEngine(
  action?: Partial<ProcessingAction>,
): TranslationEngine {
  return action?.kind === "translate"
    ? (action.translationEngine ?? "ai")
    : "ai";
}
export function usesModel(action?: Partial<ProcessingAction>): boolean {
  return translationEngine(action) === "ai";
}
export function translationEngineSupported(
  action?: Partial<ProcessingAction>,
): boolean {
  return AVAILABLE_TRANSLATION_ENGINES.includes(translationEngine(action));
}
export function actionAvailable(
  action: Partial<ProcessingAction> | undefined,
  settings: PublicSettings,
): boolean {
  if (!action) return false;
  if (!translationEngineSupported(action)) return false;
  if (!usesModel(action)) return true;
  const id =
    !action.model || action.model === "default"
      ? settings.defaultConnection
      : action.model;
  return settings.connections.some(
    (c) => c.id === id && c.connected && c.protocol !== "typesafe",
  );
}
export function validateTranslationEngine(
  action: Partial<ProcessingAction>,
): void {
  if (
    action.translationEngine !== undefined &&
    (action.kind !== "translate" ||
      !TRANSLATION_ENGINES.includes(action.translationEngine))
  )
    throw new ModelError("invalidAction");
  if (!usesModel(action) && action.targetLanguage === "instruction")
    throw new ModelError("invalidAction");
}
// Call directly from an extension-page click/change handler to retain user activation.
export async function authorizeTranslation(
  action: Partial<ProcessingAction>,
): Promise<void> {
  if (!translationEngineSupported(action))
    throw new ModelError("translationUnavailable");
  if (
    translationEngine(action) === "microsoft" &&
    !(await chrome.permissions.request({ origins: [MICROSOFT_ORIGIN] }))
  )
    throw new ModelError("translationPermission");
}
export interface DirectTranslation {
  identity: string;
  translate(texts: string[], signal: AbortSignal): Promise<string[]>;
}
