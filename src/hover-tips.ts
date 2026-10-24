// Shared top-layer tips stay outside clipped panels and inside the viewport.
export class HoverTips {
  readonly element = document.createElement("div");
  private target: HTMLElement | null = null;
  private hintTarget: HTMLElement | null = null;
  private hintText = "";
  private resize: ResizeObserver | undefined;

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
        this.restoreHint();
    });
    root.addEventListener(
      "focusin",
      (event) => void this.show(event.target as HTMLElement),
    );
    root.addEventListener("focusout", () => this.restoreHint());
    root.addEventListener("scroll", () => this.restoreHint(), true);
    root.addEventListener("pointerdown", () => this.hide());
    root.addEventListener("pointerup", () =>
      queueMicrotask(() => this.refresh()),
    );
  }

  private available(button: HTMLElement) {
    return (
      this.enabled() &&
      button.isConnected &&
      this.root.contains(button) &&
      !button.matches(
        ":disabled,[aria-disabled=true],[aria-expanded=true],:has(:disabled),:has([aria-disabled=true])",
      ) &&
      !button.closest("[inert],[hidden],[aria-disabled=true]") &&
      button.getClientRects().length > 0 &&
      getComputedStyle(button).visibility !== "hidden" &&
      Boolean(this.text(button))
    );
  }

  // A setup hint is derived from current configuration, not a saved onboarding step.
  setHint(button: HTMLElement | null, text = "") {
    if (this.target === this.hintTarget && button !== this.hintTarget)
      this.hide(true);
    this.hintTarget = button;
    this.hintText = text;
    if (button) {
      this.resize ??= new ResizeObserver(() => this.refresh());
      this.resize.observe(this.root);
    } else this.resize?.disconnect();
    this.refresh();
  }

  private restoreHint(immediate = false) {
    if (this.hintTarget && this.available(this.hintTarget))
      void this.show(this.hintTarget);
    else this.hide(immediate);
  }

  refresh() {
    if (!this.root.isConnected) {
      this.destroy();
      return;
    }
    if (this.target && !this.available(this.target)) this.hide(true);
    if (!this.target) this.restoreHint();
    else if (this.element.matches(":popover-open")) this.position(this.target);
  }

  private text(button: HTMLElement) {
    return button === this.hintTarget
      ? this.hintText
      : button.dataset.tooltip || button.getAttribute("aria-label");
  }

  private position(button: HTMLElement) {
    const tip = this.element;
    tip.textContent = this.text(button);
    const setup = button === this.hintTarget;
    tip.classList.toggle("model-setup-tip", setup);
    // Leave room for the setup tip's 4px upward drift.
    const topInset = setup ? 12 : 8;
    const rect = button.getBoundingClientRect(),
      bounds = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - bounds.width) / 2, innerWidth - bounds.width - 8))}px`;
    tip.style.top = `${rect.top - bounds.height - 8 >= topInset ? rect.top - bounds.height - 8 : Math.min(rect.bottom + 8, innerHeight - bounds.height - 8)}px`;
  }

  private async show(target: HTMLElement) {
    const button = target.closest<HTMLElement>(this.selector);
    if (!button || !this.available(button)) {
      this.restoreHint(true);
      return;
    }
    if (button === this.target) return;
    this.hide(true);
    this.target = button;
    // Anchor placement may animate on the control or its sliding panel.
    const placement: Animation[] = [];
    for (
      let element: HTMLElement | null = button;
      element && this.root.contains(element);
      element = element.parentElement
    ) {
      placement.push(
        ...element
          .getAnimations()
          .filter(
            (animation) =>
              animation instanceof CSSTransition &&
              [
                "transform",
                "translate",
                "left",
                "right",
                "top",
                "bottom",
                "width",
                "height",
              ].includes(animation.transitionProperty),
          ),
      );
    }
    await Promise.all(
      placement.map((animation) => animation.finished.catch(() => {})),
    );
    if (this.target !== button || !this.available(button)) return;
    const tip = this.element;
    (button.closest("dialog") || this.root).append(tip);
    tip.textContent = this.text(button);
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
      { transform, translate } = getComputedStyle(tip);
    tip.getAnimations().forEach((animation) => animation.cancel());
    if (!tip.matches(":popover-open")) return;
    if (immediate) {
      tip.hidePopover();
      return;
    }
    tip.animate(
      [
        { transform, translate },
        { transform: "translateY(3px)", translate: "none" },
      ],
      {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 100,
        easing: "ease-in",
      },
    ).onfinish = () => {
      if (!this.target) tip.hidePopover();
    };
  }

  destroy() {
    this.hintTarget = null;
    this.resize?.disconnect();
    this.hide(true);
  }
}
