/** Loaded only when a fenced code block needs highlighting. No HTML is produced. */
export async function highlightCode(text: string, language: string) {
  const { bundledLanguages, codeToTokensWithThemes } =
    await import("shiki/bundle/web");
  const lang = Object.hasOwn(bundledLanguages, language)
    ? (language as keyof typeof bundledLanguages)
    : "text";
  return codeToTokensWithThemes(text, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
  });
}

export type HighlightedLines = Awaited<ReturnType<typeof highlightCode>>;
