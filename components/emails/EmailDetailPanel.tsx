"use client";

import { useEffect, useState } from "react";
import {
  getOptimalSlotForEmail,
  getSuggestedSlotsForEmail,
} from "@/components/calendar/getOptimalSlotForEmail";
import { supabase } from "@/lib/supabaseClient";
import type { CalendarEvent } from "@/components/calendar/calendarUtils";

/* ===================== HELPERS ===================== */

function getEmailPreview(body?: string | null) {
  if (!body) return null;

  const cleaned = body
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) return null;

  const MAX_LENGTH = 400;
  return cleaned.length > MAX_LENGTH
    ? cleaned.slice(0, MAX_LENGTH) + "…"
    : cleaned;
}

const fallbackDecision = (email: any): "traiter" | "ignorer" | "planifier" | null => {
  if (!email) return null;

  const subject = email.subject?.toLowerCase() || "";
  const sender = email.sender?.toLowerCase() || "";

  if (subject.includes("urgent") || subject.includes("demain") || subject.includes("asap")) {
    return "traiter";
  }

  if (subject.includes("réunion") || subject.includes("rdv")) {
    return "traiter";
  }

  if (
    sender.includes("newsletter") ||
    sender.includes("linkedin") ||
    sender.includes("no-reply")
  ) {
    return "ignorer";
  }

  return null;
};

const fallbackAction = (email: any) => {
  const decision = fallbackDecision(email);
  if (decision === "traiter") return "reply";
  if (decision === "planifier") return "schedule";
  if (decision === "ignorer") return "archive";
  return null;
};

const fallbackTime = (email: any) => {
  const decision = email.decision ?? fallbackDecision(email);

  if (decision === "ignorer") return 0.5;       // 30 secondes
  if (decision === "planifier") return 2;       // décision + action
  if (decision === "traiter") return 5;         // réponse classique

  return 2; // fallback ultra safe
};


function labelDecision(decision?: "ignorer" | "traiter" | "planifier" | null) {
  if (decision === "traiter") return "À traiter";
  if (decision === "planifier") return "À planifier";
  if (decision === "ignorer") return "À ignorer";
  return "Non analysé";
}

function colorDecision(decision?: "ignorer" | "traiter" | "planifier" | null) {
  if (decision === "traiter") return "bg-red-600 text-white";
  if (decision === "planifier") return "bg-yellow-500 text-black";
  if (decision === "ignorer") return "bg-gray-700 text-white";
  return "bg-gray-700 text-white";
}

function labelAction(action?: "reply" | "schedule" | "archive" | null) {
  if (action === "reply") return "Répondre";
  if (action === "schedule") return "Planifier";
  if (action === "archive") return "Archiver";
  return "—";
}
function getGmailUrl(gmailMessageId?: string | null) {
  if (!gmailMessageId) return null;
  return `https://mail.google.com/mail/u/0/#inbox/${gmailMessageId}`;
}

/* ===================== TYPES ===================== */

type Email = {
  classification_reason?: string | null
  id: string;
  gmail_message_id?: string | null;

  sender: string | null;
  subject: string | null;
  received_at: string | null;

  body?: string | null;

  summary?: string | null;
  decision?: "ignorer" | "traiter" | "planifier" | null;
  estimated_time?: number | null;
  recommended_action?: "reply" | "schedule" | "archive" | null;
};

/* ===================== COMPONENT ===================== */

export function EmailDetailPanel({ email }: { email: Email | null }) {
  const [manualPickerOpen, setManualPickerOpen] = useState(false);
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");

  const [busy, setBusy] = useState<null | "archive" | "task" | "plan">(null);
  const [toast, setToast] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);
const [replyOpen, setReplyOpen] = useState(false);
const [replyLoading, setReplyLoading] = useState(false);
  const [optimalSlot, setOptimalSlot] = useState<null | {

    start: Date;
    end: Date;
    minutes: number;
  }>(null);
  const [suggestedSlots, setSuggestedSlots] = useState<
  { start: Date; end: Date; minutes: number }[]
>([]);

useEffect(() => {
  setShowFullContent(false);
  setBody(email?.body ?? null);
  setAiReply((email as any)?.ai_reply ?? null);
  setReplyOpen(false);
}, [email?.id]);


  /* 🔥 FETCH BODY À LA DEMANDE */
  useEffect(() => {
    if (!email) return;
    if (email.body) return;
    if (!email.gmail_message_id) return;

    const fetchBody = async () => {
      try {
        const res = await fetch("/api/gmail/fetch-body", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emailId: email.id,
            gmailMessageId: email.gmail_message_id,
          }),
        });

        const json = await res.json();

        if (json?.body) {
          setBody(json.body);
        }
        
      } catch (err) {
        console.error("FETCH BODY ERROR", err);
      }
    };

    fetchBody();
  }, [email]);
  useEffect(() => {
    const run = async () => {
      if (!email) return;
  
      const decision = email.decision ?? fallbackDecision(email);
      if (decision !== "planifier") {
        setOptimalSlot(null);
        return;
      }
  
      const {
        data: { user },
      } = await supabase.auth.getUser();
  
      if (!user) return;
  
      const day = new Date();
      day.setHours(0, 0, 0, 0);
  
      const dayStart = new Date(day);
      dayStart.setHours(8, 0, 0, 0);
  
      const dayEnd = new Date(day);
      dayEnd.setHours(18, 0, 0, 0);
  
      const { data, error } = await supabase
  .from("calendar_events")
  .select("id, title, description, start_time, end_time, calendar_name")
  .eq("user_id", user.id)
  .lt("start_time", dayEnd.toISOString())
  .gt("end_time", dayStart.toISOString())
  .order("start_time", { ascending: true });

console.log("CALENDAR EVENTS FETCHED (today):", data);

if (error) {
  console.error("FETCH CALENDAR_EVENTS ERROR", error);
  setOptimalSlot(null);
  return;
}

  
      const minMinutes = Math.max(10, email.estimated_time ?? fallbackTime(email));
      let slot = getOptimalSlotForEmail(data, day, minMinutes);

if (!slot) {
  const tomorrow = new Date(day);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Option 1 (simple) : on réutilise les mêmes events (mais ça ne couvre pas demain)
  // Donc on refetch les events de demain (mieux)
  const tStart = new Date(tomorrow);
  tStart.setHours(8, 0, 0, 0);
  const tEnd = new Date(tomorrow);
  tEnd.setHours(18, 0, 0, 0);

  const { data: dataTomorrow, error: errorTomorrow } = await supabase
  .from("calendar_events")
  .select("id, title, description, start_time, end_time, calendar_name")
  .eq("user_id", user.id)
  .lt("start_time", tEnd.toISOString())
  .gt("end_time", tStart.toISOString())
  .order("start_time", { ascending: true });


  if (!errorTomorrow) {
    slot = getOptimalSlotForEmail(
      dataTomorrow,
      tomorrow,
      minMinutes,
      { now: tStart }
    );      
}
}
setOptimalSlot(slot);

const suggestions = getSuggestedSlotsForEmail(
  data,
  day,
  minMinutes,
  { daysAhead: 3 }
);

setSuggestedSlots(suggestions);


    };
  
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email?.id, email?.decision, email?.estimated_time]);
  const logTimeEvent = async (action: string, minutes: number) => {
    if (!email?.id) return;
  
    try {
      await fetch("/api/time-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: email.id,
          action,
          minutes,
        }),
      });
    } catch (e) {
      console.error("LOG_TIME_EVENT_ERROR", e);
    }
  };
  
  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };
  const sendSuggestion = async (
    type: "sender" | "keyword",
    value: string | null,
    action: "important" | "ignore" | "ai"
  ) => {
    if (!value) return;
  
    await fetch("/api/settings/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        value,
        action,
      }),
    });
  
    notify("Préférence enregistrée ✅");
  };
  
  const createTask = async (mode: "task" | "plan") => {
    if (!email) return;

    setBusy(mode);
  // 🔥 Création de l'événement Google Calendar
  if (mode === "plan" && optimalSlot) {
    const start = optimalSlot.start;
    const end = new Date(
      start.getTime() +
        (email.estimated_time ?? fallbackTime(email)) * 60000
    );
  
    const res = await fetch("/api/calendar/create-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Répondre : ${email.subject || "Email"}`,
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    });
  
    setBusy(null);
  
    if (!res.ok) {
      notify("Erreur lors de la création de l'événement Google Calendar.");
      return;
    }
  
    notify("Créneau bloqué dans Google Calendar ✅");
    return; // ⬅️ ⬅️ ⬅️ CRUCIAL
  }
  

    const title =
      mode === "plan"
        ? `Planifier une réponse : ${email.subject || "(Sans objet)"}`
        : `Traiter : ${email.subject || "(Sans objet)"}`;

    let dueAt: string | null = null;
    if (mode === "plan") {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      dueAt = d.toISOString();
    }

    const res = await fetch("/api/tasks/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Répondre : ${email.subject || "Email"}`,
        emailId: email.id,
        dueAt,
      }),
    });
    
  
    setBusy(null);

    if (!res.ok) {
      notify("Erreur lors de la création de la tâche.");
      return;
    }

    notify(mode === "plan" ? "Réponse planifiée (tâche créée)." : "Tâche créée.");
  };

  const archive = async () => {
    if (!email?.gmail_message_id) {
      notify("Impossible d’archiver : gmail_message_id manquant.");
      return;
    }

    setBusy("archive");

    const res = await fetch("/api/gmail/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gmailMessageId: email.gmail_message_id,
        emailId: email.id,
      }),
    });

    setBusy(null);

    if (!res.ok) {
      notify("Erreur lors de l’archivage Gmail.");
      return;
    }

    notify("Email archivé ✅");
  };

  if (!email) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        Sélectionne un email pour voir le détail
      </div>
    );
  }
  const generateReply = async () => {
    if (!email || replyLoading) return;
  
    setReplyLoading(true);
  
    try {
      const res = await fetch("/api/ai/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: email.id }),
      });
  
      const json = await res.json();
  
      if (json?.reply) {
        setAiReply(json.reply);
        setReplyOpen(true);
      }
      await fetch("/api/time/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ai_reply_generated",
          emailId: email.id,
        }),
      });
      
    } catch (e) {
      console.error("GENERATE_REPLY_UI_ERROR", e);
    } finally {
      setReplyLoading(false);
    }
  };
  
  const decision = email.decision ?? fallbackDecision(email);
  const action = email.recommended_action ?? fallbackAction(email);
  const minutes = email.estimated_time ?? fallbackTime(email);
  const preview = getEmailPreview(email.body);
  const gmailUrl = getGmailUrl(email.gmail_message_id);


  return (
    <div className="space-y-5">
      {toast && (
        <div className="p-3 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-200">
          {toast}
        </div>
      )}

      {/* Résumé IA */}
      <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
        <div className="text-xs text-gray-400 mb-1">Résumé IA</div>
        <p className="text-sm text-gray-200 leading-relaxed">
          {email.summary && email.summary.trim().length > 0
            ? email.summary
            : decision
            ? `Cet email a été analysé par FixTime et classé comme ${
                decision === "traiter"
                  ? "nécessitant une action"
                  : decision === "planifier"
                  ? "à planifier ultérieurement"
                  : "non prioritaire"
              }.`
            : "FixTime analyse actuellement cet email afin de déterminer l’action la plus pertinente."}
        </p>
      </div>
{/* Réponse IA (accordion) */}
<div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
  <button
    onClick={() => {
      if (!aiReply) {
        generateReply();
      } else {
        setReplyOpen((v) => !v);
      }
    }}
    className="flex items-center justify-between w-full text-left"
  >
    <span className="text-sm font-medium text-gray-200">
      ✉️ Réponse générée par l’IA
    </span>
    <span className="text-xs text-gray-400">
      {replyLoading
        ? "Génération…"
        : replyOpen
        ? "Masquer"
        : aiReply
        ? "Afficher"
        : "Générer"}
    </span>
  </button>

  {replyOpen && aiReply && (
    <div className="mt-3 space-y-3">
      {/* Contenu réponse */}
      <div className="text-sm text-gray-200 whitespace-pre-line bg-gray-800 rounded-md p-3">
        {aiReply}
      </div>

      {/* Actions réponse IA */}
      <div className="flex gap-2">
        <button
          onClick={async () => {
            navigator.clipboard.writeText(aiReply);
            notify("Réponse copiée 📋");
            await logTimeEvent("copy_reply", 1);
          }}          
          className="px-3 py-1 rounded-md bg-gray-700 text-xs hover:bg-gray-600"
        >
          Copier la réponse
        </button>

        <button
onClick={async () => {
  if (!email || !aiReply) return;

    const to = encodeURIComponent(email.sender ?? "");
    const subject = encodeURIComponent(`Re: ${email.subject ?? ""}`);
    const body = encodeURIComponent(aiReply);

    const url =
      `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;

    window.open(url, "_blank");
    await logTimeEvent("open_draft", 2);

  }}
  className="px-3 py-1 rounded-md bg-green-600 text-xs hover:bg-green-500 text-black font-medium"
>
  ✉️ Ouvrir le brouillon Gmail
</button>

      </div>
    </div>
  )}
</div>

      {/* Pourquoi */}
      <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
  <div className="text-xs text-gray-400 mb-1">
    Pourquoi cet email est classé ainsi ?
  </div>

  <p className="text-sm text-gray-300">
  {email.classification_reason
    ? email.classification_reason
    : email.decision === "traiter"
    ? "Cet email nécessite une action car son contenu appelle une réponse ou une décision."
    : email.decision === "planifier"
    ? "Cet email a été identifié comme nécessitant une action ultérieure, non urgente."
    : email.decision === "ignorer"
    ? "Cet email n’apporte pas de valeur immédiate et peut être ignoré."
    : "Analyse en attente — lance “Analyser maintenant” si nécessaire."}
</p>


</div>


      {/* Ligne exécutive */}
<div className="flex flex-col gap-2 text-sm">
  <div className="flex flex-wrap items-center gap-3">
    <span className={`px-3 py-1 rounded-full text-xs ${colorDecision(decision)}`}>
      {labelDecision(decision)}
    </span>

    <span className="text-blue-400 font-medium">
      👉 Action recommandée : {labelAction(action)}
    </span>

    <span className="text-gray-400">⏱️ {minutes} min</span>
  </div>
  
  {optimalSlot && (
  <div className="text-sm text-green-400 font-medium">
    🟢 Créneau optimal détecté —{" "}
    {optimalSlot.start.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })}{" "}
    :{" "}
    {optimalSlot.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{" "}
    →{" "}
    {optimalSlot.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
  </div>
)}
{suggestedSlots.length > 1 && (
  <div className="mt-3 space-y-2">
    <div className="text-xs text-gray-400">
      Autres créneaux suggérés
    </div>

    <div className="flex flex-col gap-2">
      {suggestedSlots.map((slot, idx) => {
        const dayLabel = slot.start.toLocaleDateString("fr-FR", {
          weekday: "short",
          day: "numeric",
          month: "short",
        });

        return (
          <button
            key={idx}
            onClick={() => setOptimalSlot(slot)}
            className="text-left px-3 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-sm"
          >
            🕒 {dayLabel} —{" "}
            {slot.start.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            →{" "}
            {slot.end.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </button>
        );
      })}
    </div>

    <button
  onClick={() => setManualPickerOpen(true)}
  className="mt-2 text-sm text-blue-400 hover:underline"
>
  Choisir manuellement un créneau
</button>

  </div>
)}
</div>

      {/* Sujet */}
      <div>
        <h2 className="text-xl font-bold mb-1">{email.subject || "(Sans objet)"}</h2>
        <div className="text-sm text-gray-400">
          De : {email.sender || "Expéditeur inconnu"}
        </div>
        <div className="text-xs text-gray-500">
          {email.received_at ? new Date(email.received_at).toLocaleString() : ""}
        </div>
      </div>
      
      {body && (
  <div className="mt-2 space-y-1">
    <p
      className={`text-sm text-gray-500 ${
        showFullContent ? "" : "line-clamp-2"
      }`}
    >
      {body.replace(/<[^>]*>/g, "")}
    </p>

    <button
  onClick={() => setShowFullContent((v) => !v)}
  className="text-xs text-blue-400 hover:underline"
>
  {showFullContent ? "Réduire le contenu" : "Voir le contenu complet"}
</button>

<p className="text-[11px] text-gray-600 italic">
  Aperçu texte simplifié — images, mise en forme et pièces jointes
  visibles dans Gmail.
</p>
  </div>
)}

      {/* Actions */}
     {/* Actions */}
<div className="flex flex-wrap gap-2 pt-2">
{gmailUrl && (
  <a
    href={gmailUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="px-3 py-2 rounded-md bg-blue-600 text-sm hover:bg-blue-500 text-black font-medium"
  >
    📩 Ouvrir l’email dans Gmail
  </a>
)}





  <button
    onClick={() => createTask("task")}
    disabled={busy !== null}
    className="px-3 py-2 rounded-md bg-gray-800 text-sm hover:bg-gray-700 disabled:opacity-50"
  >
    {busy === "task" ? "Création..." : "Créer une tâche"}
  </button>

  <button
    onClick={() => createTask("plan")}
    disabled={busy !== null}
    className="px-3 py-2 rounded-md bg-gray-800 text-sm hover:bg-gray-700 disabled:opacity-50"
  >
    {busy === "plan" ? "Planification..." : "Planifier une réponse"}
  </button>

  <button
    onClick={archive}
    disabled={busy !== null}
    className="px-3 py-2 rounded-md bg-gray-800 text-sm hover:bg-gray-700 disabled:opacity-50"
  >
    {busy === "archive" ? "Archivage..." : "Archiver"}
  </button>
</div>


      <div className="text-xs text-gray-500">
        Astuce : “Planifier une réponse” crée une tâche avec une échéance.
      </div>
      {manualPickerOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-sm space-y-4">
      <h3 className="text-lg font-semibold text-white">
        Choisir un créneau
      </h3>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Date</label>
        <input
          type="date"
          value={manualDate}
          onChange={(e) => setManualDate(e.target.value)}
          className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">Heure</label>
        <input
          type="time"
          value={manualTime}
          onChange={(e) => setManualTime(e.target.value)}
          className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <button
          onClick={() => setManualPickerOpen(false)}
          className="px-3 py-2 text-sm rounded-md bg-gray-800 hover:bg-gray-700"
        >
          Annuler
        </button>

        <button
          onClick={async () => {
            if (!manualDate || !manualTime || !email) return;

            const start = new Date(`${manualDate}T${manualTime}`);
            const minutes = email.estimated_time ?? fallbackTime(email);
            const end = new Date(start.getTime() + minutes * 60000);

            setOptimalSlot({ start, end, minutes });
            setManualPickerOpen(false);
            await createTask("plan");
          }}
          className="px-3 py-2 text-sm rounded-md bg-green-600 hover:bg-green-500 text-black font-medium"
        >
          Valider
        </button>
      </div>
    </div>
  </div>
)}
 </div>
  );
}