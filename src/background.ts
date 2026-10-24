import { resolveLocale } from "./locale.js";
import { trackRecentTabs, switchRecentTab } from "./recent-tabs.js";
import { RequestScheduler } from "./scheduler.js";
import { callDecision } from "./decision.js";
import {
  validateCandidates,
  lightsDecisionInput,
  lightsEffect,
  lightsCacheKey,
} from "./lights-decision.js";
import type { LightCandidate, LightDecision } from "./lights-decision.js";
import { resolveWebsite, updateWebsite, websiteHostname } from "./website.js";
import {
  hasOutputLanguage,
  resolveOutputLanguage,
  DEFAULT_OUTPUT_LENGTH,
  OUTPUT_LENGTH_PROMPTS,
} from "./prompts.js";
import type {
  Action,
  Settings,
  Connection,
  RequestMessage,
  ProcessPayload,
  UsageSource,
  UsageRecord,
  UsageDetails,
  Tokens,
  UsageUpdate,
} from "./types.js";
import type { ModelCall } from "./providers.js";
import {
  initialize,
  readStore,
  snapshot,
  mutate,
  publicSettings,
  addCollection,
} from "./store.js";
import {
  endpoint,
  modelsEndpoint,
  listModels,
  reasoningBody,
  connectionPurpose,
  defaultConnectionKey,
  connectionAvailable,
  DECISION_MODELS_ENABLED,
  callModel,
  ModelError,
  modelError,
} from "./providers.js";
import { createProcessor, processingPolicy } from "./processor.js";
import { IndexedResultCache } from "./cache.js";
import {
  addUsage,
  listUsage,
  getUsageDetails,
  usageOverview,
  clearUsage,
} from "./usage-store.js";
import { actionLimitError, isPresetAction } from "./action-policy.js";
import { hasSameLanguages } from "./translation.js";
const resultCache = new IndexedResultCache();
const processContent = createProcessor(resultCache);
import { localizeAction, messages, usesPresetDefaults } from "./copy.js";
const extensionOrigin = chrome.runtime.getURL("");
const trusted = (sender: chrome.runtime.MessageSender | undefined) =>
  sender?.id === chrome.runtime.id && sender.url?.startsWith(extensionOrigin);
const localeOf = (settings: Settings) =>
  resolveLocale(settings.preferences.locale);
const resolveAction = (action: Action | undefined, settings: Settings) =>
  action ? localizeAction(action, localeOf(settings)) : undefined;
function validateOutputLanguage(value: string | undefined) {
  if (
    value !== undefined &&
    value !== "interface" &&
    (value === "auto" || !Object.hasOwn(messages.en.languages, value))
  )
    throw new ModelError("invalidAction");
}
function validateOutputLength(value: string | undefined) {
  if (value !== undefined && !Object.hasOwn(OUTPUT_LENGTH_PROMPTS, value))
    throw new ModelError("invalidAction");
}
const publicConfig = (settings: Settings) => ({
  ...publicSettings(settings),
  actions: settings.actions.map((a) => resolveAction(a, settings)!),
  strings: messages[localeOf(settings)].real,
});
// Eligibility follows the top-level website, even for related about/data/blob
// frames. All URL/frame fields here are supplied by Chrome, never by a message.
function lightsWebsite(sender: chrome.runtime.MessageSender): string {
  const top = sender.tab?.url || (sender.frameId === 0 ? sender.url : "") || "";
  const frame = sender.url || "";
  if (
    sender.tab?.id === undefined ||
    !/^https?:\/\//i.test(top) ||
    !(
      /^https?:\/\//i.test(frame) ||
      (Boolean(sender.frameId) &&
        /^(about:(blank|srcdoc)(?:[?#]|$)|blob:|data:)/i.test(frame))
    )
  )
    throw new ModelError("notAllowed");
  return top;
}
async function ensureLights(tabId: number) {
  // A normal settings acknowledgement may come from content.js instead. Probe
  // the lights controller explicitly before recovering a missing receiver.
  const status = await chrome.tabs
    .sendMessage(tabId, { type: "lights.status" }, { frameId: 0 })
    .catch(() => null);
  if (status) return;
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["lights.js"],
  });
  // The controller replies after reading and applying the saved configuration.
  await chrome.tabs.sendMessage(
    tabId,
    { type: "lights.status" },
    { frameId: 0 },
  );
}
async function broadcastSettings(
  settings: Settings,
  recoverLightsFor?: string,
  sourceTabId?: number,
) {
  const config = publicConfig(settings);
  await Promise.all(
    (await chrome.tabs.query({}))
      .filter((tab) => tab.id !== undefined)
      .map((tab) => {
        const update = (async () => {
          await chrome.tabs
            .sendMessage(tab.id!, { type: "settings.updated", config })
            .catch(() => {});
          if (
            recoverLightsFor !== undefined &&
            /^https?:\/\//i.test(tab.url || "") &&
            websiteHostname(tab.url!) === recoverLightsFor
          )
            // Closed/restricted tabs must not prevent other pages from syncing.
            await ensureLights(tab.id!).catch(() => {});
        })();
        // Persistence must not wait for acknowledgements from unrelated pages.
        // A website control still waits for its own page to apply the change.
        if (tab.id === sourceTabId) return update;
      }),
  );
  return config;
}
const failure = (caught: unknown) => {
  const error = modelError(caught);
  return {
    ok: false,
    error: error.code,
    detail: error.message !== error.code ? error.message : "",
  };
};
async function inject(tabId: number | undefined) {
  if (tabId === undefined) throw new ModelError("notAllowed");
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["extract.js", "content.js"],
  });
  // Bundled classic scripts start initialization asynchronously. Wait for the
  // shared controller promise before delivering the action to its listener.
  const [controller] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        if (!globalThis.__pagework) return { ready: false, detail: "" };
        await globalThis.__pagework;
        return { ready: true, detail: "" };
      } catch (error) {
        return {
          ready: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
  if (!controller?.result?.ready)
    throw new ModelError("extensionDisconnected", controller?.result?.detail);
  return tabId;
}
async function openSettings(tabId: number | undefined, route = "home") {
  await chrome.tabs.create({
    url: chrome.runtime.getURL(
      `index.html${tabId ? `?tab=${tabId}` : ""}#${route}`,
    ),
  });
}
function assertTrusted(sender: chrome.runtime.MessageSender) {
  if (!trusted(sender)) throw new ModelError("notAllowed");
}
async function connectionFor(settings: Settings, id: string | undefined) {
  const connection = settings.connections.find(
    (c) => c.id === (id === "default" ? settings.defaultConnection : id),
  );
  if (!connection?.id || connectionPurpose(connection) !== "generation")
    throw new ModelError("noConnection");
  return connection;
}
let selectionMenuUpdate = Promise.resolve();
function syncSelectionMenu() {
  // Menu rebuilds must stay ordered when action and language saves overlap.
  const update = selectionMenuUpdate
    .catch(() => {})
    .then(async () => {
      const { settings } = await readStore();
      const create = (item: chrome.contextMenus.CreateProperties) =>
        new Promise<void>((resolve, reject) => {
          chrome.contextMenus.create(item, () => {
            if (chrome.runtime.lastError)
              reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          });
        });
      await new Promise<void>((resolve, reject) => {
        chrome.contextMenus.removeAll(() => {
          if (chrome.runtime.lastError)
            reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
      await create({
        id: "selection",
        title: messages[localeOf(settings)].real.processSelection,
        contexts: ["selection"],
        enabled: settings.actions.length > 0,
      });
      for (const action of settings.actions) {
        await create({
          id: `selection:${action.id}`,
          parentId: "selection",
          title: resolveAction(action, settings)!.name,
          contexts: ["selection"],
        });
      }
    });
  selectionMenuUpdate = update;
  return update;
}
chrome.runtime.onInstalled.addListener(async (details) => {
  await initialize();
  const registrations = await chrome.scripting.getRegisteredContentScripts();
  const sites = registrations
    .filter((script) => script.id.startsWith("site-"))
    .map((script) => script.id);
  if (sites.length)
    await chrome.scripting.unregisterContentScripts({ ids: sites });
  await syncSelectionMenu();
  if (details.reason === "update") {
    const tabs = await chrome.tabs.query({
      url: ["http://*/*", "https://*/*"],
    });
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined || !tab.url) return;
        const origin = new URL(tab.url).origin + "/*";
        if (await chrome.permissions.contains({ origins: [origin] }))
          await inject(tab.id).catch(() => {});
      }),
    );
  }
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (
    info.parentMenuItemId !== "selection" ||
    typeof info.menuItemId !== "string" ||
    tab?.id === undefined ||
    !info.selectionText?.trim()
  )
    return;
  try {
    await initialize();
    const { settings } = await readStore();
    const action = settings.actions.find(
      (action) => `selection:${action.id}` === info.menuItemId,
    );
    if (!action) return;
    await inject(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      type: "selection.process",
      actionId: action.id,
      text: info.selectionText,
    });
  } catch (error) {
    console.error("Aside could not open the selection panel:", error);
  }
});
trackRecentTabs();
chrome.commands.onCommand.addListener(async (command, sourceTab) => {
  if (command === "switch-recent-tab") {
    await switchRecentTab(sourceTab?.windowId);
    return;
  }
  if (command !== "quick-question") return;
  const tab =
    sourceTab ||
    (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.id === undefined || !/^https?:\/\//i.test(tab.url || "")) return;
  try {
    await initialize();
    const { settings } = await readStore();
    const actionId = settings.actions.find(
      (action) => action.kind === "qa",
    )?.id;
    if (!actionId) {
      await openSettings(tab.id, "actions");
      return;
    }
    await inject(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      type: "page.run",
      actionId,
      scope: "body",
      panel: true,
    });
  } catch (error) {
    // Chrome can also reject injection on protected HTTP(S) pages.
    console.info("Aside could not open Quick Q&A:", error);
  }
});
chrome.runtime.onMessage.addListener(
  (message: RequestMessage, sender, respond) => {
    (async () => {
      if (sender.id !== chrome.runtime.id) throw new ModelError("notAllowed");
      if (message.type === "website.update") {
        const fromPage = !trusted(sender);
        if (fromPage) {
          lightsWebsite(sender);
          // The floating control can change only its own top-level site's lights.
          if (
            sender.frameId !== 0 ||
            message.tabId !== undefined ||
            !message.patch ||
            Object.keys(message.patch).length !== 1 ||
            !["on", "off", "system"].includes(message.patch.lights as string)
          )
            throw new ModelError("notAllowed");
          // Keep this request in the click's message gesture, before store reads.
          if (
            message.patch.lights !== "off" &&
            !(await chrome.permissions.request({
              origins: ["http://*/*", "https://*/*"],
            }))
          )
            throw new ModelError("permissionRequired");
        }
        await initialize();
        if (!DECISION_MODELS_ENABLED && message.patch?.enhance === true)
          throw new ModelError("notAllowed");
        const tabId = fromPage ? sender.tab?.id : message.tabId;
        if (tabId === undefined) throw new ModelError("invalidInput");
        const hostname = websiteHostname(
          fromPage
            ? sender.tab!.url!
            : (await chrome.tabs.get(tabId)).url || "",
        );
        const website = await mutate((data) => {
          updateWebsite(data.settings.website, hostname, message.patch);
          return data.settings.website;
        });
        const lightsChanged =
          message.patch === null ||
          Object.hasOwn(message.patch, "lights") ||
          Object.hasOwn(message.patch, "enhance");
        await broadcastSettings(
          (await readStore()).settings,
          lightsChanged ? hostname : undefined,
          tabId,
        );
        return website;
      }
      await initialize();
      if (message.type === "lights.cancel") {
        lightsWebsite(sender);
        enhancementJobs
          .get(`${sender.tab!.id}:${sender.frameId || 0}`)
          ?.abort();
        return true;
      }
      if (message.type === "lights.cached")
        return cachedLights(message.candidates, sender);
      if (message.type === "lights.enhance")
        return withKeepAlive(() => enhanceLights(message.candidates, sender));
      if (message.type === "lights.proxy") {
        const top = lightsWebsite(sender);
        const website = (await readStore()).settings.website;
        if (resolveWebsite(website, websiteHostname(top)).lights === "off")
          return false;
        await chrome.scripting.executeScript({
          target: { tabId: sender.tab!.id!, frameIds: [sender.frameId || 0] },
          world: "MAIN",
          files: ["lights-proxy.js"],
        });
        return true;
      }
      if (message.type === "lights.fetch") {
        lightsWebsite(sender);
        const url = new URL(message.url);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password)
          throw new ModelError("notAllowed");
        const response = await fetch(url.href, {
          credentials: "omit",
          signal: AbortSignal.timeout(15000),
        });
        const type = response.headers.get("content-type") || "";
        // An upstream failure is not an extension permission denial. Keep its
        // HTTP/type context so the engine reports why this resource was skipped.
        if (!response.ok)
          throw new ModelError(
            "networkError",
            `Lights resource HTTP ${response.status}: ${url.origin}${url.pathname}`,
          );
        if (!/^(text\/css|image\/)/i.test(type))
          throw new ModelError(
            "invalidInput",
            `Lights resource unsupported Content-Type ${type || "(missing)"}: ${url.origin}${url.pathname}`,
          );
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.length > 4 * 1024 * 1024) throw new ModelError("invalidInput");
        if (type.startsWith("text/css"))
          return { body: new TextDecoder().decode(body), type, binary: false };
        let binary = "";
        for (let offset = 0; offset < body.length; offset += 8192)
          binary += String.fromCharCode(
            ...body.subarray(offset, offset + 8192),
          );
        return { body: btoa(binary), type, binary: true };
      }
      if (message.type === "settings.public") {
        const settings = (await readStore()).settings;
        return publicConfig(settings);
      }
      if (message.type === "settings.open") {
        await openSettings(
          sender.tab?.id || message.tabId || undefined,
          message.route === "connections" ? "connections" : "home",
        );
        return true;
      }
      if (message.type === "collection.add") return addCollection(message.item);
      if (message.type === "page.status" && sender.tab) {
        chrome.runtime
          .sendMessage({ ...message, tabId: sender.tab.id })
          .catch(() => {});
        return true;
      }
      if (message.type === "actions.save") {
        await mutate((data) => {
          // Content scripts can edit actions, but cannot replace settings or credentials.
          const settings = data.settings;
          for (const change of message.changes) {
            const index = settings.actions.findIndex((a) => a.id === change.id);
            if ((change.create && index >= 0) || (!change.create && index < 0))
              throw new ModelError("notAllowed");
            if (!change.name?.trim() || !change.instruction?.trim())
              throw new ModelError("invalidAction");
            if (
              change.model !== "default" &&
              !settings.connections.some(
                (c) =>
                  c.id === change.model &&
                  c.connected &&
                  connectionPurpose(c) === "generation",
              )
            )
              throw new ModelError("noConnection");
            const original: Action =
              index >= 0
                ? resolveAction(settings.actions[index], settings)!
                : {
                    id: change.id,
                    name: "",
                    instruction: "",
                    model: "default",
                    kind: "custom",
                    icon: "spark",
                    mode: "whole",
                    placement: "panel",
                    quick: false,
                  };
            const next = {
              ...original,
              name: index >= 0 ? original.name : change.name.trim(),
              instruction: change.instruction.trim(),
              model: change.model,
            };
            next.builtin = usesPresetDefaults(next, localeOf(settings));
            if (next.kind === "translate") {
              const languages = messages[localeOf(settings)].languages;
              if (
                !change.sourceLanguage ||
                !(change.sourceLanguage in languages) ||
                !change.targetLanguage ||
                change.targetLanguage === "auto" ||
                (change.targetLanguage !== "interface" &&
                  !(change.targetLanguage in languages))
              )
                throw new ModelError("invalidAction");
              next.sourceLanguage = change.sourceLanguage;
              next.targetLanguage = change.targetLanguage;
              if (hasSameLanguages(next, localeOf(settings)))
                throw new ModelError("sameLanguages");
            }
            if (hasOutputLanguage(next)) {
              validateOutputLanguage(change.outputLanguage);
              next.outputLanguage = change.outputLanguage || "interface";
            }
            if (next.kind === "qa") {
              validateOutputLength(change.outputLength);
              next.outputLength = change.outputLength || DEFAULT_OUTPUT_LENGTH;
            }
            if (next.instruction !== original.instruction)
              delete next.description;
            if (index < 0) settings.actions.push(next);
            else settings.actions[index] = next;
          }
          const limit = actionLimitError(settings.actions);
          if (limit) throw new ModelError(limit);
        });
        await syncSelectionMenu();
        return broadcastSettings((await readStore()).settings);
      }
      assertTrusted(sender);
      if (message.type === "snapshot") return snapshot();
      if (message.type === "cache.stats") return resultCache.stats();
      if (message.type === "cache.clear") {
        await resultCache.clear();
        return true;
      }
      if (message.type === "usage.list")
        return listUsage(message.filter, message.before);
      if (message.type === "usage.overview")
        return usageOverview(message.filter);
      if (message.type === "usage.details") return getUsageDetails(message.id);
      if (message.type === "usage.clear") {
        await clearUsage();
        return true;
      }
      if (message.type === "settings.save") {
        if (message.patch?.actions) {
          for (const action of message.patch.actions) {
            if (hasOutputLanguage(action))
              validateOutputLanguage(action.outputLanguage);
            if (action.kind === "qa") validateOutputLength(action.outputLength);
          }
          const limit = actionLimitError(message.patch.actions);
          if (limit) throw new ModelError(limit);
        }
        await mutate((data) => {
          const actions = message.patch.actions;
          if (
            actions &&
            data.settings.actions.some(
              (action) =>
                isPresetAction(action) &&
                !actions.some((next) => next.id === action.id),
            )
          )
            throw new ModelError("presetActionProtected");
          for (const [key, value] of Object.entries(message.patch || {})) {
            if (
              ![
                "actions",
                "appearance",
                "customColors",
                "preferences",
                "defaultConnection",
                "defaultDecisionConnection",
              ].includes(key)
            )
              throw new ModelError("notAllowed");
            if (
              (key === "defaultConnection" ||
                key === "defaultDecisionConnection") &&
              value !== null &&
              !data.settings.connections.some(
                (c) =>
                  c.id === value &&
                  c.connected &&
                  defaultConnectionKey(c) === key,
              )
            )
              throw new ModelError("invalidConnection");
            Object.assign(data.settings, { [key]: value });
          }
          return true;
        });
        if (message.patch.actions || message.patch.preferences)
          await syncSelectionMenu();
        await broadcastSettings((await readStore()).settings);
        return true;
      }
      if (message.type === "collection.remove")
        return mutate((data) => {
          data.collection = data.collection.filter((c) => c.id !== message.id);
          return true;
        });
      if (message.type === "daily.save")
        return mutate(async (data) => {
          validateOutputLanguage(message.daily.outputLanguage);
          if (!message.daily.prompt.trim())
            throw new ModelError("invalidInput");
          const model = message.daily.model || "default";
          if (model !== "default") await connectionFor(data.settings, model);
          data.daily = {
            model,
            prompt: message.daily.prompt,
            outputLanguage: message.daily.outputLanguage || "interface",
            useCollection: Boolean(message.daily.useCollection),
            result: message.daily.result || null,
            date: message.daily.date || null,
          };
          return data.daily;
        });
      if (message.type === "connection.save") {
        if (!connectionAvailable(message.connection))
          throw new ModelError("notAllowed");
        const saved = await mutate((data) => {
          const draft = message.connection;
          endpoint(draft);
          reasoningBody(draft);
          if (
            !Number.isSafeInteger(draft.maxTokens) ||
            draft.maxTokens <= 0 ||
            (draft.openaiCache &&
              !["auto", "explicit"].includes(draft.openaiCache))
          )
            throw new ModelError("invalidConnection");
          if (!draft.name?.trim() || !draft.model?.trim())
            throw new ModelError("invalidConnection");
          if (
            !Array.isArray(draft.models) ||
            !draft.models.some((model) => model.id === draft.model)
          )
            throw new ModelError("modelRequired");
          const next: Connection & { id: string } = {
            id: draft.id || crypto.randomUUID(),
            name: draft.name.trim(),
            url: draft.url.trim(),
            model: draft.model.trim(),
            models: draft.models.map(
              ({ id, name, reasoningEfforts, adaptiveThinking }) => ({
                id,
                name,
                ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
                ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
              }),
            ),
            protocol: draft.protocol,
            maxTokens: Number(draft.maxTokens),
            reasoningEffort: draft.reasoningEffort,
            openaiCache: draft.openaiCache,
            processing: processingPolicy(draft.processing),
            connected: true,
          };
          const index = data.settings.connections.findIndex(
              (c) => c.id === next.id,
            ),
            previousUrl =
              index >= 0 ? data.settings.connections[index].url : next.url;
          if (index < 0) data.settings.connections.push(next);
          else data.settings.connections[index] = next;
          if (typeof message.key === "string")
            data.credentials[next.id] = message.key.trim();
          else if (
            index >= 0 &&
            new URL(draft.url).origin !== new URL(previousUrl).origin
          )
            data.credentials[next.id] = "";
          const defaultKey = defaultConnectionKey(next);
          for (const other of [
            "defaultConnection",
            "defaultDecisionConnection",
          ] as const) {
            if (other !== defaultKey && data.settings[other] === next.id)
              data.settings[other] =
                data.settings.connections.find(
                  (c) => defaultConnectionKey(c) === other,
                )?.id || null;
          }
          if (defaultKey === "defaultDecisionConnection")
            for (const action of data.settings.actions)
              if (action.model === next.id) action.model = "default";
          if (!data.settings[defaultKey]) data.settings[defaultKey] = next.id;
          return next;
        });
        await broadcastSettings((await readStore()).settings);
        return saved;
      }
      if (message.type === "connection.remove") {
        await mutate((data) => {
          data.settings.connections = data.settings.connections.filter(
            (c) => c.id !== message.id,
          );
          delete data.credentials[message.id];
          for (const key of [
            "defaultConnection",
            "defaultDecisionConnection",
          ] as const)
            if (data.settings[key] === message.id)
              data.settings[key] =
                data.settings.connections.find(
                  (c) => defaultConnectionKey(c) === key,
                )?.id || null;
          for (const a of data.settings.actions)
            if (a.model === message.id) a.model = "default";
          return true;
        });
        await broadcastSettings((await readStore()).settings);
        return true;
      }
      if (message.type === "connection.test") {
        const connection = message.connection;
        if (!connectionAvailable(connection))
          throw new ModelError("notAllowed");
        const origin = new URL(modelsEndpoint(connection)).origin + "/*";
        if (!(await chrome.permissions.contains({ origins: [origin] })))
          throw new ModelError("permissionRequired");
        const data = await readStore();
        const stored = data.settings.connections.find(
          (c) => c.id === connection.id,
        );
        const key =
          message.key === undefined &&
          stored &&
          new URL(stored.url).origin === new URL(connection.url).origin
            ? data.credentials[connection.id!]
            : message.key;
        return withKeepAlive(() => listModels(connection, (key || "").trim()));
      }
      if (message.type === "tab.enable") {
        await inject(message.tabId);
        return chrome.tabs.sendMessage(message.tabId, { type: "ui.show" });
      }
      if (message.type === "tab.run") {
        const settings = (await readStore()).settings;
        const action = settings.actions.find((a) => a.id === message.actionId);
        if (
          hasSameLanguages(
            {
              ...action,
              ...(action?.kind === "translate" ? message.translation : {}),
            },
            localeOf(settings),
          )
        )
          throw new ModelError("sameLanguages");
        await inject(message.tabId);
        return chrome.tabs.sendMessage(message.tabId, {
          type: "page.run",
          actionId: message.actionId,
          scope: message.scope,
          panel: message.panel,
          translation: message.translation,
        });
      }
      if (message.type === "tab.restore")
        return chrome.tabs.sendMessage(message.tabId, { type: "page.restore" });
      throw new ModelError("notAllowed");
    })().then(
      (value) => respond({ ok: true, value }),
      (error) => respond(failure(error)),
    );
    return true;
  },
);
async function withKeepAlive<T>(fn: () => Promise<T>) {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
async function trackedModel(
  context: { source: UsageSource; actionName?: string },
  ...args: Parameters<ModelCall>
) {
  const [connection, key, instructions, input, signal, onDelta] = args;
  const details: UsageDetails = { instructions, input, output: "" };
  return trackedCall(connection, context, details, (onUsage) =>
    callModel(
      connection,
      key,
      instructions,
      input,
      signal,
      (text) => {
        details.output += text;
        onDelta?.(text);
      },
      onUsage,
    ),
  );
}
async function trackedCall<T>(
  connection: Parameters<ModelCall>[0],
  context: { source: UsageSource; actionName?: string },
  details: UsageDetails,
  run: (onUsage: (usage: UsageUpdate) => void) => Promise<T>,
): Promise<T> {
  const origin = new URL(endpoint(connection)).origin + "/*";
  if (!(await chrome.permissions.contains({ origins: [origin] })))
    throw new ModelError("permissionRequired");
  const startedAt = Date.now();
  let tokens: Tokens | null = null,
    usageFinal = false,
    status: UsageRecord["status"] = "success",
    errorCode: string | null = null;
  try {
    return await run((usage) => {
      tokens = usage.tokens;
      usageFinal = usage.final;
    });
  } catch (caught) {
    const error = modelError(caught);
    status = error.code === "cancelled" ? "cancelled" : "error";
    errorCode = error.code || "serviceError";
    throw error;
  } finally {
    try {
      await addUsage(
        {
          id: crypto.randomUUID(),
          startedAt,
          durationMs: Date.now() - startedAt,
          connectionId: connection.id || null,
          connectionName: connection.name || "",
          model: connection.model,
          protocol: connection.protocol,
          source: context.source,
          actionName: context.actionName || "",
          status,
          errorCode,
          tokens,
          usageFinal,
        },
        details,
      );
    } catch (error) {
      console.warn("Aside could not save call history:", error);
    }
  }
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "process" || port.sender?.id !== chrome.runtime.id) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  let started = false;
  port.onMessage.addListener(async (payload: ProcessPayload) => {
    if (started) return;
    started = true;
    try {
      const result = await withKeepAlive(async () => {
        await initialize();
        const data = await readStore(),
          settings = data.settings;
        let action =
          trusted(port.sender) && payload.action
            ? payload.action
            : resolveAction(
                settings.actions.find((a) => a.id === payload.actionId),
                settings,
              );
        let blocks = payload.blocks;
        if (payload.daily) {
          if (!trusted(port.sender)) throw new ModelError("notAllowed");
          const config = payload.daily,
            entries = config.useCollection ? data.collection.slice(0, 5) : [];
          if (!config.prompt.trim()) throw new ModelError("invalidInput");
          action = {
            kind: "custom",
            mode: "whole",
            model: config.model || "default",
            instruction: [
              config.prompt,
              "Display context: You are writing the finished text of a compact daily card on a reading homepage. The card is read on its own, with no source excerpts alongside it and no reply field. Write a reflection on reading and thinking. Use any saved passages as thematic inspiration. Keep the text self-contained, natural and brief: one or two short sentences. Do not invent an attribution.",
              "Output format: Return plain text only. Do not use Markdown formatting.",
            ].join("\n\n"),
            outputLanguage: config.outputLanguage || "interface",
          };
          blocks = [
            {
              id: "daily",
              text: JSON.stringify({
                date: new Date().toLocaleDateString("en-CA"),
                collection: entries.map((c) => ({
                  title: c.title,
                  text: c.text.slice(0, 2000),
                })),
              }),
            },
          ];
        }
        if (!action?.instruction?.trim() || !blocks)
          throw new ModelError("invalidInput");
        if (action.kind === "translate" && payload.translation)
          action = {
            ...action,
            sourceLanguage: payload.translation.sourceLanguage,
            targetLanguage: payload.translation.targetLanguage,
          };
        if (action.kind === "translate")
          action = {
            ...action,
            targetLanguage: resolveOutputLanguage(
              action.targetLanguage,
              localeOf(settings),
            ),
          };
        if (hasOutputLanguage(action) || payload.daily) {
          validateOutputLanguage(action.outputLanguage);
          action = {
            ...action,
            outputLanguage: resolveOutputLanguage(
              action.outputLanguage,
              localeOf(settings),
            ),
          };
        }
        if (hasSameLanguages(action)) throw new ModelError("sameLanguages");
        const connection = await connectionFor(settings, action.model),
          key = data.credentials[connection.id!] || "";
        const source: UsageSource = payload.daily
          ? "daily"
          : ["page", "selection", "trial"].includes(payload.source || "")
            ? payload.source!
            : "processing";
        const output = await processContent({
          action,
          blocks,
          connection,
          key,
          signal: controller.signal,
          refresh: Boolean(payload.refresh || payload.daily),
          invoke: (...args) =>
            trackedModel({ source, actionName: action.name }, ...args),
          onProgress: (parts, stats) => {
            if (!controller.signal.aborted)
              port.postMessage({ type: "progress", parts, stats });
          },
          onDelta: payload.stream
            ? (id, text) => {
                if (!controller.signal.aborted)
                  port.postMessage({ type: "delta", id, text });
              }
            : undefined,
        });
        if (payload.daily && payload.saveDaily)
          await mutate((data) => {
            data.daily = {
              ...payload.daily!,
              result: output.parts[0].text,
              date: new Date().toLocaleDateString("en-CA"),
            };
            return true;
          });
        return output;
      });
      if (!controller.signal.aborted)
        port.postMessage({ type: "done", result });
    } catch (caught) {
      const error = modelError(caught);
      if (!controller.signal.aborted)
        port.postMessage({
          type: "error",
          error: error.code || "serviceError",
          detail:
            error.code && error.message !== error.code ? error.message : "",
        });
    }
  });
});
const enhancementJobs = new Map<string, AbortController>();
const enhancementScheduler = new RequestScheduler();
async function lightsDecisionContext(
  candidates: LightCandidate[],
  sender: chrome.runtime.MessageSender,
) {
  const top = lightsWebsite(sender);
  validateCandidates(candidates);
  const { settings, credentials } = await readStore();
  const features = resolveWebsite(settings.website, websiteHostname(top));
  if (!features.enhance || features.lights === "off")
    throw new ModelError("notAllowed");
  const connection = settings.connections.find(
    (c) =>
      c.id === settings.defaultDecisionConnection &&
      c.connected &&
      connectionPurpose(c) === "decision",
  );
  if (!connection?.id) throw new ModelError("noDecisionConnection");
  return { connection, credentials };
}
async function cachedLights(
  candidates: LightCandidate[],
  sender: chrome.runtime.MessageSender,
): Promise<LightDecision[]> {
  const { connection } = await lightsDecisionContext(candidates, sender);
  const keys = await Promise.all(
    candidates.map((c) => lightsCacheKey(connection, c)),
  );
  const cached = await resultCache.getMany(keys);
  // This read-only path never starts/cancels jobs or fills a miss with inference.
  return candidates.flatMap((candidate, index) => {
    const effect = cached.get(keys[index]);
    return effect === undefined
      ? []
      : [{ id: candidate.id, effect: effect as LightDecision["effect"] }];
  });
}
async function enhanceLights(
  candidates: LightCandidate[],
  sender: chrome.runtime.MessageSender,
): Promise<LightDecision[]> {
  const { connection, credentials } = await lightsDecisionContext(
    candidates,
    sender,
  );
  const jobKey = `${sender.tab!.id}:${sender.frameId || 0}`;
  enhancementJobs.get(jobKey)?.abort();
  const controller = new AbortController();
  enhancementJobs.set(jobKey, controller);
  const generation = resultCache.generation;
  try {
    const keys = await Promise.all(
      candidates.map((c) => lightsCacheKey(connection, c)),
    );
    const cached = await resultCache.getMany(keys);
    const missing = candidates.filter((_, i) => !cached.has(keys[i]));
    let answers: Awaited<ReturnType<typeof callDecision>> = {};
    if (missing.length)
      await enhancementScheduler.schedule(
        JSON.stringify([connection.id, endpoint(connection)]),
        processingPolicy(connection.processing).concurrency,
        0,
        controller.signal,
        async () => {
          const input = lightsDecisionInput(missing);
          const details: UsageDetails = {
            instructions: "",
            input: JSON.stringify(input, null, 2),
            output: "",
          };
          answers = await trackedCall(
            connection,
            { source: "lightsEnhance" },
            details,
            (usage) =>
              callDecision(
                connection,
                credentials[connection.id!] || "",
                input,
                controller.signal,
                usage,
                (text) => {
                  details.output = text;
                },
              ),
          );
        },
      );
    if (controller.signal.aborted) throw new ModelError("cancelled");
    let index = 0;
    const additions: { key: string; text: string }[] = [];
    const decisions = candidates.map((candidate, i) => {
      const saved = cached.get(keys[i]);
      const effect =
        saved === undefined
          ? lightsEffect(candidate, answers[`element_${index++}`])
          : (saved as LightDecision["effect"]);
      if (saved === undefined) additions.push({ key: keys[i], text: effect });
      return { id: candidate.id, effect };
    });
    await resultCache.touch([...cached.keys()]);
    await resultCache.putMany(additions, generation);
    return decisions;
  } finally {
    if (enhancementJobs.get(jobKey) === controller)
      enhancementJobs.delete(jobKey);
  }
}
