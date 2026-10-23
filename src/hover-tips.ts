// Shared top-layer tips stay outside clipped panels and inside the viewport.
export class HoverTips {
  readonly element = document.createElement("div");
  private target: HTMLElement | null = null;

  constructor(
    private root: HTMLElement,
    private selector: string,
    private enabled: () => boolean = () => true,
  ) {
    this.element.className = "hover-tip";
    this.element.id = `hover-tip-${crypto.randomUUID()}`;
    this.element.setAttribute("popover", "manual");
    this.element.setAttribute("role", "tooltip");
    root.append(this.element);
    root.addEventListener(
      "pointerover",
      (event) => void this.show(event.target as HTMLElement),
    );
    root.addEventListener("pointerout", (event) => {
      if (!this.target?.contains(event.relatedTarget as Node | null))
        this.hide();
    });
    root.addEventListener(
      "focusin",
      (event) => void this.show(event.target as HTMLElement),
    );
    root.addEventListener("focusout", () => this.hide());
    root.addEventListener("scroll", () => this.hide(), true);
    root.addEventListener("pointerdown", () => this.hide());
  }

  private available(button: HTMLElement) {
    return (
      this.enabled() &&
      button.isConnected &&
      this.root.contains(button) &&
      !button.matches(":disabled,[aria-disabled=true]") &&
      !button.closest("[inert],[aria-disabled=true]") &&
      Boolean(button.getAttribute("aria-label"))
    );
  }

  refresh() {
    if (!this.target) return;
    if (!this.available(this.target)) this.hide(true);
    else if (this.element.matches(":popover-open")) this.position(this.target);
  }

  private position(button: HTMLElement) {
    const tip = this.element;
    tip.textContent = button.getAttribute("aria-label");
    const rect = button.getBoundingClientRect(),
      bounds = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - bounds.width) / 2, innerWidth - bounds.width - 8))}px`;
    tip.style.top = `${rect.top - bounds.height - 8 >= 8 ? rect.top - bounds.height - 8 : Math.min(rect.bottom + 8, innerHeight - bounds.height - 8)}px`;
  }

  private async show(target: HTMLElement) {
    const button = target.closest<HTMLElement>(this.selector);
    if (!button || !this.available(button)) {
      this.hide(true);
      return;
    }
    if (button === this.target) return;
    this.hide(true);
    this.target = button;
    // A radial button can receive focus before its flight to the final position.
    await Promise.all(
      button
        .getAnimations()
        .filter(
          (animation) =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === "transform",
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
    if (this.target !== button || !this.available(button)) return;
    const tip = this.element;
    tip.textContent = button.getAttribute("aria-label");
    button.setAttribute("aria-describedby", tip.id);
    tip.showPopover();
    this.position(button);
    tip.animate([{ transform: "translateY(3px)" }, { transform: "none" }], {
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 140,
      easing: "ease-out",
    });
  }

  hide(immediate = false) {
    if (!this.target && !immediate) return;
    this.target?.removeAttribute("aria-describedby");
    this.target = null;
    const tip = this.element,
      { transform } = getComputedStyle(tip);
    tip.getAnimations().forEach((animation) => animation.cancel());
    if (!tip.matches(":popover-open")) return;
    if (immediate) {
      tip.hidePopover();
      return;
    }
    tip.animate([{ transform }, { transform: "translateY(3px)" }], {
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 100,
      easing: "ease-in",
    }).onfinish = () => {
      if (!this.target) tip.hidePopover();
    };
  }
}
