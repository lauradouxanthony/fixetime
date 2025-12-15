import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";

function formatHoursSaved(emailsCount: number) {
  const minutes = emailsCount * 2;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) return `${remainingMinutes} min`;
  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h${remainingMinutes.toString().padStart(2, "0")}`;
}

export default async function HomePage() {

  // ⭐⭐ LA SEULE LIGNE CHANGÉE
  const supabase = await supabaseServer(); 

  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/auth/login");

  const userId = data.user.id;
  const email = data.user.email ?? "dirigeant";

  const { data: tokenRow } = await supabase
    .from("gmail_tokens")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!tokenRow) redirect("/onboarding");

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const { count: emailsTodayCount } = await supabase
    .from("emails")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("received_at", startOfDay)
    .lte("received_at", endOfDay);

  const { count: urgentEmailsCount } = await supabase
    .from("emails")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_urgent", true)
    .gte("received_at", startOfDay)
    .lte("received_at", endOfDay);

  const { count: meetingsCount } = await supabase
    .from("calendar_events")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("start_time", startOfDay)
    .lte("start_time", endOfDay);

  const { data: importantEmails } = await supabase
    .from("emails")
    .select("id, sender, subject, summary, received_at")
    .eq("user_id", userId)
    .order("received_at", { ascending: false })
    .limit(3);

  const { data: todayEvents } = await supabase
    .from("calendar_events")
    .select("id, title, start_time, end_time, calendar_name, is_conflict")
    .eq("user_id", userId)
    .gte("start_time", startOfDay)
    .lte("start_time", endOfDay)
    .order("start_time", { ascending: true });

  const emailsToday = emailsTodayCount ?? 0;
  const urgentEmails = urgentEmailsCount ?? 0;
  const meetingsToday = meetingsCount ?? 0;
  const hoursSaved = formatHoursSaved(emailsToday);

  return (
    <AppShell>
      {/* 🔥 EXACTEMENT TA PAGE — JE N’AI RIEN TOUCHÉ */}
      {/** --------------------------------------------------- */}
      <div className="space-y-6">
        <section className="flex flex-col gap-2">
          <p className="text-sm text-slate-400">
            Bonjour, <span className="font-semibold text-slate-50">{email}</span>
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Voici votre journée optimisée.
          </h2>
          <p className="text-xs text-slate-500">
            Mise à jour basée sur vos emails et votre calendrier synchronisés.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
            <p className="text-xs text-slate-400">Emails reçus aujourd&apos;hui</p>
            <p className="mt-2 text-3xl font-semibold">{emailsToday}</p>
            <p className="mt-1 text-xs text-slate-500">
              analysés automatiquement par l&apos;assistant
            </p>
          </div>
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3">
            <p className="text-xs text-rose-200/80">Emails urgents</p>
            <p className="mt-2 text-3xl font-semibold text-rose-100">
              {urgentEmails}
            </p>
            <p className="mt-1 text-xs text-rose-200/70">
              nécessitent votre attention rapide
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3">
            <p className="text-xs text-emerald-200/80">Heures gagnées</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-100">
              {hoursSaved}
            </p>
            <p className="mt-1 text-xs text-emerald-200/70">
              estimation basée sur 2 min économisées par email trié
            </p>
          </div>
          <div className="rounded-2xl border border-amber-500/40 bg-amber-950/40 px-4 py-3">
            <p className="text-xs text-amber-200/80">Réunions aujourd&apos;hui</p>
            <p className="mt-2 text-3xl font-semibold text-amber-100">
              {meetingsToday}
            </p>
            <p className="mt-1 text-xs text-amber-200/70">
              tous calendriers confondus
            </p>
          </div>
        </section>

        {/* Le reste de ta page identique */}
        {/* … */}
      </div>
    </AppShell>
  );
}
