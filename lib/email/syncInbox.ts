import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { getValidMicrosoftAccessToken } from "@/lib/microsoft/getValidAccessToken";
import { graphFetch } from "@/lib/microsoft/graph";

export type EmailProvider = "google" | "microsoft";

export type CoreSyncResult = {
  ok: boolean;
  provider: EmailProvider;
  fetched: number;
  inserted: number;
  cursor_updated: boolean;
  duration_ms: number;
  error?: string;
};

export type SyncInboxOptions = {
  userId: string;
  provider?: EmailProvider;
  limit?: number;
  maxDurationMs?: number;
  mode?: "latest" | "cursor";
  forceMinutes?: number | null;
  debug?: boolean;
};

export type LegacySyncResult = {
  inserted: number;
  analyzed: number;
  processed: number;
  next_cursor: string | null;
  had_more: boolean;
  errors: string[];
  status: "ok" | "partial-timeout" | "error";
} & CoreSyncResult;

const DEFAULT_MAX_MESSAGES = 50;
const DEFAULT_MAX_DURATION_MS = 10_000;

export async function syncInboxForUser(
  userId: string,
  provider: EmailProvider,
  maxMessages?: number | null,
  windowDays?: 7 | 30,
): Promise<CoreSyncResult>;
export async function syncInboxForUser(
  opts: SyncInboxOptions
): Promise<LegacySyncResult>;
export async function syncInboxForUser(
  arg1: string | SyncInboxOptions,
  arg2?: EmailProvider,
  arg3?: number | null,
  arg4?: 7 | 30,
): Promise<CoreSyncResult | LegacySyncResult> {
  if (typeof arg1 === "string") {
    const windowDays: 7 | 30 = arg4 === 7 ? 7 : 30;
    const userId = arg1;
    const provider: EmailProvider = arg2 ?? "google";
    const maxMessages = Math.max(
      1,
      Math.min(arg3 ?? DEFAULT_MAX_MESSAGES, 500)
    );
    return coreSync(userId, provider, maxMessages);
  }

  const opts = arg1;
  const userId = opts.userId;
  const provider: EmailProvider = opts.provider ?? "google";
  const maxMessages = Math.max(
    1,
    Math.min(opts.limit ?? DEFAULT_MAX_MESSAGES, 500)
  );
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

  const startedAt = Date.now();
  const core = await coreSync(userId, provider, maxMessages, maxDurationMs);

  return {
    ...core,
    inserted: core.inserted,
    analyzed: 0,
    processed: core.fetched,
    next_cursor: null,
    had_more: false,
    errors: core.error ? [core.error] : [],
    status: core.ok ? "ok" : "error",
  };
}

async function coreSync(
  userId: string,
  provider: EmailProvider,
  maxMessages: number,
  maxDurationMs: number = DEFAULT_MAX_DURATION_MS
): Promise<CoreSyncResult> {
  const startedAt = Date.now();
  let fetched = 0;
  let inserted = 0;
  let error: string | undefined;

  try {
    if (provider === "microsoft") {
      return {
        ok: false,
        provider,
        fetched: 0,
        inserted: 0,
        cursor_updated: false,
        duration_ms: Date.now() - startedAt,
        error: "OUTLOOK_SYNC_NOT_IMPLEMENTED",
      };
    }

    const { data: tok } = await supabaseAdmin
      .from("gmail_tokens")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!tok?.user_id) {
      return {
        ok: true,
        provider,
        fetched: 0,
        inserted: 0,
        cursor_updated: false,
        duration_ms: Date.now() - startedAt,
      };
    }

    const accessToken = await getValidGoogleAccessToken(userId);

    const baseUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    );
    baseUrl.searchParams.set("q", "newer_than:30d");

    let pageToken: string | undefined = undefined;
    const deadline = Date.now() + maxDurationMs;

    while (fetched < maxMessages && Date.now() < deadline) {
      const url = new URL(baseUrl.toString());
      url.searchParams.set(
        "maxResults",
        String(Math.min(100, maxMessages - fetched))
      );
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const listRes = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!listRes.ok) {
        const txt = await listRes.text();
        error = `GMAIL_LIST_ERROR: ${listRes.status} ${txt.slice(0, 200)}`;
        break;
      }

      const listJson: {
        messages?: { id: string }[];
        nextPageToken?: string;
      } = await listRes.json().catch(() => ({}));

      const messages = listJson.messages ?? [];
      if (!messages.length) break;

      for (const msg of messages) {
        if (fetched >= maxMessages || Date.now() >= deadline) break;
        fetched++;

        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (!detailRes.ok) continue;
        const detail = await detailRes.json().catch(() => null);
        if (!detail) continue;

        const headers = detail.payload?.headers || [];
        const from =
          headers.find((h: any) => h.name === "From")?.value ?? "Inconnu";
        const subject =
          headers.find((h: any) => h.name === "Subject")?.value ??
          "(Sans objet)";

        // Priorité à internalDate (epoch ms), fallback sur le header Date, puis maintenant()
        const internalDateMs = detail.internalDate
          ? Number(detail.internalDate)
          : NaN;
        const hasInternalDate = Number.isFinite(internalDateMs);
        const dateHeader = headers.find((h: any) => h.name === "Date")?.value;

        const receivedAt = hasInternalDate
          ? new Date(internalDateMs).toISOString()
          : dateHeader
          ? new Date(dateHeader).toISOString()
          : new Date().toISOString();

        const { error: upsertError } = await supabaseAdmin
          .from("emails")
          .upsert(
            {
              user_id: userId,
              provider: "google",
              gmail_message_id: msg.id,
              gmail_thread_id: detail.threadId ?? null,
              sender: from,
              subject,
              received_at: receivedAt,
            },
            { onConflict: "user_id,gmail_message_id" }
          );
        if (!upsertError) {
          inserted++;
        }
      }

      pageToken = listJson.nextPageToken;
      if (!pageToken) break;
    }
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  const duration_ms = Date.now() - startedAt;

  return {
    ok: !error,
    provider,
    fetched,
    inserted,
    cursor_updated: false,
    duration_ms,
    ...(error ? { error } : {}),
  };
}
