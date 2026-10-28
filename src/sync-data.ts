import type { SyncData } from "./sync-records.js";
import { configurationText, DEFAULT_MODEL_KEYS } from "./sync-records.js";
import { PRESET_ACTION_IDS } from "./action-policy.js";
export type { SyncData } from "./sync-records.js";
export const SYNC_VERSION = 2;
export const SYNC_MIN_PASSPHRASE = 12;
const KDF_ITERATIONS = 600_000;
const MAX_PLAIN_BYTES = 1_048_576;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export interface SyncEnvelope {
  version: number;
  revision: string;
  parent: string | null;
  salt: string;
  iv: string;
  updatedAt: number;
  ciphertext: string;
}
export class SyncError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export async function configurationHash(data: SyncData): Promise<string> {
  return base64(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(configurationText(data)),
      ),
    ),
  );
}
export function base64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
export function newSalt(): string {
  return base64(crypto.getRandomValues(new Uint8Array(16)));
}
export async function deriveSyncKey(
  passphrase: string,
  salt: string,
): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return base64(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          iterations: KDF_ITERATIONS,
          salt: bytes(salt),
        },
        material,
        256,
      ),
    ),
  );
}
async function keyFromBytes(key: string) {
  return crypto.subtle.importKey("raw", bytes(key), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
function additionalData(envelope: Omit<SyncEnvelope, "ciphertext">) {
  return encoder.encode(
    JSON.stringify([
      envelope.version,
      envelope.revision,
      envelope.parent,
      envelope.salt,
      envelope.updatedAt,
    ]),
  );
}
async function transform(
  input: Uint8Array<ArrayBuffer>,
  decompress: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([input])
    .stream()
    .pipeThrough(
      decompress
        ? new DecompressionStream("gzip")
        : new CompressionStream("gzip"),
    );
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PLAIN_BYTES) {
      await reader.cancel();
      throw new SyncError("tooLarge");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function encryptConfiguration(
  data: SyncData,
  key: string,
  salt: string,
  parent: string | null = null,
): Promise<SyncEnvelope> {
  const plain = encoder.encode(configurationText(data));
  if (plain.length > MAX_PLAIN_BYTES) throw new SyncError("tooLarge");
  const envelope = {
    version: SYNC_VERSION,
    revision: crypto.randomUUID(),
    parent,
    salt,
    iv: base64(crypto.getRandomValues(new Uint8Array(12))),
    updatedAt: Date.now(),
  };
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: bytes(envelope.iv),
      additionalData: additionalData(envelope),
    },
    await keyFromBytes(key),
    await transform(plain, false),
  );
  return { ...envelope, ciphertext: base64(new Uint8Array(ciphertext)) };
}
export async function decryptConfiguration(
  envelope: SyncEnvelope,
  key: string,
): Promise<SyncData> {
  if (envelope.version !== SYNC_VERSION) throw new SyncError("version");
  let compressed: ArrayBuffer;
  try {
    compressed = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(envelope.iv),
        additionalData: additionalData(envelope),
      },
      await keyFromBytes(key),
      bytes(envelope.ciphertext),
    );
  } catch {
    throw new SyncError("wrongPassphrase");
  }
  try {
    const value: unknown = JSON.parse(
      decoder.decode(await transform(new Uint8Array(compressed), true)),
    );
    validateConfiguration(value);
    return value;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError("invalidData");
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string";
}
function optionalText(value: unknown) {
  return value === undefined || text(value);
}
function oneOf(value: unknown, values: readonly unknown[]) {
  return values.includes(value);
}
function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}
function ensure(value: unknown): asserts value {
  if (!value) throw new SyncError("invalidData");
}
// Authenticate and validate every record before applying any of the document.
export function validateConfiguration(
  value: unknown,
): asserts value is SyncData {
  ensure(object(value) && object(value.connections) && object(value.actions));
  keys(value, ["connections", "actions", "daily", "defaults"]);
  if (value.defaults !== undefined) {
    ensure(object(value.defaults));
    keys(value.defaults, [...DEFAULT_MODEL_KEYS]);
    for (const record of Object.values(value.defaults)) {
      validateRecord(record);
      ensure(record.value === null || text(record.value));
      if (text(record.value)) identity(record.value);
    }
  }
  for (const [id, record] of Object.entries(value.connections)) {
    identity(id);
    const c = recordValue(record);
    if (c === null) continue;
    keys(c, [
      "id",
      "name",
      "url",
      "model",
      "protocol",
      "maxTokens",
      "reasoningEffort",
      "processing",
      "openaiCache",
      "connected",
      "key",
    ]);
    ensure(
      c.id === id &&
        text(c.name) &&
        text(c.url) &&
        text(c.model) &&
        text(c.key),
    );
    const url = new URL(c.url);
    ensure(
      url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)),
    );
    ensure(!url.username && !url.password);
    ensure(
      oneOf(c.protocol, [
        "responses",
        "chat",
        "anthropic",
        "gemini",
        "typesafe",
      ]) &&
        finite(c.maxTokens) &&
        typeof c.connected === "boolean",
    );
    ensure(
      c.reasoningEffort === undefined ||
        oneOf(c.reasoningEffort, [
          "none",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ]),
    );
    ensure(
      c.openaiCache === undefined || oneOf(c.openaiCache, ["auto", "explicit"]),
    );
    if (c.processing !== undefined) {
      ensure(object(c.processing));
      keys(c.processing, ["concurrency", "batchChars", "batchCount"]);
      ensure(
        ["concurrency", "batchChars", "batchCount"].every((key) =>
          finite((c.processing as Record<string, unknown>)[key]),
        ),
      );
    }
  }
  for (const [id, record] of Object.entries(value.actions)) {
    identity(id);
    const a = recordValue(record);
    if (a === null) {
      ensure(!PRESET_ACTION_IDS.some((preset) => preset === id));
      continue;
    }
    keys(a, [
      "id",
      "name",
      "description",
      "instruction",
      "kind",
      "icon",
      "mode",
      "placement",
      "sourceLanguage",
      "targetLanguage",
      "outputLanguage",
      "outputLength",
      "model",
      "builtin",
    ]);
    ensure(
      a.id === id &&
        ["name", "instruction", "icon", "model"].every((key) => text(a[key])) &&
        optionalText(a.description),
    );
    ensure(
      oneOf(a.kind, [
        "translate",
        "plain",
        "explain",
        "summary",
        "qa",
        "custom",
      ]) &&
        oneOf(a.mode, ["paragraph", "whole"]) &&
        oneOf(a.placement, ["inline", "panel"]),
    );
    ensure(
      [
        "sourceLanguage",
        "targetLanguage",
        "outputLanguage",
        "outputLength",
      ].every((key) => optionalText(a[key])),
    );
    ensure(a.builtin === undefined || typeof a.builtin === "boolean");
  }
  const d = recordValue(value.daily);
  ensure(
    d !== null &&
      text(d.prompt) &&
      optionalText(d.model) &&
      optionalText(d.outputLanguage) &&
      typeof d.useCollection === "boolean",
  );
  keys(d, ["prompt", "model", "outputLanguage", "useCollection"]);
}
function identity(id: string) {
  ensure(
    /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(id) &&
      !["__proto__", "constructor", "prototype"].includes(id),
  );
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  ensure(Object.keys(value).every((key) => allowed.includes(key)));
}
function validateRecord(
  record: unknown,
): asserts record is Record<string, unknown> {
  ensure(object(record));
  keys(record, ["updatedAt", "writer", "value"]);
  ensure(
    Number.isSafeInteger(record.updatedAt) &&
      (record.updatedAt as number) >= 0 &&
      text(record.writer) &&
      record.writer.length <= 128,
  );
}
function recordValue(record: unknown): Record<string, unknown> | null {
  validateRecord(record);
  ensure(record.value === null || object(record.value));
  return record.value;
}
