"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import { EmailsHeader } from "@/components/emails/EmailsHeader";
import { EmailsList } from "@/components/emails/EmailsList";
import { EmailDetailPanel } from "@/components/emails/EmailDetailPanel";
import { TodayTasks } from "@/components/tasks/TodayTasks";
import { ExecutiveSummary } from "@/components/emails/ExecutiveSummary";
import { NextBestAction } from "@/components/emails/NextBestAction";
import type { Email } from "@/types/email";

type Period = "today" | "7d" | "30d";

function normalizeDecision(
  decision?: string | null
): "traiter" | "planifier" | "ignorer" | null {
  if (!decision) return null;
  const d = decision.toLowerCase();
  if (d === "traiter") return "traiter";
  if (d === "planifier") return "planifier";
  if (d === "ignorer") return "ignorer";
  return null;
}

export default function EmailsPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<
    "all" | "urgent" | "important" | "traiter" | "planifier"
  >("all");
  const [period, setPeriod] = useState<Period>("7d");
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [lastSyncText, setLastSyncText] = useState<string>("");

  const [stats, setStats] = useState<{ emailsAnalyzed: number; timeSaved: number }>({
    emailsAnalyzed: 0,
    timeSaved: 0,
  });

  // Refs for stable access inside interval/realtime callbacks
  const filterRef = useRef(filter);
  const periodRef = useRef(period);
  useEffect(() => { filterRef.current = filter; }, [filter]);
  useEffect(() => { periodRef.current = period; }, [period]);

  // ─── Core fetch ──────────────────────────────────────────────────────────────
  const fetchEmails = async (silent = false) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/auth/login";
      return;
    }

    if (!silent) setLoading(true);

    const now = new Date();
    let fromDate: Date | null = null;
    const currentPeriod = silent ? periodRef.current : period;
    const currentFilter = silent ? filterRef.current : filter;

    if (currentPeriod === "today") {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
    } else if (currentPeriod === "7d") {
      fromDate = new Date();
      fromDate.setDate(now.getDate() - 7);
    } else if (currentPeriod === "30d") {
      fromDate = new Date();
      fromDate.setDate(now.getDate() - 30);
    }

    let query = supabase
      .from("emails")
      .select(
        "id, gmail_message_id, sender, subject, body, summary, received_at, estimated_time, recommended_action, decision, category, is_archived, classification_reason, is_urgent, is_important, ai_reply"
      )
      .eq("user_id", user.id)
      .order("received_at", { ascending: false });

    if (fromDate) {
      query = query.gte("received_at", fromDate.toISOString());
    }

    if (currentFilter === "urgent") {
      query = query.eq("decision", "traiter").eq("is_urgent", true);
    } else if (currentFilter === "important") {
      query = query.in("decision", ["traiter", "planifier"]).eq("is_important", true);
    } else if (currentFilter === "traiter") {
      query = query.eq("decision", "traiter");
    } else if (currentFilter === "planifier") {
      query = query.eq("decision", "planifier");
    }

    const { data, error } = await query;

    if (error) {
      console.error("FETCH EMAILS ERROR", error);
    }

    if (data) {
      const normalized: Email[] = data.map((email) => ({
        ...email,
        decision: normalizeDecision(email.decision),
      }));

      setEmails(normalized);
      if (!silent) setSelectedEmail(null);

      const analyzed = data.filter(
        (e) => e.decision || e.recommended_action || e.estimated_time
      );
      const totalTime = analyzed.reduce((sum, e) => sum + (e.estimated_time ?? 0), 0);

      setStats({
        emailsAnalyzed: analyzed.length,
        timeSaved: totalTime,
      });
    }

    if (!silent) setLoading(false);
  };

  // ─── Initial load + filter/period change ─────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetchEmails(false).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, period]);

  // ─── Auto-sync toutes les 60s ─────────────────────────────────────────────────
  useEffect(() => {
    const runAutoSync = async () => {
      try {
        await fetch("/api/emails/analyze-now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger: "auto" }),
        });
        setLastSync(new Date());
        // Laisser ~3s au backend pour écrire les résultats, puis re-fetch silencieux
        setTimeout(() => fetchEmails(true), 3000);
      } catch (e) {
        console.error("AUTO_SYNC_ERROR", e);
      }
    };

    const interval = setInterval(runAutoSync, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── "Dernière sync : il y a Xs" ──────────────────────────────────────────────
  useEffect(() => {
    if (!lastSync) return;

    const tick = () => {
      const secs = Math.floor((Date.now() - lastSync.getTime()) / 1000);
      if (secs < 60) {
        setLastSyncText(`il y a ${secs}s`);
      } else {
        setLastSyncText(`il y a ${Math.floor(secs / 60)}min`);
      }
    };

    tick();
    const t = setInterval(tick, 5_000);
    return () => clearInterval(t);
  }, [lastSync]);

  // ─── Realtime Supabase ────────────────────────────────────────────────────────
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      channel = supabase
        .channel(`emails-realtime-${user.id}`)
        .on(
          "postgres_changes" as any,
          {
            event: "UPDATE",
            schema: "public",
            table: "emails",
            filter: `user_id=eq.${user.id}`,
          },
          (payload: any) => {
            const updated = payload.new;
            setEmails((prev) =>
              prev.map((e) =>
                e.id === updated.id
                  ? {
                      ...e,
                      ...updated,
                      decision: normalizeDecision(updated.decision),
                    }
                  : e
              )
            );
          }
        )
        .on(
          "postgres_changes" as any,
          {
            event: "INSERT",
            schema: "public",
            table: "emails",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            // Nouvel email inséré → re-fetch silencieux pour respecter les filtres actifs
            fetchEmails(true);
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Refresh manuel (bouton) ──────────────────────────────────────────────────
  const handleRefresh = async () => {
    try {
      setRefreshing(true);

      await fetch("/api/emails/analyze-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });

      setLastSync(new Date());
      setTimeout(() => fetchEmails(true), 3000);
    } catch (e) {
      console.error("❌ REFRESH ERROR", e);
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Computed ─────────────────────────────────────────────────────────────────
  const actionableCount = useMemo(() => {
    return emails.filter((e) => {
      const d = normalizeDecision(e.decision);
      return d === "traiter" || d === "planifier";
    }).length;
  }, [emails]);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col p-6 gap-4">
      <div className="text-sm text-gray-400">
        FixTime vous montre{" "}
        <span className="text-white font-medium">quels emails traiter, planifier ou ignorer</span>{" "}
        — sans tous les ouvrir.
      </div>

      <div className="sticky top-0 z-20 bg-gradient-to-b from-black/95 to-black/80 backdrop-blur border-b border-gray-800 pb-4">
        <NextBestAction emails={emails} />
      </div>

      <EmailsHeader
        activeFilter={filter}
        onChangeFilter={setFilter}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        period={period}
        onChangePeriod={setPeriod}
      />

      <div className="flex flex-1 border border-gray-800 rounded-xl overflow-hidden">
        <div className="w-1/3 border-r border-gray-800 overflow-y-auto">
          <EmailsList
            emails={emails}
            selectedEmailId={selectedEmail?.id || null}
            onSelect={(email) => setSelectedEmail(email as Email)}
            loading={loading}
          />
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          <EmailDetailPanel email={selectedEmail} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-sm">
          ✅ <span className="font-semibold">{stats.emailsAnalyzed}</span> emails analysés
        </div>

        <div className="px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-sm">
          ⏱️ <span className="font-semibold">{stats.timeSaved}</span> min estimées
        </div>

        <div className="px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-sm">
          🎯 <span className="font-semibold">{actionableCount}</span> actionnables
        </div>
      </div>

      {stats.emailsAnalyzed === 0 && (
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-300">
          👉 Cliquez sur{" "}
          <span className="font-semibold text-green-400">"Analyser maintenant"</span> pour générer
          décisions + résumés — ou attendez la sync automatique (toutes les 60s).
        </div>
      )}

      <div className="pt-2">
        <TodayTasks />
      </div>

      {/* Dernière sync — discret, en bas */}
      <div className="text-xs text-gray-600 text-right">
        {lastSync
          ? `Dernière sync : ${lastSyncText}`
          : "Sync automatique toutes les 60s"}
      </div>
    </div>
  );
}
