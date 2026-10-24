import {
  reasoningSpec,
  ANTHROPIC_EFFORTS,
  type ModelConnection,
} from "./model-spec.js";
import { normalizeUsage } from "./usage.js";
import type {
  Connection,
  Protocol,
  ModelPurpose,
  UsageUpdate,
  ProviderModel,
  PublicSettings,
} from "./types.js";

export class ModelError extends Error {
  constructor(
    public code: string,
    detail = "",
  ) {
    super(detail || code);
  }
}
export function modelError(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  const code =
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : /Extension context invalidated|message (?:port|channel) closed|Receiving end does not exist/i.test(
            detail,
          )
        ? "extensionDisconnected"
        : "serviceError";
  return new ModelError(code, detail);
}
type Wire = Record<string, unknown>;
const object = (value: unknown): Wire =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Wire)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
export { reasoningLevels } from "./model-spec.js";
export function reasoningBody(connection: ModelConnection): Wire {
  const effort = connection.reasoningEffort;
  if (effort === undefined) return {};
  const spec = reasoningSpec(connection);
  if (!spec?.levels.includes(effort)) throw new ModelError("invalidReasoning");
  if (spec.disableThinking?.includes(effort))
    return { thinking: { type: "disabled" } };
  const thinking = spec.thinking ? { thinking: { type: spec.thinking } } : {};
  switch (connection.protocol) {
    case "responses":
      return { reasoning: { effort } };
    case "chat":
      return { reasoning_effort: effort, ...thinking };
    case "gemini":
      return { generation_config: { thinking_level: effort } };
    case "anthropic":
      return { output_config: { effort }, ...thinking };
    default:
      throw new ModelError("invalidReasoning");
  }
}
// Temporarily suspend decision models and Enhance without removing saved configuration.
export const DECISION_MODELS_ENABLED = false;
export const connectionPurpose = (
  connection: Pick<Connection, "protocol">,
): ModelPurpose =>
  connection.protocol === "typesafe" ? "decision" : "generation";
export const connectionAvailable = (connection: Pick<Connection, "protocol">) =>
  DECISION_MODELS_ENABLED || connectionPurpose(connection) === "generation";
export function hasDefaultModel(
  settings: Pick<PublicSettings, "connections" | "defaultConnection">,
) {
  return settings.connections.some(
    (connection) =>
      connection.id === settings.defaultConnection &&
      Boolean(connection.id) &&
      connection.connected &&
      Boolean(connection.model.trim()) &&
      connectionPurpose(connection) === "generation",
  );
}
export const defaultConnectionKey = (
  connection: Pick<Connection, "protocol">,
) =>
  connectionPurpose(connection) === "decision"
    ? "defaultDecisionConnection"
    : "defaultConnection";
export const protocolDefaults: Record<Protocol, string> = {
  typesafe: "https://api.typesafe.ai/v1",
  responses: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  chat: "https://api.openai.com/v1",
};
export function endpoint(
  connection: Pick<Connection, "url" | "protocol">,
): string {
  let url: URL;
  try {
    url = new URL(connection.url);
  } catch {
    throw new ModelError("invalidUrl");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new ModelError("invalidUrl");
  const path = {
    typesafe: "/systemone",
    chat: "/chat/completions",
    responses: "/responses",
    anthropic: "/messages",
    gemini: "/interactions",
  }[connection.protocol];
  if (!path) throw new ModelError("invalidProtocol");
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith(path)) url.pathname += path;
  return url.href;
}
export function modelsEndpoint(
  connection: Pick<Connection, "url" | "protocol">,
): string {
  const url = new URL(endpoint(connection));
  url.pathname = url.pathname.replace(
    /\/(?:chat\/completions|responses|messages|interactions|systemone)$/,
    "/models",
  );
  return url.href;
}
function providerHeaders(
  protocol: Protocol,
  key: string,
): Record<string, string> {
  if (protocol === "anthropic")
    return {
      "anthropic-version": "2023-06-01",
      ...(key ? { "x-api-key": key } : {}),
    };
  if (protocol === "gemini") return key ? { "x-goog-api-key": key } : {};
  return key ? { Authorization: `Bearer ${key}` } : {};
}
export async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const body = object(await response.json().catch(() => null));
  const detail = string(object(body.error).message || body.message).slice(
    0,
    240,
  );
  throw new ModelError(
    response.status === 401 || response.status === 403
      ? "authError"
      : response.status === 429
        ? "rateLimited"
        : "serviceError",
    `HTTP ${response.status}${detail ? ": " + detail : ""}`,
  );
}
export async function listModels(
  connection: Pick<Connection, "url" | "protocol">,
  key: string,
): Promise<ProviderModel[]> {
  const url = new URL(modelsEndpoint(connection));
  const timeout = AbortSignal.timeout(30000);
  const models = new Map<string, ProviderModel>(),
    cursors = new Set<string>();
  try {
    for (;;) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          ...providerHeaders(connection.protocol, key),
          Accept: "application/json",
        },
        signal: timeout,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      await checkResponse(response);
      const data = object(
        await response.json().catch(() => {
          throw new ModelError("invalidModelList");
        }),
      );
      const entries = ["gemini", "typesafe"].includes(connection.protocol)
        ? data.models
        : data.data;
      if (!Array.isArray(entries)) throw new ModelError("invalidModelList");
      for (const entry of entries) {
        const model = object(entry);
        const id = (
          connection.protocol === "typesafe"
            ? string(model.name)
            : connection.protocol === "gemini"
              ? string(model.name).replace(/^models\//, "")
              : string(model.id)
        ).trim();
        if (!id) throw new ModelError("invalidModelList");
        const name =
          string(
            connection.protocol === "gemini"
              ? model.displayName
              : model.display_name,
          ).trim() || id;
        const capabilities = object(model.capabilities),
          effort = object(capabilities.effort),
          adaptive = object(
            object(object(capabilities.thinking).types).adaptive,
          );
        models.set(id, {
          id,
          name,
          ...(connection.protocol === "anthropic" &&
          typeof effort.supported === "boolean"
            ? {
                reasoningEfforts: ANTHROPIC_EFFORTS.filter(
                  (level) =>
                    effort.supported &&
                    object(effort[level]).supported === true,
                ),
              }
            : {}),
          ...(connection.protocol === "anthropic" &&
          typeof adaptive.supported === "boolean"
            ? { adaptiveThinking: adaptive.supported }
            : {}),
        });
      }
      const cursor =
        connection.protocol === "gemini"
          ? string(data.nextPageToken)
          : connection.protocol === "anthropic" && data.has_more
            ? string(data.last_id)
            : "";
      if (connection.protocol === "anthropic" && data.has_more && !cursor)
        throw new ModelError("invalidModelList");
      if (!cursor) break;
      if (cursors.has(cursor)) throw new ModelError("invalidModelList");
      cursors.add(cursor);
      url.searchParams.set(
        connection.protocol === "gemini" ? "pageToken" : "after_id",
        cursor,
      );
    }
    return [...models.values()];
  } catch (error) {
    if (timeout.aborted) throw new ModelError("timeout");
    if (error instanceof ModelError) {
      if (key) error.message = error.message.replaceAll(key, "[redacted]");
      throw error;
    }
    throw new ModelError("networkError");
  }
}
export async function promptCacheKey(
  connection: ModelConnection,
  instructions: string,
): Promise<string> {
  // Variable page text, timestamps and batch IDs must never alter routing for the rules prefix.
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      connection.id ?? connection.url,
      connection.model,
      instructions,
      ...(connection.reasoningEffort === undefined
        ? []
        : [reasoningBody(connection)]),
    ]),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function requestBody(
  connection: ModelConnection,
  instructions: string,
  input: string,
): Promise<Wire> {
  const max = connection.maxTokens;
  if (max !== undefined && (!Number.isSafeInteger(max) || max <= 0))
    throw new ModelError("invalidConnection");
  const reasoning = reasoningBody(connection);
  const common = { model: connection.model, stream: true, ...reasoning };
  switch (connection.protocol) {
    case "responses": {
      const prefix: Wire = { type: "input_text", text: instructions };
      // An explicit capability choice: never infer support from a model-name substring.
      if (connection.openaiCache === "explicit")
        prefix.prompt_cache_breakpoint = { mode: "explicit" };
      return {
        ...common,
        store: false,
        input: [
          { role: "developer", content: [prefix] },
          { role: "user", content: [{ type: "input_text", text: input }] },
        ],
        prompt_cache_key: await promptCacheKey(connection, instructions),
        ...(connection.openaiCache === "explicit"
          ? { prompt_cache_options: { mode: "explicit" } }
          : {}),
        ...(max ? { max_output_tokens: max } : {}),
      };
    }
    case "anthropic":
      return {
        ...common,
        system: [
          {
            type: "text",
            text: instructions,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: input }],
        max_tokens: max ?? 8192,
      };
    case "gemini":
      return {
        ...common,
        model: `models/${connection.model.replace(/^models\//, "")}`,
        store: false,
        system_instruction: instructions,
        input: [
          { type: "user_input", content: [{ type: "text", text: input }] },
        ],
        ...(max || reasoning.generation_config
          ? {
              generation_config: {
                ...object(reasoning.generation_config),
                ...(max ? { max_output_tokens: max } : {}),
              },
            }
          : {}),
      };
    case "chat":
      return {
        ...common,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
      };
    default:
      throw new ModelError("invalidProtocol");
  }
}

export async function readResponse(
  response: Response,
  protocol: Protocol,
  onDelta: (text: string) => void = () => {},
  onUsage: (usage: UsageUpdate) => void = () => {},
): Promise<string> {
  let rawUsage: Wire = {},
    hasUsage = false;
  const usage = (patch: unknown, final = false) => {
    const fields = object(patch);
    if (Object.keys(fields).length) {
      rawUsage = { ...rawUsage, ...fields };
      hasUsage = true;
    }
    if (hasUsage)
      onUsage({ tokens: normalizeUsage(rawUsage, protocol), final });
  };
  await checkResponse(response);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const value = object(await response.json());
    usage(value.usage, true);
    if (value.error)
      throw new ModelError(
        "serviceError",
        string(object(value.error).message).slice(0, 240),
      );
    const choice = object(array(value.choices)[0]);
    const contentText = (content: unknown, type: string) =>
      array(content)
        .filter((item) => object(item).type === type)
        .map((item) => string(object(item).text))
        .join("");
    const text =
      protocol === "responses"
        ? array(value.output)
            .map((item) => contentText(object(item).content, "output_text"))
            .join("")
        : protocol === "anthropic"
          ? contentText(value.content, "text")
          : protocol === "gemini"
            ? string(value.output_text) ||
              array(value.steps)
                .filter((step) => object(step).type === "model_output")
                .map((step) => contentText(object(step).content, "text"))
                .join("")
            : string(object(choice.message).content);
    if (text) onDelta(text);
    if (
      value.status === "incomplete" ||
      choice.finish_reason === "length" ||
      value.stop_reason === "max_tokens"
    )
      throw new ModelError("outputLimit");
    if (value.status && value.status !== "completed")
      throw new ModelError("serviceError");
    if (!text.trim()) throw new ModelError("emptyOutput");
    return text;
  }
  if (!response.body) throw new ModelError("interrupted");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    output = "",
    done = false,
    outputError: string | undefined;
  const parse = (frame: string) => {
    if (done) return;
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      if (protocol === "chat") done = true;
      return;
    }
    let value: Wire;
    try {
      value = object(JSON.parse(data));
    } catch {
      throw new ModelError("invalidOutput");
    }
    const response = object(value.response),
      delta = object(value.delta),
      interaction = object(value.interaction);
    if (protocol === "chat" && value.usage) usage(value.usage, true);
    if (protocol === "responses" && response.usage)
      usage(
        response.usage,
        [
          "response.completed",
          "response.failed",
          "response.incomplete",
        ].includes(string(value.type)),
      );
    if (protocol === "anthropic") {
      if (value.type === "message_start") usage(object(value.message).usage);
      if (value.type === "message_delta")
        usage(
          value.usage,
          Boolean(delta.stop_reason) &&
            Number.isSafeInteger(object(value.usage).output_tokens),
        );
    }
    if (protocol === "gemini") {
      const counts = object(value.metadata).total_usage ?? interaction.usage;
      if (counts) usage(counts, value.event_type === "interaction.completed");
    }
    if (value.error || value.type === "error" || value.event_type === "error")
      throw new ModelError(
        "serviceError",
        string(object(value.error).message).slice(0, 240),
      );
    let text = "";
    if (protocol === "chat") {
      const choice = object(array(value.choices)[0]);
      if (choice.finish_reason === "length") outputError = "outputLimit";
      if (choice.finish_reason === "content_filter")
        outputError = "serviceError";
      text = string(object(choice.delta).content);
    } else if (protocol === "responses") {
      if (value.type === "response.output_text.delta")
        text = string(value.delta);
      if (value.type === "response.failed") outputError = "serviceError";
      if (value.type === "response.incomplete")
        outputError =
          object(response.incomplete_details).reason === "content_filter"
            ? "serviceError"
            : "outputLimit";
      if (
        [
          "response.completed",
          "response.failed",
          "response.incomplete",
        ].includes(string(value.type))
      )
        done = true;
    } else if (protocol === "anthropic") {
      if (value.type === "content_block_delta" && delta.type === "text_delta")
        text = string(delta.text);
      if (value.type === "message_delta" && delta.stop_reason === "max_tokens")
        outputError = "outputLimit";
      if (
        value.type === "message_delta" &&
        ["refusal", "pause_turn", "tool_use"].includes(
          string(delta.stop_reason),
        )
      )
        outputError = "serviceError";
      if (value.type === "message_stop") done = true;
    } else {
      if (value.event_type === "step.delta" && delta.type === "text")
        text = string(delta.text);
      const status = value.status ?? interaction.status;
      if (status === "incomplete") outputError = "outputLimit";
      if (["failed", "cancelled", "requires_action"].includes(string(status)))
        outputError = "serviceError";
      if (value.event_type === "interaction.completed" || outputError)
        done = true;
    }
    if (text) {
      output += text;
      onDelta(text);
    }
  };
  // Decode incrementally: UTF-8 characters, CRLF pairs and SSE frames can cross network chunks.
  let trailingCR = "";
  const feed = (text: string, eof: boolean) => {
    text = trailingCR + text;
    trailingCR = "";
    if (!eof && text.endsWith("\r")) {
      trailingCR = "\r";
      text = text.slice(0, -1);
    }
    buffer += text.replace(/\r\n?/g, "\n");
    let at: number;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
    }
    if (eof && buffer.trim()) parse(buffer);
  };
  try {
    while (!done) {
      const part = await reader.read();
      feed(decoder.decode(part.value, { stream: !part.done }), part.done);
      if (part.done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (outputError) throw new ModelError(outputError);
  if (!done) throw new ModelError("interrupted");
  if (!output.trim()) throw new ModelError("emptyOutput");
  return output;
}
export type ModelCall = (
  connection: ModelConnection,
  key: string,
  instructions: string,
  input: string,
  signal: AbortSignal,
  onDelta?: (text: string) => void,
  onUsage?: (usage: UsageUpdate) => void,
) => Promise<string>;
export const callModel: ModelCall = async (
  connection,
  key,
  instructions,
  input,
  signal,
  onDelta,
  onUsage,
) => {
  if (connectionPurpose(connection) !== "generation")
    throw new ModelError("invalidProtocol");
  const url = endpoint(connection),
    headers: Record<string, string> = {
      ...providerHeaders(connection.protocol, key),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
  const timeout = AbortSignal.timeout(120000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(await requestBody(connection, instructions, input)),
      signal: AbortSignal.any([signal, timeout]),
      redirect: "error",
      credentials: "omit",
    });
    return await readResponse(response, connection.protocol, onDelta, onUsage);
  } catch (error) {
    if (signal.aborted) throw new ModelError("cancelled");
    if (timeout.aborted) throw new ModelError("timeout");
    if (error instanceof ModelError) {
      if (key) error.message = error.message.replaceAll(key, "[redacted]");
      throw error;
    }
    throw new ModelError("networkError");
  }
};
