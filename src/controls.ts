import { escapeHtml as escape } from "./html.js";
import { C } from "./copy.js";

let popup: HTMLDivElement | null = null,
  anchor: HTMLElement | null = null,
  select: HTMLSelectElement | null = null,
  activeIndex = 0,
  menuOptions: HTMLOptionElement[] = [],
  sequence = 0;

export function closeMenu(restoreFocus = false) {
  const previous = anchor;
  if (anchor) anchor.setAttribute("aria-expanded", "false");
  popup?.remove();
  popup = null;
  anchor = null;
  select = null;
  if (restoreFocus) previous?.focus();
}
function positionMenu() {
  if (!popup || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const preferredWidth =
    parseFloat(getComputedStyle(popup).getPropertyValue("--popover-width")) ||
    210;
  const width = Math.min(Math.max(rect.width, preferredWidth), innerWidth - 24);
  popup.style.width = `${width}px`;
  const below = innerHeight - rect.bottom - 18,
    above = rect.top - 18;
  popup.style.maxHeight = `${Math.min(350, innerHeight - 24)}px`;
  const upward = below < popup.getBoundingClientRect().height && above > below;
  popup.style.maxHeight = `${Math.max(0, Math.min(350, upward ? above : below))}px`;
  const height = popup.getBoundingClientRect().height;
  popup.style.left = `${Math.min(Math.max(12, rect.left), innerWidth - width - 12)}px`;
  popup.style.top = `${upward ? Math.max(12, rect.top - height - 6) : rect.bottom + 6}px`;
}
export function showMenu(
  trigger: HTMLElement,
  html: string,
  label: string,
  className = "",
) {
  closeMenu();
  anchor = trigger;
  anchor.setAttribute("aria-expanded", "true");
  popup = document.createElement("div");
  popup.className = `popover-surface ${className}`.trim();
  popup.setAttribute("aria-label", label);
  popup.innerHTML = html;
  (trigger.closest("dialog") || document.body).append(popup);
  popup.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-op]")) closeMenu();
  });
  positionMenu();
  return popup;
}
function highlight(index: number) {
  if (!popup || !anchor || !menuOptions.length) return;
  activeIndex = (index + menuOptions.length) % menuOptions.length;
  const items = popup.querySelectorAll<HTMLElement>("[role=option]");
  items.forEach((node, i: number) =>
    node.classList.toggle("highlighted", i === activeIndex),
  );
  items[activeIndex]?.scrollIntoView({ block: "nearest" });
  anchor.setAttribute("aria-activedescendant", items[activeIndex]?.id || "");
}
function renderOptions(query = "") {
  if (!select || !popup) return;
  const selectedValue = select.value;
  menuOptions = [...select.options].filter(
    (option) =>
      !option.disabled &&
      (option.textContent || "").toLowerCase().includes(query.toLowerCase()),
  );
  popup.querySelector<HTMLElement>(".option-list")!.innerHTML =
    menuOptions.length
      ? menuOptions
          .map(
            (option, i) =>
              `<button type="button" role="option" id="option-${sequence}-${i}" aria-selected="${option.value === selectedValue}" data-option="${i}" data-value="${escape(option.value)}" tabindex="-1"><span class="option-copy"><span class="option-title">${escape(option.dataset.title || option.textContent)}</span>${option.dataset.description ? `<small class="option-description">${escape(option.dataset.description)}</small>` : ""}</span><span class="option-check" aria-hidden="true">${option.value === selectedValue ? "✓" : ""}</span></button>`,
          )
          .join("")
      : `<div class="no-options">${C.noOptions}</div>`;
  activeIndex = Math.max(
    0,
    menuOptions.findIndex((o) => o.value === selectedValue),
  );
  highlight(activeIndex);
  positionMenu();
}
function choose(index: number) {
  const option = menuOptions[index];
  if (!option) return;
  const source = select;
  if (!source) return;
  source.value = option.value;
  closeMenu(true);
  source.dispatchEvent(new Event("input", { bubbles: true }));
  source.dispatchEvent(new Event("change", { bubbles: true }));
  syncSelects();
}
function openSelect(
  source: HTMLSelectElement,
  trigger: HTMLButtonElement,
  direction = 0,
) {
  if (anchor === trigger) {
    closeMenu();
    return;
  }
  showMenu(
    trigger,
    `${source.dataset.search !== "false" && source.options.length > 6 ? `<input class="option-search" aria-label="${C.searchOptions}" placeholder="${C.searchOptions}" autocomplete="off">` : ""}<div class="option-list" role="listbox" id="options-${sequence}"></div>`,
    trigger.getAttribute("aria-label") || "",
  );
  select = source;
  trigger.setAttribute("aria-controls", `options-${sequence}`);
  renderOptions();
  if (direction) highlight(activeIndex + direction);
  popup!.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-option]",
    );
    if (item) choose(Number(item.dataset.option));
  });
  const search = popup!.querySelector<HTMLInputElement>(".option-search")!;
  if (search) {
    search.addEventListener("input", () => renderOptions(search.value));
    search.focus();
  }
}
export function syncSelects(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLSelectElement>("select[data-enhanced]")
    .forEach((source) => {
      const trigger =
        source.parentElement!.querySelector<HTMLButtonElement>(
          ".select-trigger",
        )!;
      if (!trigger) return;
      trigger.querySelector<HTMLElement>(".select-value")!.textContent =
        source.dataset.shortValue ||
        source.selectedOptions[0]?.textContent ||
        "";
      trigger.disabled = source.disabled;
    });
}
export function enhanceSelects(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLSelectElement>("select:not([data-enhanced])")
    .forEach((source) => {
      sequence++;
      if (!source.id) source.id = `select-${sequence}`;
      const wrapper = document.createElement("div");
      wrapper.className = `select-field ${source.className}`;
      const label =
        source.closest("label")?.querySelector<HTMLElement>(".field-label")!
          ?.textContent || source.labels?.[0]?.textContent.split("\n")[0];
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "select-trigger";
      trigger.dataset.selectFor = source.id;
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute(
        "aria-label",
        source.getAttribute("aria-label") || label || source.id,
      );
      trigger.innerHTML =
        '<span class="select-value"></span><span class="select-arrow" aria-hidden="true"></span>';
      source.before(wrapper);
      wrapper.append(source, trigger);
      source.hidden = true;
      source.dataset.enhanced = "true";
      trigger.addEventListener("click", () => openSelect(source, trigger));
      trigger.addEventListener("keydown", (event) => {
        if (!popup && ["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          openSelect(source, trigger, event.key === "ArrowDown" ? 1 : -1);
        }
      });
    });
  syncSelects(root);
}
document.addEventListener("pointerdown", (event) => {
  if (
    popup &&
    !popup.contains(event.target as Node) &&
    !anchor!.contains(event.target as Node)
  )
    closeMenu();
});
document.addEventListener(
  "keydown",
  (event) => {
    if (!popup) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab" && popup.getAttribute("role") !== "dialog") {
      closeMenu();
      return;
    }
    if (
      select &&
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") choose(activeIndex);
      else
        highlight(
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? menuOptions.length - 1
              : activeIndex + (event.key === "ArrowDown" ? 1 : -1),
        );
    }
  },
  true,
);
document.addEventListener(
  "scroll",
  (event) => {
    if (popup && !popup.contains(event.target as Node)) closeMenu();
  },
  true,
);
window.addEventListener("resize", () => closeMenu());
