import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("untrusted assistant Markdown", () => {
  it("drops raw HTML and disables script URLs", () => {
    const html = renderToStaticMarkup(
      <Markdown>
        {
          '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert%281%29)'
        }
      </Markdown>,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("renders tables and safe external links", () => {
    const html = renderToStaticMarkup(
      <Markdown>
        {
          "| Name | Value |\n| --- | --- |\n| Answer | 42 |\n\n[Reference](https://example.com)"
        }
      </Markdown>,
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<td>42</td>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("escapes HTML inside code and exposes a copy control", () => {
    const html = renderToStaticMarkup(
      <Markdown>{'```html\n<script>alert("hello")</script>\n```'}</Markdown>,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('aria-label="Copy code"');
  });

  it("requires a click before loading an external image", () => {
    const html = renderToStaticMarkup(
      <Markdown>
        {"![Example diagram](https://example.com/image.png)"}
      </Markdown>,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://example.com/image.png"');
    expect(html).toContain("Example diagram</a>");
  });
});
