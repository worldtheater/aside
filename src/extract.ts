import { needsUiContext, UI_CONTEXT_LIMITS } from "./translation.js";
import type { ExtractedBlock, UiContext } from "./types.js";
(() => {
  if (globalThis.PageworkExtract) return;
  let sequence = 0;
  const ids = new WeakMap<HTMLElement, string>();
  const excluded =
    'script,style,noscript,svg,canvas,input,textarea,select,pre,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-pagework]';
  const semantic = "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,figcaption,dt,dd";
  function hiddenByDetails(element: HTMLElement) {
    // Closed <details> can retain client rects after being opened. Only its
    // first summary remains visible, including through nested disclosures.
    for (
      let details = element.closest<HTMLDetailsElement>("details:not([open])");
      details;
      details =
        details.parentElement?.closest<HTMLDetailsElement>(
          "details:not([open])",
        ) || null
    ) {
      if (!details.querySelector(":scope>summary")?.contains(element))
        return true;
    }
    return false;
  }
  function owner(node: Node, root: Element) {
    const paragraph = node.parentElement!.closest<HTMLElement>(semantic);
    if (paragraph && root.contains(paragraph)) return paragraph;
    const interactive =
      node.parentElement!.closest<HTMLElement>("a,button,label");
    if (interactive) return interactive;
    return blockOwner(node.parentElement!, root);
  }
  function blockOwner(element: HTMLElement, root: Element) {
    while (
      element !== root &&
      !["block", "flex", "grid", "table-cell", "list-item"].includes(
        getComputedStyle(element).display,
      )
    )
      element = element.parentElement!;
    return element;
  }
  function context(
    element: HTMLElement,
    source: string,
  ): UiContext | undefined {
    const contextExcluded = `${excluded},code`;
    if (!needsUiContext(source) || element.closest(contextExcluded)) return;
    const visible = (element: HTMLElement) => {
      if (hiddenByDetails(element) || !element.getClientRects().length)
        return false;
      for (
        let node: HTMLElement | null = element;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        )
          return false;
      }
      return true;
    };
    // Context reads only the three agreed UI labels, without code, form,
    // hidden content or extension results.
    const titleText = (root: Element | null) => {
      if (!root) return "";
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement!;
          return !parent.closest(contextExcluded) && visible(parent)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      let text = "";
      while (text.length < UI_CONTEXT_LIMITS.fieldChars && walker.nextNode())
        text += " " + walker.currentNode.textContent;
      return text
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, UI_CONTEXT_LIMITS.fieldChars);
    };
    const region =
      element.closest("section,article,[role=region],main,[role=main]") ||
      document.body;
    const heading = [
      ...region.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
    ]
      .filter(
        (h) =>
          h !== element &&
          !h.closest(contextExcluded) &&
          visible(h) &&
          Boolean(
            h.compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
      )
      .at(-1);
    const table = element.closest("table"),
      header = table?.tHead || table?.querySelector("tr:has(th)");
    const pageTitle = document.title
        .trim()
        .slice(0, UI_CONTEXT_LIMITS.fieldChars),
      sectionTitle = titleText(heading || null),
      tableHeaders = [...(header?.querySelectorAll("th") || [])]
        .map(titleText)
        .join(" ")
        .slice(0, UI_CONTEXT_LIMITS.fieldChars);
    return {
      ...(pageTitle && pageTitle !== source ? { pageTitle } : {}),
      ...(sectionTitle && sectionTitle !== source ? { sectionTitle } : {}),
      ...(tableHeaders && tableHeaders !== source ? { tableHeaders } : {}),
    };
  }
  function extract(scope = "body", within?: HTMLElement): ExtractedBlock[] {
    const root =
      scope === "all"
        ? document.body
        : document.querySelector<HTMLElement>("main,[role=main],article") ||
          document.body;
    // Re-read the complete owning paragraph when a nested text node changes.
    // Ownership still uses the page root, so partial scans group links and code
    // exactly like the initial extraction.
    if (within && !root.contains(within) && !within.contains(root)) return [];
    const paragraph = within?.closest<HTMLElement>(semantic);
    const scanRoot =
      !within || within.contains(root)
        ? root
        : paragraph && root.contains(paragraph)
          ? paragraph
          : blockOwner(within, root);
    const groups = new Map<HTMLElement, Node[]>(),
      visibility = new WeakMap<HTMLElement, boolean>();
    const visible = (el: HTMLElement | null): boolean => {
      if (!el || el === document.body) return true;
      if (visibility.has(el)) return visibility.get(el)!;
      const style = getComputedStyle(el);
      const value =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        visible(el.parentElement);
      visibility.set(el, value);
      return value;
    };
    const walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement!;
        return node.textContent &&
          !el.closest(excluded) &&
          !hiddenByDetails(el) &&
          visible(el) &&
          el.getClientRects().length
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const entries: { node: Node; element: HTMLElement }[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      entries.push({ node, element: owner(node, root) });
    }
    // Inline code is part of its sentence; code-only blocks are not prose.
    const isProse = (node: Node) =>
      !node.parentElement!.closest("code") &&
      /[\p{L}\p{N}]/u.test(node.textContent || "");
    // A visual paragraph need not be a <p>. Its inline links belong to the
    // same source block when it also owns prose outside those links.
    const proseOwners = new Set(
      entries
        .filter(
          ({ node, element }) =>
            !element.matches("a,button,label") && isProse(node),
        )
        .map(({ element }) => element),
    );
    for (const { node, element } of entries) {
      let target = element;
      if (
        element.matches("a") &&
        !element.closest("nav,[role=navigation],[role=menu],[role=menubar]") &&
        /^(inline|contents)/.test(getComputedStyle(element).display)
      ) {
        const paragraph = blockOwner(element.parentElement!, root);
        if (
          proseOwners.has(paragraph) &&
          getComputedStyle(paragraph).display === "block"
        )
          target = paragraph;
      }
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target)!.push(node);
    }
    return [...groups]
      .filter(([, nodes]) => nodes.some(isProse))
      .map(([element, nodes]) => {
        if (!ids.has(element)) ids.set(element, `pw-${++sequence}`);
        return {
          id: ids.get(element)!,
          text: nodes
            .map((node) => node.textContent)
            .join("")
            .replace(/\s+/g, " ")
            .trim(),
          element,
        };
      });
  }
  globalThis.PageworkExtract = { extract, context };
})();
