"use client";

import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Icon } from "@/components/ui/icon";
import type { HighlightedLines } from "./highlight";

export function CopyButton({
  text,
  label = "Copy message",
  showLabel = false,
}: {
  text: string;
  label?: string;
  showLabel?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);

  return (
    <button
      className={showLabel ? "code-copy" : "icon-button"}
      type="button"
      aria-label={
        status === "copied"
          ? "Copied"
          : status === "error"
            ? "Copy failed, try again"
            : label
      }
      title={status === "copied" ? "Copied!" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus("copied");
        } catch {
          setStatus("error");
        }
        clearTimeout(timeout.current);
        timeout.current = setTimeout(() => setStatus("idle"), 2000);
      }}
    >
      <Icon name={status === "copied" ? "check" : "copy"} size={16} />
      {showLabel && (
        <span>
          {status === "copied"
            ? "Copied!"
            : status === "error"
              ? "Try again"
              : "Copy code"}
        </span>
      )}
      <span className="sr-only" role="status">
        {status === "copied"
          ? "Copied to clipboard"
          : status === "error"
            ? "Could not access the clipboard"
            : ""}
      </span>
    </button>
  );
}

export function CodeTokens({ lines }: { lines: HighlightedLines }) {
  return lines.map((line, i) => (
    <span key={i}>
      {i > 0 ? "\n" : ""}
      {line.map((token, j) => (
        <span key={j} className="syntax-token" style={{
          "--syntax-light": token.variants.light.color,
          "--syntax-dark": token.variants.dark.color,
        } as CSSProperties}>{token.content}</span>
      ))}
    </span>
  ));
}

const HighlightedCode = memo(function HighlightedCode({ text, language }: { text: string; language: string }) {
  const [highlight, setHighlight] = useState<{ text: string; language: string; lines: HighlightedLines }>();
  useEffect(() => {
    let current = true;
    // Debounce fast streaming; show current plain text while tokenization waits.
    const timer = setTimeout(() => {
      void import("./highlight").then(({ highlightCode }) => highlightCode(text, language))
        .then((lines) => { if (current) setHighlight({ text, language, lines }); })
        .catch(() => { /* Unsupported grammar or loading failure: keep readable text. */ });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [text, language]);
  return <code>{highlight?.text === text && highlight.language === language
    ? <CodeTokens lines={highlight.lines} /> : text}</code>;
});

function CodeBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  const code = isValidElement<{ children?: ReactNode; className?: string }>(
    child,
  )
    ? child
    : undefined;
  const text = String(code?.props.children ?? "").replace(/\n$/, "");
  const language = code?.props.className?.replace("language-", "") ?? "text";
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language}</span>
        <CopyButton text={text} label="Copy code" showLabel />
      </div>
      <pre><HighlightedCode text={text} language={language} /></pre>
    </div>
  );
}

const components = {
  pre: CodeBlock,
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Untrusted replies must not trigger automatic requests to third-party images.
  img: ({ src, alt }: ComponentProps<"img">) => (
    <a
      href={typeof src === "string" ? src : undefined}
      target="_blank"
      rel="noopener noreferrer"
    >
      {alt || "View image"}
    </a>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
};
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeSanitize];

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
      skipHtml
    >
      {children}
    </ReactMarkdown>
  );
}
