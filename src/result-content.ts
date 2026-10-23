import { marked } from "marked";
import DOMPurify from "dompurify";

// Model output is untrusted. Keep text formatting, never executable page markup.
export function renderMarkdown(output: HTMLElement, text: string) {
  const fragment = DOMPurify.sanitize(
    marked.parse(text, { async: false, gfm: true, breaks: true }).trim(),
    {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: [
        "p",
        "br",
        "strong",
        "em",
        "del",
        "s",
        "a",
        "blockquote",
        "pre",
        "code",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
      ],
      ALLOWED_ATTR: ["href", "start", "align"],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
    },
  );
  fragment.querySelectorAll("a[href]").forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
  output.classList.add("result-markdown");
  output.replaceChildren(fragment);
}
