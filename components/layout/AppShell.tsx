"use client";

import { ReactNode, useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { useToast } from "@/components/ui/Toast";
import GlobalSearch from "./GlobalSearch";

/* ── Realtime watcher pour notifications autopilote ── */
function RealtimeWatcher() {
  const { toast } = useToast();
  const seenReplies = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cleanup: (() => void) | null = null;

    const start = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Indexer les ai_reply existants pour ne pas notifier rétrospectivement
      const { data: existing } = await supabase
        .from("emails")
        .select("id, ai_reply")
        .eq("user_id", user.id)
        .not("ai_reply", "is", null)
        .limit(200);
      (existing || []).forEach(e => { if (e.ai_reply) seenReplies.current.add(e.id); });

      const channel = supabase
        .channel("fixetime-realtime")
        .on(
          "postgres_changes" as any,
          { event: "UPDATE", schema: "public", table: "emails", filter: `user_id=eq.${user.id}` },
          (payload: any) => {
            const email = payload.new as any;
            // Notification quand l'IA autopilote a envoyé une réponse
            if (email.ai_reply && !seenReplies.current.has(email.id)) {
              seenReplies.current.add(email.id);
              const name = (email.sender || "").split("@")[0] || "Prospect";
              const subject = email.subject ? ` · ${String(email.subject).slice(0, 40)}` : "";
              toast(`🤖 IA a répondu à ${name}${subject}`, "info");
            }
          }
        )
        .subscribe();

      cleanup = () => { supabase.removeChannel(channel); };
    };

    start();
    return () => { cleanup?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/* ── Session keep-alive : refresh toutes les 10 minutes ── */
function SessionKeepAlive() {
  useEffect(() => {
    const supabase = supabaseBrowser();
    // Rafraîchir immédiatement au montage
    supabase.auth.getSession().catch(() => {});

    const interval = setInterval(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) {
          // Session expirée → rediriger vers login
          window.location.href = "/auth/login";
        }
      }).catch(() => {});
    }, 10 * 60 * 1000); // toutes les 10 minutes

    return () => clearInterval(interval);
  }, []);
  return null;
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex overflow-hidden" style={{ background: "rgb(250 250 250)" }}>
      <Sidebar />
      <RealtimeWatcher />
      <SessionKeepAlive />
      <GlobalSearch />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
