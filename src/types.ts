import type { LocalePreference } from "./locale.js";
export type Protocol =
  "responses" | "anthropic" | "gemini" | "chat" | "typesafe";
export type ModelPurpose = "generation" | "decision";
export type { Locale, LocalePreference } from "./locale.js";
export type ActionKind =
  "translate" | "plain" | "explain" | "summary" | "qa" | "custom";
export type OutputLength = "brief" | "balanced" | "detailed";
export type ActionMode = "paragraph" | "whole";
export type AppearanceTarget = "page" | "selection";
export type Scope = "body" | "all";
export type ReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ProviderModel {
  id: string;
  name: string;
  reasoningEfforts?: ReasoningEffort[];
  adaptiveThinking?: boolean;
}
export interface Connection {
  id: string | null;
  name: string;
  url: string;
  model: string;
  models?: ProviderModel[];
  protocol: Protocol;
  maxTokens: number;
  reasoningEffort?: ReasoningEffort;
  processing?: ProcessingPolicy;
  openaiCache?: "auto" | "explicit";
  connected: boolean;
  hasKey?: boolean;
}
export interface ConnectionDraft extends Connection {
  key?: string;
}
export interface Action {
  id: string;
  name: string;
  description?: string;
  instruction: string;
  kind: ActionKind;
  icon: string;
  mode: ActionMode;
  placement: "inline" | "panel";
  quick: boolean;
  sourceLanguage?: string;
  targetLanguage?: string;
  outputLanguage?: string;
  outputLength?: OutputLength;
  model: string;
  builtin?: boolean;
}
export type ActionEdit = Pick<
  Action,
  | "id"
  | "name"
  | "instruction"
  | "model"
  | "sourceLanguage"
  | "targetLanguage"
  | "outputLanguage"
  | "outputLength"
> & { create?: boolean };
export type ProcessingAction = Pick<Action, "instruction" | "mode"> &
  Partial<Action>;
export type TranslationLanguages = Required<
  Pick<Action, "sourceLanguage" | "targetLanguage">
>;
export interface UiContext {
  pageTitle?: string;
  sectionTitle?: string;
  tableHeaders?: string;
}
export interface TextBlock {
  id: string;
  text: string;
  priority?: number;
  context?: UiContext;
}
export interface ResultPart extends TextBlock {
  source: string;
}
export interface ProcessingPolicy {
  concurrency: number;
  batchChars: number;
  batchCount: number;
}
export interface CacheInfo {
  entries: number;
  bytes: number;
  maxBytes: number;
}
export interface ProcessStats {
  total: number;
  hits: number;
  shared: number;
  requests: number;
  writeFailed?: boolean;
}
export interface ProcessResult {
  parts: ResultPart[];
  mode: ActionMode;
  stats?: ProcessStats;
}
export interface ProcessJob {
  promise: Promise<ProcessResult>;
  cancel(): void;
}
export interface DisplayStyle {
  color: string;
  size: number;
  line: number;
  tint: boolean;
  customTypography?: boolean;
}
export interface Preferences {
  locale: LocalePreference;
  theme: "system" | "light" | "dark";
  palette: string;
  hideDaily?: boolean;
}
export type LightsMode = "off" | "on" | "system";
export interface WebsiteFeatures {
  toolbar: boolean;
  floating: boolean;
  lights: LightsMode;
  enhance: boolean;
}
export type WebsitePatch = {
  [K in keyof WebsiteFeatures]?: WebsiteFeatures[K] | null;
};
export type EnhanceStatus =
  "off" | "ready" | "analyzing" | "done" | "partial" | "error" | "noModel";
export interface WebsiteSettings {
  sites: Record<string, Partial<WebsiteFeatures>>;
}
export type LightsStatus = "off" | "active" | "native" | "external";
export interface Settings {
  website: WebsiteSettings;
  actions: Action[];
  appearance: Record<AppearanceTarget, DisplayStyle>;
  customColors?: string[];
  preferences: Preferences;
  connections: Connection[];
  defaultConnection: string | null;
  defaultDecisionConnection?: string | null;
}
export interface CollectionItem {
  id: string;
  title: string;
  text: string;
  sourceText: string;
  sourceTitle: string;
  url: string;
  actionName: string;
  createdAt: string;
}
export type CollectionInput = Pick<CollectionItem, "text"> &
  Partial<CollectionItem>;
export interface Daily {
  model?: string;
  prompt: string;
  outputLanguage?: string;
  useCollection: boolean;
  result: string | null;
  date: string | null;
}
export interface StoreData {
  configurationRecords?: import("./sync-records.js").SyncReplica;
  settings: Settings;
  credentials: Record<string, string>;
  collection: CollectionItem[];
  daily: Daily;
}
export interface Snapshot extends Settings {
  collection: CollectionItem[];
  daily: Daily;
}
export interface PublicSettings extends Omit<Settings, "connections"> {
  connections: Pick<
    Connection,
    "id" | "name" | "model" | "connected" | "protocol"
  >[];
}
export type UsageSource =
  | "lightsEnhance"
  | "connectionTest"
  | "trial"
  | "preview"
  | "page"
  | "selection"
  | "daily"
  | "processing";
export interface Tokens {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}
export interface UsageUpdate {
  tokens: Tokens;
  final: boolean;
}
export interface UsageDetails {
  instructions: string;
  input: string;
  output: string;
}
export interface UsageRecord {
  id: string;
  startedAt: number;
  durationMs: number;
  connectionId: string | null;
  connectionName: string;
  model: string;
  protocol: Protocol;
  source: UsageSource;
  actionName: string;
  status: "success" | "cancelled" | "error";
  errorCode: string | null;
  tokens: Tokens | null;
  usageFinal: boolean;
}
export interface UsageSummary extends Tokens {
  calls: number;
  reported: number;
  partial: number;
  missing: number;
}
export type UsageCursor = [number, string];
export interface UsageDay {
  date: number;
  totalTokens: number | null;
  calls: number;
  incomplete: boolean;
}
export interface UsageOverview {
  summary: UsageSummary;
  days: UsageDay[];
  models: { value: string; model: string; connectionName: string }[];
  totalRecords: number;
}
export interface UsageFilter {
  period: string;
  model: string;
}
export interface ProcessPayload {
  translation?: TranslationLanguages;
  refresh?: boolean;
  action?: ProcessingAction;
  actionId?: string;
  blocks?: TextBlock[];
  source?: UsageSource;
  stream?: boolean;
  daily?: Daily;
  saveDaily?: boolean;
}
export type ProcessMessage =
  | { type: "delta"; id: string; text: string }
  | { type: "progress"; parts: ResultPart[]; stats?: ProcessStats }
  | { type: "done"; result: ProcessResult }
  | { type: "error"; error: string; detail?: string };
export interface ExtractedBlock extends TextBlock {
  element: HTMLElement;
}
export interface Sample {
  title: string;
  paragraphs: string[];
}

export interface PublicConfig extends PublicSettings {
  strings: {
    [
      Key in keyof import("./copy.js").Copy["real"] as import("./copy.js").Copy["real"][Key] extends (
        ...args: never[]
      ) => unknown
        ? never
        : Key
    ]: import("./copy.js").Copy["real"][Key];
  };
}
export interface RequestMap {
  "sync.status": { payload: {}; result: import("./config-sync.js").SyncStatus };
  "sync.connect": {
    payload: {
      passphrase: string;
      action: import("./config-sync.js").SyncConnect;
      revision: string | null;
    };
    result: import("./config-sync.js").SyncStatus;
  };
  "sync.run": { payload: {}; result: import("./config-sync.js").SyncStatus };
  "sync.stop": { payload: {}; result: import("./config-sync.js").SyncStatus };
  "sync.clear": { payload: {}; result: import("./config-sync.js").SyncStatus };
  snapshot: { payload: {}; result: Snapshot };
  "settings.public": { payload: {}; result: PublicConfig };
  "settings.open": {
    payload: { tabId?: number | null; route?: string };
    result: boolean;
  };
  "actions.save": { payload: { changes: ActionEdit[] }; result: PublicConfig };
  "website.update": {
    payload: {
      tabId?: number;
      patch: WebsitePatch | null;
    };
    result: WebsiteSettings;
  };
  "lights.cached": {
    payload: { candidates: import("./lights-decision.js").LightCandidate[] };
    result: import("./lights-decision.js").LightDecision[];
  };
  "lights.enhance": {
    payload: { candidates: import("./lights-decision.js").LightCandidate[] };
    result: import("./lights-decision.js").LightDecision[];
  };
  "lights.cancel": { payload: {}; result: boolean };
  "lights.proxy": { payload: {}; result: boolean };
  "lights.fetch": {
    payload: { url: string };
    result: { body: string; type: string; binary: boolean };
  };
  "settings.save": {
    payload: {
      patch: Partial<
        Pick<
          Settings,
          | "actions"
          | "appearance"
          | "customColors"
          | "preferences"
          | "defaultConnection"
          | "defaultDecisionConnection"
        >
      >;
    };
    result: boolean;
  };
  "cache.stats": { payload: {}; result: CacheInfo };
  "cache.clear": { payload: {}; result: boolean };
  "usage.list": {
    payload: { filter?: UsageFilter; before?: UsageCursor };
    result: UsageRecord[];
  };
  "usage.overview": {
    payload: { filter?: UsageFilter };
    result: UsageOverview;
  };
  "usage.details": { payload: { id: string }; result: UsageDetails | null };
  "usage.clear": { payload: {}; result: boolean };
  "collection.add": {
    payload: { item: CollectionInput };
    result: CollectionItem;
  };
  "collection.remove": { payload: { id: string }; result: boolean };
  "daily.save": { payload: { daily: Daily }; result: Daily };
  "connection.save": {
    payload: { connection: ConnectionDraft; key?: string };
    result: Connection;
  };
  "connection.test": {
    payload: {
      connection: Pick<Connection, "id" | "url" | "protocol">;
      key?: string;
    };
    result: ProviderModel[];
  };
  "connection.remove": { payload: { id: string }; result: boolean };
  "tab.enable": { payload: { tabId: number }; result: boolean };
  "tab.run": {
    payload: {
      tabId: number;
      actionId: string;
      scope: string;
      panel?: boolean;
      translation?: TranslationLanguages;
    };
    result: boolean;
  };
  "tab.restore": { payload: { tabId: number }; result: boolean };
  "page.status": {
    payload: {
      done: boolean;
      error?: string;
      completed: number;
      total: number;
      parts: ResultPart[];
    };
    result: boolean;
  };
}
export type RequestMessage = {
  [K in keyof RequestMap]: { type: K } & RequestMap[K]["payload"];
}[keyof RequestMap];
