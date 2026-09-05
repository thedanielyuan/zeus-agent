/** Same-origin JSON only; server boundaries return messages safe to show in the UI. */
export async function apiRequest<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      error?.message ?? "Could not save or load your changes. Please retry.",
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
