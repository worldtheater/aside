import assert from "node:assert/strict";
import {
  usageByDay,
  filterUsage,
  summarizeUsage,
  normalizeUsage,
  usageModelKey,
} from "../usage.js";
const now = new Date(2026, 9, 20, 12);
const date = (day, hour = 12, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();
const record = (day, tokens, extra = {}) => ({
  startedAt: date(day),
  connectionId: "a",
  model: "m",
  tokens,
  usageFinal: true,
  ...extra,
});
const tokens = (total) => ({
  ...normalizeUsage({ prompt_tokens: total, completion_tokens: 0 }, "chat"),
});
const records = [
  record(16, tokens(100)),
  record(16, tokens(50)),
  record(18, null),
  record(19, tokens(0)),
  record(20, tokens(200)),
  record(20, tokens(30), { usageFinal: false }),
  record(20, null),
  record(20, tokens(70), { connectionId: "b" }),
];
let days = usageByDay(records, "all", now);
assert.deepEqual(
  days.map((d) => [d.date, d.totalTokens, d.calls, d.incomplete]),
  [
    [date(16, 0), 150, 2, false],
    [date(17, 0), 0, 0, false],
    [date(18, 0), null, 1, true],
    [date(19, 0), 0, 1, false],
    [date(20, 0), 300, 4, true],
  ],
);
assert.equal(
  days.reduce((sum, d) => sum + (d.totalTokens ?? 0), 0),
  summarizeUsage(records).totalTokens,
);
const selected = filterUsage(
  records,
  { period: "7", model: usageModelKey(records[0]) },
  now,
);
days = usageByDay(selected, "7", now);
assert.equal(days.length, 7);
assert.equal(days[0].date, date(14, 0));
assert.equal(days.at(-1).totalTokens, 230);
assert.equal(
  usageByDay(
    filterUsage(records, { period: "today", model: "all" }, now),
    "today",
    now,
  ).length,
  1,
);
assert.equal(usageByDay(records, "30", now).length, 30);
assert.deepEqual(usageByDay([], "7", now), []);
assert.equal(usageByDay([record(20, null)], "today", now)[0].totalTokens, null);
const midnight = [
  record(19, tokens(9), { startedAt: date(19, 23, 59) }),
  record(20, tokens(10), { startedAt: date(20, 0) }),
];
assert.deepEqual(
  usageByDay(midnight, "all", now).map((d) => d.totalTokens),
  [9, 10],
);
const gemini = record(
  20,
  normalizeUsage(
    {
      total_input_tokens: 100,
      total_output_tokens: 20,
      total_thought_tokens: 7,
      total_tokens: 130,
    },
    "gemini",
  ),
);
assert.equal(
  usageByDay([gemini], "today", now)[0].totalTokens,
  130,
  "Use the normalized provider total without counting cache/reasoning twice",
);
const totalOnly = record(20, {
  ...tokens(0),
  inputTokens: null,
  outputTokens: null,
  totalTokens: 80,
});
assert.equal(
  usageByDay([totalOnly], "today", now)[0].incomplete,
  false,
  "A final total remains complete even without its breakdown",
);
// Calendar iteration must survive 23-hour and 25-hour days in the local timezone.
for (const [month, day] of [
  [2, 10],
  [10, 3],
]) {
  const end = new Date(2026, month, day, 12),
    start = new Date(2026, month, day - 6, 12);
  const week = usageByDay(
    [{ ...record(20, tokens(1)), startedAt: start.getTime() }],
    "7",
    end,
  );
  assert.equal(week.length, 7);
  assert(week.every((d) => new Date(d.date).getHours() === 0));
  assert.equal(new Date(week.at(-1).date).getDate(), day);
}
console.log(
  "PASS: daily totals, calendar gaps, zero versus missing, incomplete reports, filters, midnight/DST boundaries and provider-total consistency.",
);
