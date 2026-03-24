import { getValidMicrosoftAccessToken } from "./getValidAccessToken";

const GRAPH_FETCH_TIMEOUT_MS = 12_000;

export async function graphFetch(
  userId: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const accessToken = await getValidMicrosoftAccessToken(userId);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...(init ?? {}),
      signal: controller.signal,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}
