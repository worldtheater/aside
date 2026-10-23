import type {
  Protocol,
  Tokens,
  UsageRecord,
  UsageSummary,
  UsageFilter,
} from "./types.js";
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const fields = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
export function normalizeUsage(
  raw: Record<string, unknown>,
  protocol: Protocol,
): Tokens {
  let inputTokens: number | null,
    outputTokens: number | null,
    cachedTokens: number | null,
    cacheWriteTokens: number | null,
    reasoningTokens: number | null;
  if (protocol === "anthropic") {
    cachedTokens = count(raw.cache_read_input_tokens);
    cacheWriteTokens = count(raw.cache_creation_input_tokens);
    const uncached = count(raw.input_tokens);
    inputTokens =
      uncached === null
        ? null
        : uncached + (cachedTokens ?? 0) + (cacheWriteTokens ?? 0);
    outputTokens = count(raw.output_tokens);
    reasoningTokens = null;
  } else if (protocol === "gemini") {
    inputTokens = count(raw.total_input_tokens);
    outputTokens = count(raw.total_output_tokens);
    cachedTokens = count(raw.total_cached_tokens);
    cacheWriteTokens = null;
    reasoningTokens = count(raw.total_thought_tokens);
  } else {
    const chat = protocol === "chat",
      details = fields(
        chat ? raw.prompt_tokens_details : raw.input_tokens_details,
      );
    inputTokens = count(chat ? raw.prompt_tokens : raw.input_tokens);
    outputTokens = count(chat ? raw.completion_tokens : raw.output_tokens);
    cachedTokens =
      count(details.cached_tokens) ??
      (chat ? count(raw.prompt_cache_hit_tokens) : null);
    cacheWriteTokens = count(details.cache_write_tokens);
    reasoningTokens = count(
      fields(chat ? raw.completion_tokens_details : raw.output_tokens_details)
        .reasoning_tokens,
    );
  }
  // Gemini's thought tokens are additional to output; OpenAI reasoning is already in output.
  const totalTokens =
    count(raw.total_tokens) ??
    (inputTokens !== null &&
    outputTokens !== null &&
    (protocol !== "gemini" || reasoningTokens !== null)
      ? inputTokens +
        outputTokens +
        (protocol === "gemini" ? (reasoningTokens ?? 0) : 0)
      : null);
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
  };
}
export function usageState(
  record: Pick<UsageRecord, "tokens" | "usageFinal">,
): "missing" | "reported" | "partial" {
  if (
    !record.tokens ||
    Object.values(record.tokens).every((value) => value === null)
  )
    return "missing";
  return record.usageFinal &&
    record.tokens.inputTokens !== null &&
    record.tokens.outputTokens !== null
    ? "reported"
    : "partial";
}
const tokenFields = [
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "totalTokens",
] as const;
export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  const result: UsageSummary = {
    calls: records.length,
    reported: 0,
    partial: 0,
    missing: 0,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  };
  for (const record of records) result[usageState(record)]++;
  for (const field of tokenFields) {
    const values = records
      .map((record) => record.tokens?.[field])
      .filter((value): value is number => count(value) !== null);
    result[field] = values.length
      ? values.reduce((sum, value) => sum + value, 0)
      : null;
  }
  return result;
}
export const usageModelKey = (
  record: Pick<UsageRecord, "connectionId" | "model">,
) => JSON.stringify([record.connectionId, record.model]);
export function filterUsage(
  records: UsageRecord[],
  { period, model }: UsageFilter,
  now = new Date(),
): UsageRecord[] {
  let since = 0;
  if (period !== "all") {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(
      date.getDate() - (period === "today" ? 0 : Number(period) - 1),
    );
    since = date.getTime();
  }
  return records.filter(
    (record) =>
      record.startedAt >= since &&
      (model === "all" || usageModelKey(record) === model),
  );
}

export function usageByDay(
  records: UsageRecord[],
  period: string,
  now = new Date(),
) {
  if (!records.length) return [];
  const groups = new Map<number, UsageRecord[]>();
  for (const record of records) {
    const day = new Date(record.startedAt);
    day.setHours(0, 0, 0, 0);
    const key = day.getTime();
    const entries = groups.get(key) ?? [];
    entries.push(record);
    groups.set(key, entries);
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dates = [...groups.keys()];
  const start = new Date(today);
  if (period === "all") start.setTime(Math.min(...dates));
  else
    start.setDate(
      start.getDate() - (period === "today" ? 0 : Number(period) - 1),
    );
  const end = Math.max(today.getTime(), ...dates);
  const days: {
    date: number;
    totalTokens: number | null;
    calls: number;
    incomplete: boolean;
  }[] = [];
  for (
    const day = start;
    day.getTime() <= end;
    day.setDate(day.getDate() + 1)
  ) {
    const entries = groups.get(day.getTime()) ?? [];
    days.push({
      date: day.getTime(),
      totalTokens: entries.length ? summarizeUsage(entries).totalTokens : 0,
      calls: entries.length,
      incomplete: entries.some(
        (record) =>
          !record.usageFinal || count(record.tokens?.totalTokens) === null,
      ),
    });
  }
  return days;
}
