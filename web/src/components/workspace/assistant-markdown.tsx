import { createElement } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { externalUrl } from "@/lib/client";

const allowedElements = ["p", "strong", "em", "del", "a", "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "hr", "br", "sup", "section", "input"];

const components: Components = {
  a: ({ children, href }) => {
    const safeUrl = externalUrl(href);
    return safeUrl
      ? createElement("a", { href: safeUrl, target: "_blank", rel: "noopener noreferrer" }, children)
      : createElement("span", null, children);
  },
  // Images are excluded from the allowlist; retain an explicit safe component
  // so a later allowlist change cannot start external image requests.
  img: () => null,
  input: ({ checked }) => createElement("span", { className: "assistant-task-status", role: "img", "aria-label": checked ? "مكتمل" : "لم يكتمل" }, checked ? "✓" : "○"),
  h1: ({ children }) => createElement("h3", null, children),
  h2: ({ children }) => createElement("h3", null, children),
  table: ({ children }) => createElement("div", { className: "assistant-table-scroll", role: "region", "aria-label": "جدول في إجابة AoosGPT", tabIndex: 0 }, createElement("table", null, children)),
};

/** Render untrusted model output without raw HTML or remote media. */
export function AssistantMarkdown({ content }: { content: string }) {
  return createElement("div", { className: "assistant-markdown", dir: "auto" }, createElement(Markdown, {
    skipHtml: true,
    allowedElements,
    remarkPlugins: [remarkGfm],
    components,
    urlTransform: (value, key) => key === "href" ? externalUrl(value) || "" : "",
  }, content));
}
