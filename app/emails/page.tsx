"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import { EmailsHeader } from "@/components/emails/EmailsHeader";
import { EmailsList } from "@/components/emails/EmailsList";
import { EmailDetailPanel } from "@/components/emails/EmailDetailPanel";
import { TodayTasks } from "@/components/tasks/TodayTasks";
import { ExecutiveSummary } from "@/components/emails/ExecutiveSummary";
import { NextBestAction } from "@/components/emails/NextBestAction";

type Email = {
  id: string;
  gmail_message_id?: string | null;
  sender: string | null;
  subject: string | null;
  body: string | null;
  received_at: string | null;

  summary?: string | null;
  estimated_time?: number | null;
  recommended_action?: string | null;
  decision?: string | null;

  category?: string | null;
  is_archived?: boolean | null;
};

type Period = "today" | "7d" | "30d";
// 🔒 Fondation logique FixTime
// Toute décision non explicite = silence
function normalizeDecision(decision?: string | null) {
  if (!decision) return null;

  const d = decision.toLowerCase();

  if (d === "traiter") return "traiter";
  if (d === "planifier") return "planifier";
  if (d === "ignorer") return "ignorer";

  return null; // silence premium
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

  const [stats, setStats] = useState<{ emailsAnalyzed: number; timeSaved: number }>({
    emailsAnalyzed: 0,
    timeSaved: 0,
  });

  const fetchEmails = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/auth/login";
      return;
    }

    const now = new Date();
    let fromDate: Date | null = null;

    if (period === "today") {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
    }

    if (period === "7d") {
      fromDate = new Date();
      fromDate.setDate(now.getDate() - 7);
    }

    if (period === "30d") {
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

    if (filter === "urgent") {
      // urgent = actionnable + urgent (logique dirigeant)
      query = query.eq("decision", "traiter").eq("is_urgent", true);
    }
    
    if (filter === "important") {
      // important = utile (traiter ou planifier) + important
      query = query.in("decision", ["traiter", "planifier"]).eq("is_important", true);
    }
    
    if (filter === "traiter") {
      query = query.eq("decision", "traiter");
    }
    
    if (filter === "planifier") {
      query = query.eq("decision", "planifier");
    }
    
    const { data, error } = await query;

    if (error) {
      console.error("FETCH EMAILS ERROR", error);
    }

    if (data) {
      const normalized = data.map((email) => ({
        ...email,
        decision: normalizeDecision(email.decision),
      }));
    
      setEmails(normalized);
      setSelectedEmail(null);    

      const analyzed = data.filter((e) => e.decision || e.recommended_action || e.estimated_time);
      const totalTime = analyzed.reduce((sum, e) => sum + (e.estimated_time ?? 0), 0);

      setStats({
        emailsAnalyzed: analyzed.length,
        timeSaved: totalTime,
      });
    }

    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    fetchEmails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, period]);

  // ⚠️ NE PAS TOUCHER : tu as dit que c’était sensible, donc on garde strictement ton flux actuel.
  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      console.log("🔄 REFRESH CLICKED");
  
      const res = await fetch("/api/emails/analyze-now", {
        method: "POST",
      });
  
      const json = await res.json();
      console.log("📩 SYNC RESPONSE", json);
  
      // ❗ UNE SEULE FOIS
      await fetchEmails();
    } catch (e) {
      console.error("❌ REFRESH ERROR", e);
    } finally {
      setRefreshing(false);
    }
  };
  
  

  const actionableCount = useMemo(() => {
    return emails.filter((e) => {
      const d = normalizeDecision(e.decision);
      return d === "traiter" || d === "planifier";
    }).length;
  }, [emails]);
  
  return (
    <div className="h-full flex flex-col p-6 gap-4">
      {/* 🎯 PROMESSE (simple + B2B) */}
      <div className="text-sm text-gray-400">
        FixTime vous montre{" "}
        <span className="text-white font-medium">quels emails traiter, planifier ou ignorer</span>{" "}
        — sans tous les ouvrir.
      </div>

      <div className="sticky top-0 z-20 bg-gradient-to-b from-black/95 to-black/80 backdrop-blur border-b border-gray-800 pb-4">
  <NextBestAction emails={emails} />
</div>


      {/* HEADER EMAILS (le produit d’abord) */}
      <EmailsHeader
        activeFilter={filter}
        onChangeFilter={setFilter}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        period={period}
        onChangePeriod={setPeriod}
      />

      {/* CONTENU (Inbox + détail) */}
      <div className="flex flex-1 border border-gray-800 rounded-xl overflow-hidden">
        <div className="w-1/3 border-r border-gray-800 overflow-y-auto">
          <EmailsList
            emails={emails}
            selectedEmailId={selectedEmail?.id || null}
            onSelect={(email) => setSelectedEmail(email)}
            loading={loading}
          />
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          <EmailDetailPanel email={selectedEmail} />
        </div>
      </div>

      {/* 📊 STATS (crédibles, basées sur tes données) */}
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

        <div className="px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-300">
          💡 Ces chiffres sont basés sur les emails analysés sur la période sélectionnée.
        </div>
      </div>

      {/* GUIDE (si pas encore d’analyse visible) */}
      {stats.emailsAnalyzed === 0 && (
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-300">
          👉 Cliquez sur{" "}
          <span className="font-semibold text-green-400">“Analyser maintenant”</span> pour générer
          décisions + résumés.
        </div>
      )}

      {/* 🧠 TÂCHES (secondaire, après le cœur produit) */}
      <div className="pt-2">
        <TodayTasks />
      </div>
    </div>
  );
}
