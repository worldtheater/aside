// Browser language resources are managed by the browser, not by the extension.
export type NativePack =
  | { kind: "translator"; sourceLanguage: string; targetLanguage: string }
  | { kind: "detector" };
export type NativePackState =
  "checking" | "downloading" | "preparing" | "ready" | "activation" | "error";
export interface NativePackProgress {
  pack: NativePack;
  state: NativePackState;
  progress?: number;
}
export interface NativePackRecord {
  pack: NativePack;
  readyAt?: number;
}
export interface NativePackSnapshot {
  records: NativePackRecord[];
  active: NativePackProgress[];
}
export const nativePackId = (pack: NativePack): string =>
  pack.kind === "detector"
    ? "detector"
    : `${pack.sourceLanguage}:${pack.targetLanguage}`;
export function isNativePackProgress(
  value: unknown,
): value is NativePackProgress {
  if (!value || typeof value !== "object") return false;
  const item = value as NativePackProgress;
  const pack = item.pack;
  const language = (code: unknown) =>
    typeof code === "string" &&
    /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(code);
  return (
    !!pack &&
    (pack.kind === "detector" ||
      (pack.kind === "translator" &&
        language(pack.sourceLanguage) &&
        language(pack.targetLanguage))) &&
    [
      "checking",
      "downloading",
      "preparing",
      "ready",
      "activation",
      "error",
    ].includes(item.state) &&
    (item.progress === undefined ||
      (Number.isFinite(item.progress) &&
        item.progress >= 0 &&
        item.progress <= 1))
  );
}
export function nativePackName(
  pack: NativePack,
  languages: Record<string, string>,
  detector: string,
): string {
  const name = (code: string) =>
    languages[code === "zh" ? "zh-Hans" : code === "pt" ? "pt-BR" : code] ||
    code;
  return pack.kind === "detector"
    ? detector
    : `${name(pack.sourceLanguage)} → ${name(pack.targetLanguage)}`;
}
export function nativePackStatus(
  event: NativePackProgress,
  states: Record<NativePackState, string>,
): string {
  return `${states[event.state]}${event.progress !== undefined && event.state === "downloading" ? ` ${Math.round(event.progress * 100)}%` : ""}`;
}
export function nativeProgressText(
  event: NativePackProgress,
  copy: { detector: string; states: Record<NativePackState, string> },
  languages: Record<string, string>,
): string {
  return `${nativePackName(event.pack, languages, copy.detector)} · ${nativePackStatus(event, copy.states)}`;
}
