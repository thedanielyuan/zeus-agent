"use client";

import { useSyncExternalStore } from "react";

const key = "zeus.theme.v1";
let fallback: "light" | "dark" = "light";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("zeus-theme", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("zeus-theme", listener);
  };
}

function snapshot(): "light" | "dark" {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === "dark" || stored === "light" ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    snapshot,
    () => "light" as const,
  );
  function setTheme(next: "light" | "dark") {
    fallback = next;
    try {
      window.localStorage.setItem(key, next);
    } catch {
      /* In-memory preference if storage is unavailable. */
    }
    window.dispatchEvent(new Event("zeus-theme"));
  }
  return { theme, setTheme };
}
