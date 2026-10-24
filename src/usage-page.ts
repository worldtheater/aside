import { C, locale } from "./copy.js";
import { escapeHtml as e } from "./html.js";
import { icon, button, iconButton, heading, selected } from "./ui.js";
import { enhanceSelects } from "./controls.js";
import { usageState } from "./usage.js";
import type {
  UsageRecord,
  UsageDetails,
  UsageOverview,
  UsageDay,
  CacheInfo,
} from "./types.js";

export interface UsageView {
  records: UsageRecord[];
  error: string;
  period: string;
  model: string;
  overview: UsageOverview;
  loading: boolean;
}

export function updateUsagePage(
  root: HTMLElement,
  view: UsageView,
  cacheInfo: CacheInfo | null,
  preservePosition: boolean,
) {
  const visible = preservePosition
    ? [...root.querySelectorAll<HTMLElement>("[data-usage-id]")].find((row) => {
        const bounds = row.getBoundingClientRect();
        return bounds.bottom > 0 && bounds.top < innerHeight;
      })
    : undefined;
  const anchor = visible
    ? { id: visible.dataset.usageId!, top: visible.getBoundingClientRect().top }
    : undefined;
  root.innerHTML = renderUsage(view, cacheInfo);
  root.removeAttribute("aria-busy");
  enhanceSelects(root);
  mountUsageChart(root);
  if (anchor) {
    const row = root.querySelector<HTMLElement>(
      `[data-usage-id="${CSS.escape(anchor.id)}"]`,
    );
    if (row) window.scrollBy(0, row.getBoundingClientRect().top - anchor.top);
  }
}

export function renderUsage(usageView: UsageView, cacheInfo: CacheInfo | null) {
  const U = C.usage,
    models = usageView.overview.models,
    records = usageView.records,
    summary = usageView.overview.summary,
    number = (value: number | null | undefined) =>
      value === null || value === undefined
        ? "—"
        : new Intl.NumberFormat(locale).format(value);
  const fields = [
    "inputTokens",
    "outputTokens",
    "cachedTokens",
    "cacheWriteTokens",
    "reasoningTokens",
    "totalTokens",
  ] as const;
  const time = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${heading(U.title, U.intro, button(U.clear, "usage-clear-ask", "ghost danger", "", usageView.overview.totalRecords ? "" : "disabled"))}
    <div class="usage-filters"><div class="toolbar-field"><label for="usage-period">${U.period}</label><select id="usage-period">${Object.entries(
      U.periods,
    )
      .map(
        ([value, label]) =>
          `<option value="${value}"${selected(usageView.period, value)}>${label}</option>`,
      )
      .join(
        "",
      )}</select></div><div class="toolbar-field"><label for="usage-model">${U.model}</label><select id="usage-model"><option value="all">${U.allModels}</option>${models.map(({ value, model, connectionName }) => `<option value="${e(value)}" data-title="${e(model)}" data-description="${e(connectionName)}"${selected(usageView.model, value)}>${e(model)} · ${e(connectionName)}</option>`).join("")}</select></div></div>
    <div class="usage-summary">${fields.map((field) => `<section class="usage-metric"><span>${U[field]}</span><strong data-usage-total="${field}">${number(summary[field])}</strong><small>${field === "cachedTokens" || field === "cacheWriteTokens" ? U.withinInput : U.tokens}</small></section>`).join("")}</div>
    ${renderUsageChart(usageView.overview.days)}
    <div class="usage-record-heading"><h2>${U.records}</h2><span class="small muted" id="usage-coverage">${U.coverage(summary)}</span></div>
    ${usageView.error ? `<p class="usage-note" role="alert">${e(usageView.error)}</p>${button(C.real.retry, "usage-reload")}` : ""}
    ${
      records.length
        ? `<div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>${U.time}</th><th>${U.source}</th><th>${U.model}</th><th>${U.status}</th>${fields.map((field) => `<th class="numeric">${U[field]}</th>`).join("")}</tr></thead><tbody>${records
            .map(
              (record) =>
                `<tr data-usage-id="${record.id}"><td class="usage-time">${time.format(new Date(record.startedAt))}</td><td>${U.sources[record.source] || U.sources.processing}<small>${e(record.actionName)}</small></td><td class="usage-model-cell"><strong>${e(record.model)}</strong><small>${e(record.connectionName)}</small></td><td><span class="badge ${record.status === "success" ? "neutral" : "usage-warning"}" ${record.errorCode ? `data-tooltip="${e(C.real.errors[record.errorCode as keyof typeof C.real.errors] || record.errorCode)}"` : ""}>${U.statuses[record.status]}</span><small>${U.reporting[usageState(record)]}</small></td>${fields.map((field) => `<td class="numeric${field === "totalTokens" ? " usage-total" : ""}" data-token="${field}" ${record.tokens?.[field] === null || record.tokens?.[field] === undefined ? `aria-label="${e(U.unreported)}"` : ""}>${number(record.tokens?.[field])}${field === "totalTokens" ? iconButton(U.details, "usage-details", "info", `data-id="${e(record.id)}"`) : ""}</td>`).join("")}</tr>`,
            )
            .join(
              "",
            )}</tbody></table></div>${summary.calls > records.length ? `<div class="usage-more">${button(U.more, "usage-more", "", "", usageView.loading ? "disabled" : "")}</div>` : ""}`
        : `<div class="collection-empty">${icon("list")}<h3>${U.empty}</h3></div>`
    }
    <section class="local-cache"><div class="row spread"><h2>${U.localCache}</h2><div class="row">${button(U.cacheReload, "cache-reload", "ghost")}${button(U.cacheClear, "cache-clear-ask", "ghost danger")}</div></div><p id="cache-info">${cacheInfo ? U.cacheInfo(cacheInfo.entries, (cacheInfo.bytes / 1048576).toFixed(2), cacheInfo.maxBytes / 1048576) : "—"}</p><p class="small muted">${U.cacheNote}</p></section>`;
}
function renderUsageChart(days: UsageDay[]) {
  const U = C.usage;
  const header = `<div class="usage-chart-heading"><h2 id="usage-chart-title">${U.dailyUsage}</h2><span>${U.tokens}</span></div>`;
  if (!days.length)
    return `<section class="usage-chart" aria-labelledby="usage-chart-title">${header}<p class="usage-chart-empty">${U.chartEmpty}</p></section>`;
  const number = new Intl.NumberFormat(locale);
  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const tick = new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
  });
  const highest = days.reduce(
    (max, day) => Math.max(max, day.totalTokens ?? 0),
    2,
  );
  const step = 10 ** Math.floor(Math.log10(highest));
  const scale =
    highest < 10
      ? Math.ceil(highest / 2) * 2
      : Math.ceil(highest / step) * step;
  const labelStep = Math.min(7, Math.max(1, Math.ceil(days.length / 8)));
  const detail = (day: (typeof days)[number]) =>
    `${U.chartDay(date.format(day.date), day.totalTokens === null ? U.chartMissing : U.chartValue(number.format(day.totalTokens)), number.format(day.calls))}${day.incomplete && day.totalTokens !== null ? " · " + U.chartPartial : ""}`;
  return `<section class="usage-chart" id="usage-chart" aria-labelledby="usage-chart-title">${header}
    <div class="usage-chart-tip" id="usage-chart-tip" role="tooltip" aria-hidden="true"></div>
    <div class="usage-chart-body"><div class="usage-chart-axis" aria-hidden="true"><span>${compact.format(scale)}</span><span>${compact.format(scale / 2)}</span><span>0</span></div>
    <div class="usage-chart-scroll"><div class="usage-chart-plot" style="--days:${days.length}"><div class="usage-chart-grid" aria-hidden="true"></div>${days.map((day, index) => `<button type="button" class="usage-chart-day" data-usage-day="${day.date}" data-usage-detail="${e(detail(day))}" aria-label="${e(detail(day))}"><span class="usage-chart-column" aria-hidden="true">${day.totalTokens === null ? '<span class="usage-chart-missing">—</span>' : `<span class="usage-chart-bar${day.totalTokens === 0 ? " usage-chart-zero" : ""}" style="height:${(day.totalTokens / scale) * 100}%"></span>`}</span><span class="usage-chart-date" aria-hidden="true">${index === days.length - 1 || (index % labelStep === 0 && days.length - 1 - index >= labelStep) ? tick.format(day.date) : ""}</span></button>`).join("")}</div></div></div></section>`;
}
export function mountUsageChart(root: ParentNode = document) {
  const chart = root.querySelector<HTMLElement>("#usage-chart");
  const tip = chart?.querySelector<HTMLElement>("#usage-chart-tip");
  if (!chart || !tip) return;
  const scroll = chart.querySelector<HTMLElement>(".usage-chart-scroll")!;
  scroll.scrollLeft = scroll.scrollWidth;
  let activeDay: HTMLElement | null = null;
  const hide = () => {
    activeDay = null;
    tip.classList.remove("visible");
    tip.setAttribute("aria-hidden", "true");
  };
  const position = () => {
    if (!activeDay) return;
    const bar = activeDay.querySelector<HTMLElement>(
      ".usage-chart-column > span",
    )!;
    const anchor = bar.getBoundingClientRect();
    const viewport = scroll.getBoundingClientRect();
    if (anchor.right <= viewport.left || anchor.left >= viewport.right) {
      hide();
      return;
    }
    // Keep the tip outside the scrolling plot so tall and edge bars cannot clip it.
    const bounds = chart.getBoundingClientRect();
    const left = anchor.left + (anchor.width - tip.offsetWidth) / 2;
    tip.style.setProperty("--tip-width", `${tip.offsetWidth}px`);
    tip.style.setProperty(
      "--tip-left",
      `${left - bounds.left - chart.clientLeft}px`,
    );
    const above = anchor.top - tip.offsetHeight - 8;
    const top = above >= 8 ? above : anchor.top + 8;
    tip.style.top = `${top - bounds.top - chart.clientTop}px`;
  };
  const inspect = (event: Event) => {
    const day = (event.target as Element).closest<HTMLElement>(
      "[data-usage-detail]",
    );
    if (!day) return;
    activeDay = day;
    tip.textContent = day.dataset.usageDetail!;
    tip.classList.add("visible");
    tip.setAttribute("aria-hidden", "false");
    position();
  };
  chart.addEventListener("pointerover", inspect);
  chart.addEventListener("focusin", inspect);
  chart.addEventListener("pointerout", (event) => {
    if (!activeDay?.contains(event.relatedTarget as Node | null)) hide();
  });
  chart.addEventListener("focusout", hide);
  chart.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  scroll.addEventListener("scroll", position);
}

export function renderUsageDetails(
  record: UsageRecord,
  details: UsageDetails | null,
) {
  const U = C.usage;
  const text = (value: string) => {
    // Indent structured batch payloads without changing plain source text.
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object")
        value = JSON.stringify(parsed, null, 2);
    } catch {
      /* Plain text is displayed as received. */
    }
    return `<pre class="usage-detail-text">${e(value)}</pre>`;
  };
  const error = record.errorCode
    ? C.real.errors[record.errorCode as keyof typeof C.real.errors] ||
      record.errorCode
    : "";
  return `<h2 id="usage-detail-title">${U.detailTitle}</h2>
    <div class="usage-detail-meta">${e(record.model)} · ${e(new Date(record.startedAt).toLocaleString(locale))} · ${U.statuses[record.status]}</div>
    <div class="usage-detail-body">${
      details
        ? `
      <section class="usage-detail-pane"><h3>${U.inputTokens}</h3><div class="usage-detail-content">
        ${details.instructions ? `<h4>${U.content}</h4>` : ""}${text(details.input)}${details.instructions ? `<h4>${U.instructions}</h4>${text(details.instructions)}` : ""}
      </div></section>
      <section class="usage-detail-pane"><h3>${U.outputTokens}</h3><div class="usage-detail-content">
        ${error ? `<div class="usage-detail-error" role="status">${e(error)}</div>` : ""}
        ${details.output ? text(details.output) : `<div class="usage-detail-empty">${U.noOutput}</div>`}
      </div></section>`
        : `<div class="usage-detail-empty">${U.detailsUnavailable}</div>`
    }
    </div>`;
}
