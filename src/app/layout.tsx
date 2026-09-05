import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/lib/db/client";
import { getSettings } from "@/lib/repo/settings";
import "../styles/tokens.css";
import "../styles/base.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zeus Chat",
  description: "A self-hosted chat interface for any AI model.",
};

// The theme is a stored preference read per request, so <html> carries it
// before first paint and no route (not even 404) is prerendered at build time.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const { theme } = getSettings(getDb());
  return (
    <html lang="en" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
