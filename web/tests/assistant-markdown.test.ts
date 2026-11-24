import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown } from "@/components/workspace/assistant-markdown";

const render = (content: string) => renderToStaticMarkup(createElement(AssistantMarkdown, { content }));

describe("safe assistant Markdown", () => {
  it("renders structured Arabic lessons and keyboard-scrollable tables", () => {
    const html = render("# خطوات المراجعة\n\n1. اجمع المستندات\n2. راجع النواقص\n\n| الخطوة | الحالة |\n| --- | --- |\n| المراجعة | تحتاج مستندًا |\n");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("<h3>خطوات المراجعة</h3>");
    expect(html).not.toMatch(/<h[12][ >]/);
    expect(html).toContain("<ol>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>الخطوة</th>");
    expect(html).toContain('role="region" aria-label="جدول في إجابة AoosGPT" tabindex="0"');
  });

  it("ignores raw executable HTML and all embedded or remote media", () => {
    const html = render([
      '<script>alert("raw-script")</script>',
      '<iframe src="https://tracking.example/frame"></iframe>',
      '<svg onload="alert(1)"><image href="https://tracking.example/svg" /></svg>',
      '<img src="https://tracking.example/raw-image" onerror="alert(1)">',
      "![tracking image](https://tracking.example/markdown-image)",
      "![embedded image](data:image/svg+xml;base64,PHN2Zz4=)",
      "نص آمن",
    ].join("\n\n"));
    expect(html).not.toMatch(/<(?:script|iframe|svg|img|image|link|audio|video)\b/i);
    expect(html).not.toContain("tracking.example");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onload");
    expect(html).toContain("نص آمن");
  });

  it.each([
    "javascript:alert%281%29",
    "JaVaScRiPt:alert%281%29",
    "javascript&#58;alert%281%29",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "//tracking.example/path",
    "/api/admin/users",
    "#internal-target",
  ])("keeps unsafe or application-relative links inert: %s", (href) => {
    const html = render(`[نص الرابط](${href})`);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).toContain("نص الرابط");
  });

  it("opens only explicit HTTP(S) links with an isolated browsing context", () => {
    const html = render("[المصدر](https://example.gov.sa/path?q=1) و[مصدر آخر](http://example.gov.sa/)");
    expect(html).toContain('href="https://example.gov.sa/path?q=1" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="http://example.gov.sa/" target="_blank" rel="noopener noreferrer"');
  });

  it("escapes example code and describes checklist statuses without interactive controls", () => {
    const html = render('```html\n<img src="https://example.com/pixel" onerror="alert(1)">\n```\n\n- [x] راجعت المستند\n- [ ] طلبت الناقص');
    expect(html).toContain("<pre><code");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/<(?:img|input)\b/);
    expect(html).toContain('role="img" aria-label="مكتمل"');
    expect(html).toContain('role="img" aria-label="لم يكتمل"');
    expect(html).toContain("راجعت المستند");
    expect(html).toContain("طلبت الناقص");
  });
});
