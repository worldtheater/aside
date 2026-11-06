export type AppleCommand =
  | {
      command: "availability" | "prepare" | "create";
      sourceLanguage: string;
      targetLanguage: string;
    }
  | { command: "detect"; text: string }
  | { command: "translate"; texts: string[] }
  | { command: "cancel"; requestId: string };
export interface AppleReply {
  id: string;
  value?: unknown;
  error?: string;
  detail?: string;
}
export function isAppleCommand(
  value: unknown,
): value is AppleCommand & { id: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const language = (code: unknown) =>
    typeof code === "string" &&
    /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(code);
  if (typeof v.id !== "string" || v.id.length > 64) return false;
  switch (v.command) {
    case "availability":
    case "prepare":
    case "create":
      return language(v.sourceLanguage) && language(v.targetLanguage);
    case "detect":
      return typeof v.text === "string" && v.text.length <= 200_000;
    case "translate":
      return (
        Array.isArray(v.texts) &&
        v.texts.length <= 256 &&
        v.texts.every((t) => typeof t === "string") &&
        v.texts.join("").length <= 200_000
      );
    case "cancel":
      return typeof v.requestId === "string" && v.requestId.length <= 64;
    default:
      return false;
  }
}
