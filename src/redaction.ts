// Match known credentials literally; do not guess whether ordinary text is a key.
export function createSecretRedactor(secrets: readonly string[]) {
  const keys = [
    ...new Set(
      secrets
        .filter(Boolean)
        .flatMap((key) => [key, JSON.stringify(key).slice(1, -1)]),
    ),
  ].sort((a, b) => b.length - a.length);
  function consume(text: string, final: boolean): [string, string] {
    if (!keys.length) return [text, ""];
    let output = "",
      index = 0;
    while (index < text.length) {
      // Keep a possible key prefix private until a later chunk resolves it.
      if (
        !final &&
        keys.some(
          (key) =>
            key.length > text.length - index &&
            key.startsWith(text.slice(index)),
        )
      )
        break;
      const key = keys.find((key) => text.startsWith(key, index));
      if (key) {
        output += "[redacted]";
        index += key.length;
      } else output += text[index++];
    }
    return [output, text.slice(index)];
  }
  return {
    text: (text: string) => consume(text, true)[0],
    // Request details can be formatted as JSON by the UI. Redact decoded strings
    // too, while keeping the original formatting when no credential was found.
    content(text: string): string {
      try {
        const normalized = JSON.stringify(JSON.parse(text));
        const safe = consume(normalized, true)[0];
        if (safe !== normalized) return safe;
      } catch {
        // Plain text uses the same literal matching as streamed output.
      }
      return consume(text, true)[0];
    },
    stream(emit: (text: string) => void) {
      let pending = "";
      const write = (text: string, final: boolean) => {
        const [safe, rest] = consume(pending + text, final);
        pending = rest;
        if (safe) emit(safe);
      };
      return {
        push: (text: string) => write(text, false),
        // Only finish on success. An aborted/failed stream discards its pending prefix.
        finish: () => write("", true),
      };
    },
  };
}
