import type { CSSProperties } from "react";

const paths = {
  arrowUp: "m6 12 6-6 6 6M12 6v14",
  arrowDown: "m6 12 6 6 6-6M12 18V4",
  arrowRight: "M4 12h16m-6-6 6 6-6 6",
  chevronDown: "m7 10 5 5 5-5",
  chevronRight: "m9 5 7 7-7 7",
  sidebar:
    "M9 4v16M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  compose:
    "M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6M16 4l4 4M10 14l1-5 8-8 4 4-8 8-5 1Z",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  chat: "M20 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 20l.9-4.5A9 9 0 0 1 3 11.5a8.5 8.5 0 1 1 17 0Z",
  sliders: "M4 7h8m4 0h4M4 17h3m4 0h9M12 4v6M7 14v6",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  moon: "M20.8 13.4A9 9 0 0 1 10.6 3.2 9 9 0 1 0 20.8 13.4Z",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18",
  pen: "m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15l-1 5Z",
  bulb: "M9 18h6m-5 3h4M9 15c0-3-3-3-3-7a6 6 0 0 1 12 0c0 4-3 4-3 7H9Z",
  book: "M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V3Z",
  sparkles:
    "m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3ZM20 2v4m-2-2h4",
  copy: "M8 8h12v12H8V8ZM16 4H4v12",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6.1 6a8 8 0 0 1 13.2 2M4.7 16A8 8 0 0 0 17.9 18",
  download: "M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  info: "M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  bolt: "m13 2-9 12h7l-1 8L21 9h-8l1-7Z",
  stop: "M6 6h12v12H6Z",
} satisfies Record<string, string>;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function ZeusMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="10" fill="currentColor" />
      <path d="M10 9h13l-9 11h8l-1 3H8l9-11h-8l1-3Z" fill="var(--surface)" />
    </svg>
  );
}
