import { checkResponse, endpoint, ModelError } from "./providers.js";
import { normalizeUsage } from "./usage.js";
import type { Connection, UsageUpdate } from "./types.js";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}
export interface DecisionInput {
  state: unknown;
  questions: Record<string, ChoiceQuestion>;
  assets?: Record<
    string,
    { type: "image"; format: "png"; data_base64: string }
  >;
}
export interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export async function callDecision(
  connection: Connection,
  key: string,
  input: DecisionInput,
  signal: AbortSignal,
  onUsage: (usage: UsageUpdate) => void,
  onOutput: (text: string) => void = () => {},
): Promise<Record<string, ChoiceAnswer>> {
  if (connection.protocol !== "typesafe")
    throw new ModelError("invalidProtocol");
  const timeout = AbortSignal.timeout(30000);
  try {
    const response = await fetch(endpoint(connection), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(Object.keys(input.assets || {}).length
          ? { "TypeSafe-Danger-Zone-Images": "true" }
          : {}),
      },
      body: JSON.stringify({ ...input, model: connection.model }),
      signal: AbortSignal.any([signal, timeout]),
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    await checkResponse(response);
    const data = await response.json().catch(() => {
      throw new ModelError("invalidDecision");
    });
    onOutput(JSON.stringify(data, null, 2));
    if (data?.usage)
      onUsage({ tokens: normalizeUsage(data.usage, "typesafe"), final: true });
    const answers: Record<string, ChoiceAnswer> = {};
    for (const [id, question] of Object.entries(input.questions)) {
      const answer = data?.answers?.[id];
      const probability = (value: unknown) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1;
      if (
        answer?.type !== "choice" ||
        !Object.hasOwn(question.criteria, answer.choice) ||
        !probability(answer.confidence) ||
        !answer.probabilities ||
        Object.keys(question.criteria).some(
          (key) => !probability(answer.probabilities[key]),
        )
      )
        throw new ModelError("invalidDecision");
      answers[id] = {
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      };
    }
    return answers;
  } catch (caught) {
    if (signal.aborted) throw new ModelError("cancelled");
    if (timeout.aborted) throw new ModelError("timeout");
    if (caught instanceof ModelError) {
      if (key) caught.message = caught.message.replaceAll(key, "[redacted]");
      throw caught;
    }
    throw new ModelError("networkError");
  }
}
