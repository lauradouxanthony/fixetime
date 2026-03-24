/** Erreur lancée quand le fetch expire. */
export const FETCH_TIMEOUT_ERROR_PREFIX = "UPSTREAM_TIMEOUT:";

/**
 * Fetch avec timeout strict (AbortController).
 * Utilisé pour éviter que les appels externes bloquent l'API.
 * @throws Error avec message préfixé par UPSTREAM_TIMEOUT: en cas de timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, signal: externalSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const name = err && typeof err === "object" && "name" in err ? (err as { name: string }).name : "";
    if (name === "AbortError") {
      const e = new Error(`${FETCH_TIMEOUT_ERROR_PREFIX} ${timeoutMs}ms`);
      (e as Error & { code: string }).code = "UPSTREAM_TIMEOUT";
      throw e;
    }
    throw err;
  }
}

export function isUpstreamTimeout(err: unknown): boolean {
  return err instanceof Error && (err.message.startsWith(FETCH_TIMEOUT_ERROR_PREFIX) || (err as Error & { code?: string }).code === "UPSTREAM_TIMEOUT");
}
