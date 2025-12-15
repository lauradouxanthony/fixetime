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
  const supabase = supabaseServer();
  const { data } = await supabase.auth.getUser();

  // 1) Si pas connecté → login
  if (!data.user) redirect("/auth/login");

  const userId = data.user.id;
  const email = data.user.email ?? "dirigeant";

  // ⭐⭐ 2) Vérifier si Google est connecté
  const { data: tokenRow } = await supabase
    .from("gmail_tokens")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!tokenRow) {
    // 👉 Redirection PRO vers l'onboarding
    redirect("/onboarding");
  }

  // 3) Définition début/fin de journée
  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0
  ).toISOString();
  const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59
  ).toISOString();

  // 4) Emails du jour
  const { count: emailsTodayCount } = await supabase
    .from("emails")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("received_at", startOfDay)
    .lte("received_at", endOfDay);

  // 5) Emails urgents
  const { count: urgentEmailsCount } = await supabase
    .from("emails")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_urgent", true)
    .gte("received_at", startOfDay)
    .lte("received_at", endOfDay);

  // 6) Réunions du jour
  const { count: meetingsCount } = await supabase
    .from("calendar_events")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("start_time", startOfDay)
    .lte("start_time", endOfDay);

  // 7) Emails importants
  const { data: importantEmails } = await supabase
    .from("emails")
    .select("id, sender, subject, summary, received_at")
    .eq("user_id", userId)
    .order("received_at", { ascending: false })
    .limit(3);

  // 8) Planning du jour
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

  // 👉 TA PAGE HOME PREMIUM (inchangée)
  return (
    <AppShell>
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

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Vos emails importants</h3>
              <a
                href="/emails"
                className="text-xs text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
              >
                Voir tous les emails
              </a>
            </div>

            <div className="space-y-3">
              {importantEmails && importantEmails.length > 0 ? (
                importantEmails.map((mail) => (
                  <div
                    key={mail.id}
                    className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {mail.sender || "Expéditeur inconnu"}
                    </p>
                    <p className="text-sm font-medium mt-1">
                      {mail.subject || "Sans objet"}
                    </p>
                    {mail.summary && (
                      <p className="text-xs text-slate-400 mt-1">{mail.summary}</p>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">
                  Aucun email récent trouvé pour aujourd&apos;hui.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Planning du jour</h3>
              <a
                href="/calendar"
                className="text-xs text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
              >
                Ouvrir le calendrier
              </a>
            </div>

            <div className="space-y-2 text-xs">
              {todayEvents && todayEvents.length > 0 ? (
                todayEvents.map((ev) => {
                  const start = ev.start_time ? new Date(ev.start_time) : null;
                  const end = ev.end_time ? new Date(ev.end_time) : null;

                  const timeLabel =
                    start && end
                      ? `${start.toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })} – ${end.toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "Heure non définie";

                  return (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/80 px-3 py-2"
                    >
                      <div>
                        <p className="font-medium">
                          {timeLabel} · {ev.title || "Sans titre"}
                        </p>
                        <p className="text-slate-400">
                          Calendrier : {ev.calendar_name || "Non précisé"}
                        </p>
                      </div>
                      {ev.is_conflict && (
                        <span className="text-[10px] rounded-full bg-rose-500/10 px-2 py-1 text-rose-300">
                          Conflit potentiel
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-500">
                  Aucune réunion prévue aujourd&apos;hui.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
