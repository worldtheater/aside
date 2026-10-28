import { C } from "./copy.js";
import { escapeHtml as e } from "./html.js";
import { button, heading, icon } from "./ui.js";
import { SYNC_MIN_PASSPHRASE } from "./sync-data.js";
import type { SyncStatus } from "./config-sync.js";
import type { Connection } from "./types.js";
import { modelsEndpoint } from "./providers.js";

export interface SyncServiceAccess {
  origin: string;
  connections: string[];
  granted: boolean;
}
export async function readSyncServiceAccess(
  connections: Connection[],
): Promise<SyncServiceAccess[]> {
  const services = new Map<string, string[]>();
  for (const connection of connections.filter((item) => item.connected)) {
    const origin = new URL(modelsEndpoint(connection)).origin;
    const names = services.get(origin) ?? [];
    names.push(connection.name);
    services.set(origin, names);
  }
  return Promise.all(
    [...services].map(async ([origin, names]) => ({
      origin,
      connections: names,
      granted: await chrome.permissions.contains({ origins: [origin + "/*"] }),
    })),
  );
}
export function renderSyncServiceAccess(services: SyncServiceAccess[]): string {
  if (!services.length) return "";
  const copy = C.sync;
  const pending = services.filter((service) => !service.granted);
  return `<section class="sync-service-access${pending.length ? " has-pending-access" : ""}" aria-label="${e(copy.accessTitle)}">${
    pending.length
      ? `<h2 class="sync-state">${e(copy.accessTitle)}</h2><p class="sync-guidance">${e(copy.accessHelp)}</p>
      <ul class="sync-service-list">${pending.map((service) => `<li><strong>${e(service.origin)}</strong><span>${service.connections.map(e).join(" · ")}</span></li>`).join("")}</ul>
      <div class="sync-actions">${button(copy.allowAccess, "sync-authorize", "primary")}</div>`
      : `<p class="sync-access-ready">${icon("check")}${e(copy.accessReady)}</p>`
  }</section>`;
}

export function syncErrorText(code: string): string {
  return (
    C.sync.errors[code as keyof typeof C.sync.errors] ||
    C.sync.errors.unavailable
  ).replace("{min}", String(SYNC_MIN_PASSPHRASE));
}
export function renderSyncPage(
  status: SyncStatus | null,
  firstSetup = false,
  services: SyncServiceAccess[] = [],
): string {
  const copy = C.sync;
  const creating = !!status && !status.remote && !status.enabled && firstSetup;
  const waiting = !!status && !status.remote && !creating;
  const needsPassphrase =
    status &&
    status.error !== "version" &&
    (creating ||
      (status.remote && (!status.enabled || status.mode === "locked")));
  const title = needsPassphrase
    ? creating
      ? copy.firstSetup
      : status.enabled
        ? copy.unlock
        : copy.join
    : waiting
      ? copy.joinExisting
      : status?.mode === "ready"
        ? copy.ready
        : "";
  const guidance = needsPassphrase
    ? creating
      ? copy.createHelp
      : status.enabled
        ? copy.locked
        : copy.joinHelp
    : waiting && !status?.error
      ? copy.waitingHelp
      : "";
  const passphrase = needsPassphrase
    ? `<form id="sync-form" novalidate>
    <div class="field"><div class="sync-passphrase-heading"><label class="field-label" for="sync-passphrase">${e(copy.passphrase)}</label>${!creating ? button(copy.forgotPassphrase, "sync-reset-ask", "ghost sync-forgot") : ""}</div><input id="sync-passphrase" type="password" autocomplete="${creating ? "new-password" : "current-password"}" required ${creating ? `minlength="${SYNC_MIN_PASSPHRASE}"` : ""} aria-describedby="sync-guidance${creating ? " sync-passphrase-minimum sync-passphrase-help" : ""}">${creating ? `<span class="field-note" id="sync-passphrase-minimum">${e(copy.errors.passphraseShort.replace("{min}", String(SYNC_MIN_PASSPHRASE)))}</span>` : ""}</div>
    ${creating ? `<label class="field"><span class="field-label">${e(copy.confirmPassphrase)}</span><input id="sync-confirm" type="password" autocomplete="new-password" required minlength="${SYNC_MIN_PASSPHRASE}"></label><p class="field-note" id="sync-passphrase-help">${e(copy.passphraseHelp)}</p>` : ""}
    <div class="sync-actions"><button type="submit" class="btn primary" data-op="sync-connect" data-action="${creating ? "create" : status.enabled ? "unlock" : "join"}">${e(creating ? copy.create : status.enabled ? copy.unlock : copy.join)}</button>${creating ? button(copy.joinExisting, "sync-join-existing", "ghost") : ""}</div>
  </form>`
    : "";
  const error =
    status?.error && status.mode !== "locked"
      ? `<p class="sync-error" role="status">${e(syncErrorText(status.error))}</p>`
      : "";
  const canSync = status?.enabled && !needsPassphrase && !waiting;
  return `${heading(copy.title, copy.intro)}<div class="sync-page">
    <div class="sync-overview">
      <section class="sync-controls" aria-label="${e(copy.title)}">
        <div class="sync-status-row">
          <div class="sync-status-copy">
            ${title ? `<h2 class="sync-state">${status?.mode === "ready" ? icon("check") : needsPassphrase ? icon("lock") : ""}${e(title)}</h2>` : ""}
            ${canSync && status.lastSyncedAt ? `<p class="sync-timestamp"><span>${e(copy.lastSync)}</span><time datetime="${new Date(status.lastSyncedAt).toISOString()}">${e(new Date(status.lastSyncedAt).toLocaleString(document.documentElement.lang))}</time></p>` : ""}
          </div>
          ${canSync ? button(copy.syncNow, "sync-now", "", "refresh") : ""}
        </div>
        ${guidance ? `<p class="sync-guidance" id="sync-guidance">${e(guidance)}</p>` : ""}
        ${!status ? `<p role="status">${e(copy.working)}</p>` : ""}
        ${error}${passphrase}
        ${waiting ? `<div class="sync-actions">${button(copy.checkAgain, "sync-check", "", "refresh")}${!status.enabled ? button(copy.firstSetup, "sync-first-setup", "ghost") : ""}</div>` : ""}
      </section>
      <div id="sync-service-access">${status?.enabled ? renderSyncServiceAccess(services) : ""}</div>
    </div>
    ${renderSyncDetails(status)}
  </div>`;
}

function renderSyncDetails(status: SyncStatus | null): string {
  const copy = C.sync;
  return `<details class="advanced sync-details"><summary>${e(copy.details)}</summary>
    <div class="advanced-body">
      <div class="sync-guide-grid sync-scope">
        <section><h3>${icon("refresh")}${e(copy.scopeTitle)}</h3><ul>${copy.scope.map((item) => `<li>${e(item)}</li>`).join("")}</ul></section>
        <section><h3>${icon("system")}${e(copy.localOnlyTitle)}</h3><ul>${copy.localOnly.map((item) => `<li>${e(item)}</li>`).join("")}</ul></section>
      </div>
      <div class="sync-guide-grid sync-rules">
        <section><h3>${e(copy.devicesTitle)}</h3><ol class="sync-join-steps">${copy.joinSteps.map((step) => `<li>${e(step)}</li>`).join("")}</ol><p class="field-note">${e(copy.requirements)}</p></section>
        <section><h3>${e(copy.mergeTitle)}</h3><dl class="sync-merge-rules">${copy.mergeRules.map((rule) => `<div><dt>${e(rule.title)}</dt><dd>${e(rule.description)}</dd></div>`).join("")}</dl></section>
      </div>
      ${status && (status.enabled || status.remote) ? `<section class="sync-guide-grid sync-management" aria-label="${e(copy.manageTitle)}">${status.enabled ? `<div class="sync-management-item">${button(copy.stop, "sync-stop-ask", "ghost", "pause", 'aria-describedby="sync-stop-help"')}<p id="sync-stop-help">${e(copy.stopHelp)}</p></div>` : ""}<div class="sync-management-item">${button(copy.clear, "sync-clear-ask", "ghost sync-delete", "trash", 'aria-describedby="sync-clear-help"')}<p id="sync-clear-help">${e(copy.clearHelp)}</p></div></section>` : ""}
    </div>
  </details>`;
}
