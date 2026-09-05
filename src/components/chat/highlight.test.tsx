import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { highlightCode } from "./highlight";
import { CodeTokens } from "./markdown";

describe("safe syntax highlighting", () => {
  it("highlights TypeScript with colors for both themes and preserves every character", async () => {
    const code = "const answer: number = 42;\nconsole.log(answer);";
    const lines = await highlightCode(code, "typescript");
    expect(
      lines.map((line) => line.map((t) => t.content).join("")).join("\n"),
    ).toBe(code);
    expect(
      new Set(lines.flat().map((t) => t.variants.light.color)).size,
    ).toBeGreaterThan(1);
    expect(
      new Set(lines.flat().map((t) => t.variants.dark.color)).size,
    ).toBeGreaterThan(1);
    expect(renderToStaticMarkup(<CodeTokens lines={lines} />)).toContain(
      "--syntax-dark:",
    );
  });

  it("escapes hostile HTML tokens instead of creating elements", async () => {
    const code = '<script>alert(1)</script><img src=x onerror="alert(1)">';
    const html = renderToStaticMarkup(
      <CodeTokens lines={await highlightCode(code, "html")} />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;");
  });

  it.each(["unknown-language", "constructor", "__proto__"])(
    "falls back to text for %s",
    async (lang) => {
      const lines = await highlightCode("a < b\n", lang);
      expect(
        lines.map((line) => line.map((t) => t.content).join("")).join("\n"),
      ).toBe("a < b\n");
    },
  );
});
