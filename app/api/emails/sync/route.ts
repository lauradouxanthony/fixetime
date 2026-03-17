import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { syncInboxForUser, type EmailProvider } from "../../../../lib/email/syncInbox";

export const runtime = "nodejs";
export const maxDuration = 30;

type SyncBody = {
  user_id?: string;
  provider?: EmailProvider; // "google" | "microsoft"
  max_messages?: number; // <= 500
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", duration_ms: Date.now() - startedAt },
      { status: 401 }
    );
  }

  let body: SyncBody = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object") body = raw as SyncBody;
  } catch {}

  const userId = body.user_id ?? data.user.id;
  const provider: EmailProvider = body.provider ?? "google";
  const maxMessages = Math.max(1, Math.min(Number(body.max_messages) || 500, 500));

  try {
    // Optional guard: no token => no sync
    if (provider === "google") {
      const { data: tok } = await supabaseAdmin
        .from("gmail_tokens")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!tok?.user_id) {
        return NextResponse.json({
          ok: true,
          provider,
          fetched: 0,
          inserted: 0,
          cursor_updated: false,
          duration_ms: Date.now() - startedAt,
        });
      }
    } else {
      const { data: tok } = await supabaseAdmin
        .from("microsoft_tokens")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!tok?.user_id) {
        return NextResponse.json({
          ok: true,
          provider,
          fetched: 0,
          inserted: 0,
          cursor_updated: false,
          duration_ms: Date.now() - startedAt,
        });
      }
    }

    const result = await syncInboxForUser(userId, provider, maxMessages, 7);
    const duration_ms = Date.now() - startedAt;

    // Après une sync réussie, tenter de rafraîchir emails_cache pour l'analyse/statistiques.
    if (result.ok && result.inserted > 0) {
      await refreshEmailsCache(userId);
    }

    return NextResponse.json({
      ok: result.ok,
      provider: result.provider,
      fetched: result.fetched,
      inserted: result.inserted,
      cursor_updated: result.cursor_updated,
      duration_ms,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (e: any) {
    const duration_ms = Date.now() - startedAt;
    return NextResponse.json(
      {
        ok: false,
        provider,
        fetched: 0,
        inserted: 0,
        cursor_updated: false,
        duration_ms,
        error: e?.message ?? "SYNC_FAILED",
      },
      { status: 500 }
    );
  }
}

async function refreshEmailsCache(userId: string): Promise<void> {
  try {
    const { data: emails, error } = await supabaseAdmin
      .from("emails")
      .select(
        "id, user_id, provider, provider_message_id, gmail_message_id, sender, subject, summary, received_at"
      )
      .eq("user_id", userId)
      .order("received_at", { ascending: false })
      .limit(200);

    if (error || !emails?.length) {
      if (error) {
        console.warn("[EMAILS sync] refreshEmailsCache list error", {
          userId,
          error: error.message,
        });
      }
      return;
    }

    // Essayer un insert simple; si la table n'existe pas, ne pas faire planter la route.
    for (const row of emails as {
      id: string;
      user_id: string;
      provider: string | null;
      provider_message_id: string | null;
      gmail_message_id: string | null;
      sender: string | null;
      subject: string | null;
      summary: string | null;
      received_at: string | null;
    }[]) {
      const sender = (row.sender ?? "").trim();
      let from_name: string | null = null;
      let from_email: string | null = null;

      if (sender) {
        const at = sender.indexOf("<");
        if (at > 0) {
          from_name = sender.slice(0, at).replace(/^"\s*|\s*"$/g, "").trim() || null;
          const close = sender.indexOf(">", at);
          if (close > at) {
            from_email = sender.slice(at + 1, close).trim() || null;
          }
        } else {
          from_name = sender;
        }
      }

      // On utilise gmail_message_id pour Gmail, provider_message_id pour Outlook.
      const isMicrosoft = row.provider === "microsoft";
      const gmailId = !isMicrosoft ? row.gmail_message_id : null;
      const outlookId = isMicrosoft ? row.provider_message_id : null;

      try {
        const cachePayload = {
          user_id: row.user_id,
          gmail_message_id: gmailId ?? null,
          outlook_message_id: outlookId ?? null,
          subject: row.subject ?? null,
          from_name,
          from_email,
          snippet: row.summary ?? null,
          received_at: row.received_at ?? null,
        };

        const { error: insertError } = await supabaseAdmin
          .from("emails_cache")
          .insert(cachePayload)
          .select()
          .single();

        if (insertError) {
          // Ignore duplicate key errors
          if (!insertError.message?.includes("duplicate")) {
            console.error("[EMAILS sync] refreshEmailsCache INSERT ERROR", insertError);
          }
        } else {
          console.log("[EMAILS sync] inserted into cache", row.id);
        }
      } catch (e: any) {
        // Cas où la table emails_cache n'existe pas ou autre erreur structurelle
        console.warn("[EMAILS sync] refreshEmailsCache fatal", {
          userId,
          email_id: row.id,
          error: e?.message ?? String(e),
        });
        return;
      }
    }
  } catch (e: any) {
    console.warn("[EMAILS sync] refreshEmailsCache outer error", {
      userId,
      error: e?.message ?? String(e),
    });
  }
}

