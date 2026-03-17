/**
 * Fetch avec timeout strict (12s par défaut).
 * Évite les appels externes qui bloquent l'API.
 * @throws Error("TIMEOUT") en cas d'abort par timeout
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError") {
      throw new Error("TIMEOUT");
    }
    throw err;
  }
}
