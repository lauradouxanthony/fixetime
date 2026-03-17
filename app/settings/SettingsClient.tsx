"use client";

import { useMemo, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { SetupStatus } from "@/components/setup/SetupStatus";

type PropertyRow = { id?: string; name: string; address: string; rent: number };

export default function SettingsClient() {
  const { settings, loading, updateSettings } = useSettings();
  const [toast, setToast] = useState<string | null>(null);
  const [localProperties, setLocalProperties] = useState<PropertyRow[]>([]);
  const [propertiesDirty, setPropertiesDirty] = useState(false);
  const [faqEditId, setFaqEditId] = useState<string | null>(null);
  const [faqEditQuestion, setFaqEditQuestion] = useState("");
  const [faqEditAnswer, setFaqEditAnswer] = useState("");
  const [faqNewQuestion, setFaqNewQuestion] = useState("");
  const [faqNewAnswer, setFaqNewAnswer] = useState("");

  const cfg = useMemo(() => {
    const c: any = settings?.config ?? {};
    return {
      rental_rules: {
        income_multiplier: c?.rental_rules?.income_multiplier ?? 3,
        accepted_employment_status: Array.isArray(c?.rental_rules?.accepted_employment_status) ? c.rental_rules.accepted_employment_status : ["CDI", "CDD", "Indépendant", "Étudiant", "Retraite", "Autre"],
        required_documents: c?.rental_rules?.required_documents ?? [],
        allow_guarantor: c?.rental_rules?.allow_guarantor ?? true,
        guarantor_required_for_status: Array.isArray(c?.rental_rules?.guarantor_required_for_status) ? c.rental_rules.guarantor_required_for_status : [],
      },
      faq_items: Array.isArray(c?.faq_items) ? c.faq_items : [],
      scheduling_rules: {
        timezone: c?.scheduling_rules?.timezone ?? "Europe/Paris",
        workdays: Array.isArray(c?.scheduling_rules?.workdays) ? c.scheduling_rules.workdays : [1, 2, 3, 4, 5],
        hours: {
          start: c?.scheduling_rules?.hours?.start ?? "09:00",
          end: c?.scheduling_rules?.hours?.end ?? "18:00",
        },
        slot_duration_min: c?.scheduling_rules?.slot_duration_min ?? 30,
        days_ahead: c?.scheduling_rules?.days_ahead ?? 7,
        min_notice_hours: c?.scheduling_rules?.min_notice_hours ?? 24,
        travel_buffer_min: c?.scheduling_rules?.travel_buffer_min ?? 30,
        proposal_count: c?.scheduling_rules?.proposal_count ?? 3,
        spread_mode: c?.scheduling_rules?.spread_mode === "same_day_ok" ? "same_day_ok" : "multi_day",
        exclude_lunch: c?.scheduling_rules?.exclude_lunch ?? true,
        constraints_text: c?.scheduling_rules?.constraints_text ?? "",
      },
      agent_persona: {
        agent_name: c?.agent_persona?.agent_name ?? "Julie de l'Immobilier",
        tone: c?.agent_persona?.tone ?? "friendly",
        signature: c?.agent_persona?.signature ?? "Cordialement,\nService visites",
      },
      properties: Array.isArray(c?.properties) ? c.properties : [],
      snippets: {
        property_info_default: c?.snippets?.property_info_default ?? "Nous vous recontacterons avec les informations détaillées sur ce bien.",
        admin_default: c?.snippets?.admin_default ?? "Votre demande a bien été reçue. L'équipe vous répondra sous 48h.",
        application_status_default: c?.snippets?.application_status_default ?? "Votre dossier est en cours d'instruction. Nous vous tiendrons informé.",
        out_of_scope_default: c?.snippets?.out_of_scope_default ?? "Votre message ne relève pas de notre compétence directe. Merci de contacter le service concerné.",
        missing_docs: c?.snippets?.missing_docs ?? "Merci de nous transmettre les documents suivants pour compléter votre dossier : [liste]. À renvoyer à cette adresse.",
        ineligible_guarantor_option: c?.snippets?.ineligible_guarantor_option ?? "Malheureusement votre situation ne permet pas de retenir ce bien au regard de nos critères (loyer × 3). Vous pouvez présenter un garant solide ou nous contacter pour un bien à loyer plus adapté.",
        followup_reminder: c?.snippets?.followup_reminder ?? "Nous n'avons pas eu de retour de votre part. Souhaitez-vous toujours organiser une visite ? Répondez à ce mail pour confirmer.",
      },
      intent_policies: {
        booking_request: { autopilot_allowed: c?.intent_policies?.booking_request?.autopilot_allowed ?? true, required_fields: c?.intent_policies?.booking_request?.required_fields ?? ["phone", "income", "documents"] },
        property_question: { autopilot_allowed: c?.intent_policies?.property_question?.autopilot_allowed ?? true, required_fields: c?.intent_policies?.property_question?.required_fields ?? [] },
        documents_status: { autopilot_allowed: c?.intent_policies?.documents_status?.autopilot_allowed ?? true, required_fields: c?.intent_policies?.documents_status?.required_fields ?? [] },
        application_status: { autopilot_allowed: c?.intent_policies?.application_status?.autopilot_allowed ?? false, required_fields: c?.intent_policies?.application_status?.required_fields ?? [] },
        reschedule: { autopilot_allowed: c?.intent_policies?.reschedule?.autopilot_allowed ?? true },
        cancel: { autopilot_allowed: c?.intent_policies?.cancel?.autopilot_allowed ?? true },
        admin_question: { autopilot_allowed: c?.intent_policies?.admin_question?.autopilot_allowed ?? false, required_fields: c?.intent_policies?.admin_question?.required_fields ?? [] },
        out_of_scope: { autopilot_allowed: c?.intent_policies?.out_of_scope?.autopilot_allowed ?? false },
      },
      address_policy: (c?.address_policy === "after_qualification" || c?.address_policy === "after_booking" || c?.address_policy === "always") ? c.address_policy : "after_booking",
      followup_policy: {
        enabled: c?.followup_policy?.enabled ?? true,
        d1: c?.followup_policy?.d1 ?? true,
        d3: c?.followup_policy?.d3 ?? true,
      },
      ui: {
        theme: c?.ui?.theme ?? "dark",
        density: c?.ui?.density ?? "comfortable",
      },
      autopilot_guardrails: {
        require_calendar_connected: c?.autopilot_guardrails?.require_calendar_connected ?? true,
        quiet_hours: {
          start: c?.autopilot_guardrails?.quiet_hours?.start ?? "20:00",
          end: c?.autopilot_guardrails?.quiet_hours?.end ?? "08:00",
          timezone: c?.autopilot_guardrails?.quiet_hours?.timezone ?? c?.scheduling_rules?.timezone ?? "Europe/Paris",
        },
        max_autopilot_emails_per_hour: c?.autopilot_guardrails?.max_autopilot_emails_per_hour ?? 30,
        require_property_match_for_location: c?.autopilot_guardrails?.require_property_match_for_location ?? true,
        require_faq_match_for_information: c?.autopilot_guardrails?.require_faq_match_for_information ?? false,
      },
    };
  }, [settings]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const patchConfig = (partial: any) => {
    updateSettings({
      config: { ...(settings?.config ?? {}), ...partial },
    }).then(() => showToast("Enregistré")).catch(() => showToast("Erreur enregistrement"));
  };

  const patchRentalRules = (partial: any) => {
    patchConfig({ rental_rules: { ...cfg.rental_rules, ...partial } });
  };

  const patchSchedulingRules = (partial: any) => {
    patchConfig({ scheduling_rules: { ...cfg.scheduling_rules, ...partial } });
  };

  const patchAutopilotGuardrails = (partial: any) => {
    const next = { ...cfg.autopilot_guardrails } as any;
    if (partial.quiet_hours) next.quiet_hours = { ...next.quiet_hours, ...partial.quiet_hours };
    if (partial.require_calendar_connected !== undefined) next.require_calendar_connected = partial.require_calendar_connected;
    if (partial.max_autopilot_emails_per_hour !== undefined) next.max_autopilot_emails_per_hour = partial.max_autopilot_emails_per_hour;
    if (partial.require_property_match_for_location !== undefined) next.require_property_match_for_location = partial.require_property_match_for_location;
    if (partial.require_faq_match_for_information !== undefined) next.require_faq_match_for_information = partial.require_faq_match_for_information;
    patchConfig({ autopilot_guardrails: next });
  };

  const patchFaqItems = (items: Array<{ id: string; question: string; answer: string; updated_at?: string }>) => {
    patchConfig({ faq_items: items });
    setFaqEditId(null);
    setFaqNewQuestion("");
    setFaqNewAnswer("");
  };

  const addFaqItem = () => {
    if (!faqNewQuestion.trim()) return;
    const id = `faq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const items = [...(cfg.faq_items ?? []), { id, question: faqNewQuestion.trim(), answer: faqNewAnswer.trim(), updated_at: new Date().toISOString() }];
    patchFaqItems(items);
  };

  const startEditFaq = (item: { id: string; question: string; answer: string }) => {
    setFaqEditId(item.id);
    setFaqEditQuestion(item.question);
    setFaqEditAnswer(item.answer);
  };

  const saveEditFaq = (id: string) => {
    const items = (cfg.faq_items ?? []).map((item) =>
      item.id === id ? { ...item, question: faqEditQuestion.trim(), answer: faqEditAnswer.trim(), updated_at: new Date().toISOString() } : item
    );
    patchFaqItems(items);
  };

  const removeFaqItem = (id: string) => {
    patchFaqItems((cfg.faq_items ?? []).filter((item) => item.id !== id));
  };

  const patchAgentPersona = (partial: any) => {
    patchConfig({ agent_persona: { ...cfg.agent_persona, ...partial } });
  };

  const patchSnippets = (partial: Record<string, string>) => {
    patchConfig({ snippets: { ...cfg.snippets, ...partial } });
  };

  const patchIntentPolicy = (intentKey: keyof typeof cfg.intent_policies, partial: { autopilot_allowed?: boolean; required_fields?: string[] }) => {
    patchConfig({
      intent_policies: {
        ...cfg.intent_policies,
        [intentKey]: { ...(cfg.intent_policies[intentKey] as any), ...partial },
      },
    });
  };

  const patchAddressPolicy = (value: "after_qualification" | "after_booking" | "always") => {
    patchConfig({ address_policy: value });
  };

  const patchFollowupPolicy = (partial: { enabled?: boolean; d1?: boolean; d3?: boolean }) => {
    patchConfig({ followup_policy: { ...cfg.followup_policy, ...partial } });
  };

  const propsFromConfig = useMemo(
    () =>
      cfg.properties.map((p: any) => ({
        id: p.id,
        name: p.name ?? "",
        address: p.address ?? "",
        rent: typeof p.rent === "number" ? p.rent : 0,
      })),
    [cfg.properties]
  );

  const propsToEdit = localProperties.length > 0 ? localProperties : propsFromConfig;

  const addProperty = () => {
    setLocalProperties((prev) => {
      const base = prev.length > 0 ? prev : propsFromConfig;
      return [...base, { name: "", address: "", rent: 0 }];
    });
    setPropertiesDirty(true);
  };

  const updateProperty = (idx: number, field: keyof PropertyRow, value: string | number) => {
    setLocalProperties((prev) => {
      const base = prev.length > 0 ? prev : propsFromConfig;
      const list = [...base];
      list[idx] = { ...list[idx], [field]: value };
      return list;
    });
    setPropertiesDirty(true);
  };

  const removeProperty = (idx: number) => {
    setLocalProperties((prev) => {
      const base = prev.length > 0 ? prev : propsFromConfig;
      const list = [...base];
      list.splice(idx, 1);
      return list;
    });
    setPropertiesDirty(true);
  };

  const saveProperties = () => {
    const list = localProperties.length ? localProperties : propsToEdit;
    const payload = list.map((p) => ({ id: p.id, name: p.name, address: p.address, rent: p.rent }));
    patchConfig({ properties: payload });
    setPropertiesDirty(false);
  };

  const docsAsText = (cfg.rental_rules.required_documents ?? []).join("\n");
  const workdayLabels = [
    { n: 1, label: "Lun" },
    { n: 2, label: "Mar" },
    { n: 3, label: "Mer" },
    { n: 4, label: "Jeu" },
    { n: 5, label: "Ven" },
    { n: 6, label: "Sam" },
    { n: 7, label: "Dim" },
  ];

  if (loading || !settings) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-400">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5 p-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-lg font-semibold text-white">Base de connaissances agence</h1>
        <p className="text-xs text-slate-500">Règles locatives, FAQ, calendrier — source de vérité pour l’IA</p>
      </div>

      <SetupStatus />

      {/* Section 1 : Règles locatives (calculateur) */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">1. Règles locatives</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Multiplicateur loyer (× revenus nets)</label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="range"
                min={2}
                max={5}
                step={0.5}
                value={cfg.rental_rules.income_multiplier}
                onChange={(e) => patchRentalRules({ income_multiplier: Number(e.target.value) })}
                className="flex-1 h-2 rounded-lg appearance-none bg-slate-700 accent-blue-600"
              />
              <span className="text-sm font-medium text-white w-8">{cfg.rental_rules.income_multiplier}×</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400">Statuts professionnels acceptés</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {["CDI", "CDD", "Indépendant", "Étudiant", "Retraite", "Autre"].map((status) => {
                const accepted = (cfg.rental_rules.accepted_employment_status ?? []).includes(status);
                return (
                  <label key={status} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={() => {
                        const arr = [...(cfg.rental_rules.accepted_employment_status ?? [])];
                        if (accepted) {
                          const i = arr.indexOf(status);
                          if (i >= 0) arr.splice(i, 1);
                        } else arr.push(status);
                        patchRentalRules({ accepted_employment_status: arr });
                      }}
                      className="rounded border-slate-600 bg-slate-900 text-blue-600"
                    />
                    <span className="text-sm text-slate-300">{status}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={!!cfg.rental_rules.allow_guarantor}
              onClick={() => patchRentalRules({ allow_guarantor: !cfg.rental_rules.allow_guarantor })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${cfg.rental_rules.allow_guarantor ? "bg-blue-600" : "bg-slate-700"}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${cfg.rental_rules.allow_guarantor ? "translate-x-5" : "translate-x-1"}`} />
            </button>
            <span className="text-sm text-slate-300">Garant autorisé</span>
          </div>
          {cfg.rental_rules.allow_guarantor && (
            <div>
              <label className="text-xs text-slate-400">Garant obligatoire pour les statuts</label>
              <p className="text-[11px] text-slate-500 mt-0.5">Si le candidat a l’un de ces statuts, un garant est requis.</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {(cfg.rental_rules.accepted_employment_status ?? []).map((status) => {
                  const required = (cfg.rental_rules.guarantor_required_for_status ?? []).includes(status);
                  return (
                    <label key={status} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={required}
                        onChange={() => {
                          const arr = [...(cfg.rental_rules.guarantor_required_for_status ?? [])];
                          const i = arr.indexOf(status);
                          if (required && i >= 0) arr.splice(i, 1);
                          else if (!required) arr.push(status);
                          patchRentalRules({ guarantor_required_for_status: arr });
                        }}
                        className="rounded border-slate-600 bg-slate-900 text-blue-600"
                      />
                      <span className="text-sm text-slate-300">{status}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label className="text-xs text-slate-400">Documents requis (1 par ligne)</label>
            <textarea
              rows={3}
              value={docsAsText}
              onChange={(e) =>
                patchRentalRules({
                  required_documents: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean),
                })
              }
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              placeholder="Pièce d'identité&#10;3 bulletins de salaire"
            />
          </div>
        </div>
      </section>

      {/* IA */}
      <section className="rounded-xl border border-slate-800 p-4 space-y-3">
        <h2 className="text-sm font-semibold">
          Fonctionnement de l’assistant IA
        </h2>

        {[
          {
            key: "suggestions",
            label: "Analyse uniquement",
            description: "L'IA classe vos emails. Aucun envoi automatique.",
          },
          {
            key: "semi",
            label: "Mode DRAFT",
            description:
              "L'IA génère un brouillon de réponse. Vous approuvez avant d'envoyer.",
          },
          {
            key: "advanced",
            label: "Mode AUTOPILOTE",
            description:
              "L'IA envoie les réponses automatiquement et bloque les créneaux calendrier.",
          },
        ].map((opt) => (
          <label
            key={opt.key}
            className="flex items-start gap-3 rounded-lg border border-slate-700 p-3 cursor-pointer"
          >
            <input
              type="radio"
              className="mt-0.5"
              checked={settings.automation_level === opt.key}
              onChange={() => updateSettings({ automation_level: opt.key as any })}
            />
            <div>
              <span className="text-sm font-medium">{opt.label}</span>
              <p className="text-xs text-slate-400 mt-0.5">{opt.description}</p>
            </div>
          </label>
        ))}
      </section>

      {/* Section 3 : Calendrier (prise de RDV) */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">3. Règles de visites (calendrier)</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Timezone</label>
            <input
              value={cfg.scheduling_rules.timezone}
              onChange={(e) => patchSchedulingRules({ timezone: e.target.value })}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Jours ouvrés</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {workdayLabels.map(({ n, label }) => (
                <label key={n} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfg.scheduling_rules.workdays.includes(n)}
                    onChange={(e) => {
                      const wd = [...cfg.scheduling_rules.workdays];
                      if (e.target.checked) wd.push(n);
                      else wd.splice(wd.indexOf(n), 1);
                      patchSchedulingRules({ workdays: wd.sort() });
                    }}
                    className="rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-300">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">Heure début</label>
              <input
                type="time"
                value={cfg.scheduling_rules.hours.start}
                onChange={(e) =>
                  patchSchedulingRules({ hours: { ...cfg.scheduling_rules.hours, start: e.target.value } })
                }
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Heure fin</label>
              <input
                type="time"
                value={cfg.scheduling_rules.hours.end}
                onChange={(e) =>
                  patchSchedulingRules({ hours: { ...cfg.scheduling_rules.hours, end: e.target.value } })
                }
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">Durée visite (minutes)</label>
              <input
                type="number"
                min={15}
                max={120}
                value={cfg.scheduling_rules.slot_duration_min}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0;
                  const clamped = Math.min(120, Math.max(15, val));
                  patchSchedulingRules({ slot_duration_min: clamped });
                }}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Délai de prévenance (heures)</label>
              <input
                type="number"
                min={0}
                max={168}
                value={cfg.scheduling_rules.min_notice_hours ?? 24}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0;
                  const clamped = Math.min(168, Math.max(0, val));
                  patchSchedulingRules({ min_notice_hours: clamped });
                }}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
                title="Ex. 24 = pas de RDV avant 24h"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">Buffer trajet (minutes)</label>
              <input
                type="number"
                min={0}
                max={180}
                value={cfg.scheduling_rules.travel_buffer_min}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0;
                  const clamped = Math.min(180, Math.max(0, val));
                  patchSchedulingRules({ travel_buffer_min: clamped });
                }}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Jours de recherche (horizon)</label>
              <input
                type="number"
                min={1}
                max={30}
                value={cfg.scheduling_rules.days_ahead}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0;
                  const clamped = Math.min(30, Math.max(1, val));
                  patchSchedulingRules({ days_ahead: clamped });
                }}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">Nombre de créneaux proposés</label>
              <input
                type="number"
                min={1}
                max={5}
                value={cfg.scheduling_rules.proposal_count}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0;
                  const clamped = Math.min(5, Math.max(1, val));
                  patchSchedulingRules({ proposal_count: clamped });
                }}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400">Répartition des créneaux</label>
            <select
              value={cfg.scheduling_rules.spread_mode}
              onChange={(e) =>
                patchSchedulingRules({
                  spread_mode: e.target.value === "same_day_ok" ? "same_day_ok" : "multi_day",
                })
              }
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm text-white"
            >
              <option value="multi_day">Répartir sur plusieurs jours (recommandé)</option>
              <option value="same_day_ok">Autoriser même jour si nécessaire</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={!!cfg.scheduling_rules.exclude_lunch}
              onClick={() => patchSchedulingRules({ exclude_lunch: !cfg.scheduling_rules.exclude_lunch })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${cfg.scheduling_rules.exclude_lunch ? "bg-blue-600" : "bg-slate-700"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${cfg.scheduling_rules.exclude_lunch ? "translate-x-5" : "translate-x-1"}`} />
            </button>
            <span className="text-sm text-slate-300">Exclure pause 12:00–14:00</span>
          </div>
          <div>
            <label className="text-xs text-slate-400">Contraintes (ex. &quot;Pas de visites lundi matin&quot;)</label>
            <textarea
              rows={2}
              value={cfg.scheduling_rules.constraints_text}
              onChange={(e) => patchSchedulingRules({ constraints_text: e.target.value })}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500"
              placeholder="Pas de visites lundi matin"
            />
          </div>
        </div>
      </section>

      {/* Section 4 : Garde-fous Autopilot */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">4. Garde-fous Autopilot</h2>
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.autopilot_guardrails?.require_calendar_connected ?? true}
              onChange={(e) => patchAutopilotGuardrails({ require_calendar_connected: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-sky-500"
            />
            <span className="text-slate-300">Exiger un calendrier connecté (slots / proposition)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.autopilot_guardrails?.require_property_match_for_location ?? true}
              onChange={(e) => patchAutopilotGuardrails({ require_property_match_for_location: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-sky-500"
            />
            <span className="text-slate-300">Exiger un bien matché pour LOCATION (loyer / adresse)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.autopilot_guardrails?.require_faq_match_for_information ?? false}
              onChange={(e) => patchAutopilotGuardrails({ require_faq_match_for_information: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-sky-500"
            />
            <span className="text-slate-300">Exiger un match FAQ pour INFORMATION (sinon pas d’envoi info)</span>
          </label>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="text-xs text-slate-400">Heure début quiet (ex. 20:00)</label>
              <input
                type="text"
                value={cfg.autopilot_guardrails?.quiet_hours?.start ?? "20:00"}
                onChange={(e) => patchAutopilotGuardrails({ quiet_hours: { start: e.target.value } })}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
                placeholder="20:00"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Heure fin quiet (ex. 08:00)</label>
              <input
                type="text"
                value={cfg.autopilot_guardrails?.quiet_hours?.end ?? "08:00"}
                onChange={(e) => patchAutopilotGuardrails({ quiet_hours: { end: e.target.value } })}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
                placeholder="08:00"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400">Max e-mails Autopilot / heure</label>
            <input
              type="number"
              min={1}
              max={100}
              value={cfg.autopilot_guardrails?.max_autopilot_emails_per_hour ?? 30}
              onChange={(e) => patchAutopilotGuardrails({ max_autopilot_emails_per_hour: Math.max(1, Math.min(100, Number(e.target.value) || 30)) })}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-white"
            />
          </div>
        </div>
      </section>

      {/* Biens (Properties) */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Biens</h2>
          <div className="flex gap-2">
            <button
              onClick={addProperty}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600"
            >
              + Ajouter
            </button>
            {propertiesDirty && (
              <button
                onClick={saveProperties}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >
                Enregistrer
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80">
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-400">Nom</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-400">Adresse</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-400">Loyer (€)</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {(localProperties.length ? localProperties : propsToEdit).map((p, idx) => (
                <tr key={idx} className="border-b border-slate-800/80 hover:bg-slate-800/30">
                  <td className="py-2 px-3">
                    <input
                      value={p.name}
                      onChange={(e) => updateProperty(idx, "name", e.target.value)}
                      className="w-full bg-transparent text-white placeholder-slate-500 focus:outline-none text-sm"
                      placeholder="Studio centre"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      value={p.address}
                      onChange={(e) => updateProperty(idx, "address", e.target.value)}
                      className="w-full bg-transparent text-slate-300 placeholder-slate-500 focus:outline-none text-sm"
                      placeholder="12 rue Example"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      value={p.rent || ""}
                      onChange={(e) => updateProperty(idx, "rent", Number(e.target.value) || 0)}
                      className="w-20 bg-transparent text-slate-300 focus:outline-none text-sm"
                      placeholder="850"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <button
                      onClick={() => removeProperty(idx)}
                      className="text-slate-500 hover:text-red-400 text-xs"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {propsToEdit.length === 0 && localProperties.length === 0 && (
          <p className="text-xs text-slate-500 mt-2">Aucun bien. Cliquez sur &quot;+ Ajouter&quot;.</p>
        )}
      </section>

      {/* Persona agent */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">Persona agent</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Nom</label>
            <input
              value={cfg.agent_persona.agent_name}
              onChange={(e) => patchAgentPersona({ agent_name: e.target.value })}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Ton</label>
            <select
              value={cfg.agent_persona.tone}
              onChange={(e) => patchAgentPersona({ tone: e.target.value })}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm text-white"
            >
              <option value="friendly">Friendly (chaleureux)</option>
              <option value="formal">Formal (professionnel)</option>
              <option value="premium">Premium (luxe)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Signature</label>
            <textarea
              rows={3}
              value={cfg.agent_persona.signature}
              onChange={(e) => patchAgentPersona({ signature: e.target.value })}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
      </section>

      {/* Apparence */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">Apparence</h2>
        <div className="space-y-4">
          {/* Thème */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block">Thème</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => patchConfig({ ui: { ...cfg.ui, theme: "dark" } })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  cfg.ui.theme === "dark"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Sombre
              </button>
              <button
                onClick={() => patchConfig({ ui: { ...cfg.ui, theme: "light" } })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  cfg.ui.theme === "light"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Clair
              </button>
            </div>
          </div>
          
          {/* Densité */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block">Densité</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => patchConfig({ ui: { ...cfg.ui, density: "comfortable" } })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  cfg.ui.density === "comfortable"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Confort
              </button>
              <button
                onClick={() => patchConfig({ ui: { ...cfg.ui, density: "compact" } })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  cfg.ui.density === "compact"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Compact
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Assistant / Autopilot */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">Assistant</h2>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!settings.assistant_enabled}
              onChange={(e) => updateSettings({
                assistant_enabled: e.target.checked,
                automation_level: settings.automation_level ?? "draft",
              }).then(() => showToast("Enregistré")).catch((err) => {
                console.error("Settings update error:", err);
                showToast("Erreur lors de l'enregistrement");
              })}
              className="rounded border-slate-600 bg-slate-900 text-blue-600"
            />
            <span className="text-sm text-slate-300">Assistant ON / OFF</span>
          </label>
          <div className="flex items-center gap-4 pl-6">
            <label className={`flex items-center gap-2 cursor-pointer ${!settings.assistant_enabled ? "opacity-50 pointer-events-none" : ""}`}>
              <input
                type="radio"
                checked={(settings.automation_level ?? "draft") !== "autopilot"}
                disabled={!settings.assistant_enabled}
                onChange={() => updateSettings({ automation_level: "draft" }).then(() => showToast("Enregistré")).catch((e) => {
                  console.error("Settings update error:", e);
                  showToast("Erreur lors de l'enregistrement");
                })}
                className="border-slate-600 bg-slate-900 text-blue-600"
              />
              <span className="text-sm text-slate-300">Draft</span>
            </label>
            <label className={`flex items-center gap-2 cursor-pointer ${!settings.assistant_enabled ? "opacity-50 pointer-events-none" : ""}`}>
              <input
                type="radio"
                checked={settings.automation_level === "autopilot"}
                disabled={!settings.assistant_enabled}
                onChange={() => updateSettings({ automation_level: "autopilot" }).then(() => showToast("Enregistré")).catch((e) => {
                  console.error("Settings update error:", e);
                  showToast("Erreur lors de l'enregistrement");
                })}
                className="border-slate-600 bg-slate-900 text-blue-600"
              />
              <span className="text-sm text-slate-300">Autopilot</span>
            </label>
          </div>
          <p className="text-xs text-slate-500 pl-6">
            {!settings.assistant_enabled ? (
              <>OFF = pas d'analyse IA, pas de brouillons, pas d'envoi auto. &nbsp;Draft = brouillon, vous validez. &nbsp;Autopilot = envoi + booking auto.</>
            ) : (
              <><strong>Draft</strong> = brouillon généré, vous validez avant envoi. &nbsp;<strong>Autopilot</strong> = envoi + propositions de créneaux + confirmation RDV automatiques.</>
            )}
          </p>
        </div>
      </section>

      {/* Réponses standards (snippets) — utilisées par l'IA pour property_question, admin, application_status, out_of_scope */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">Réponses standards (snippets)</h2>
        <p className="text-xs text-slate-500 mb-3">Textes utilisés par l'IA pour répondre sans inventer. À personnaliser selon votre agence.</p>
        <div className="grid gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Infos bien (property_info_default)</label>
            <textarea
              value={cfg.snippets?.property_info_default ?? ""}
              onChange={(e) => patchSnippets({ property_info_default: e.target.value })}
              onBlur={() => showToast("Enregistré")}
              rows={2}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 text-slate-200 text-sm p-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Admin / bail / paiement (admin_default)</label>
            <textarea
              value={cfg.snippets?.admin_default ?? ""}
              onChange={(e) => patchSnippets({ admin_default: e.target.value })}
              onBlur={() => showToast("Enregistré")}
              rows={2}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 text-slate-200 text-sm p-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Statut dossier (application_status_default)</label>
            <textarea
              value={cfg.snippets?.application_status_default ?? ""}
              onChange={(e) => patchSnippets({ application_status_default: e.target.value })}
              onBlur={() => showToast("Enregistré")}
              rows={2}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 text-slate-200 text-sm p-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Hors scope (out_of_scope_default)</label>
            <textarea
              value={cfg.snippets?.out_of_scope_default ?? ""}
              onChange={(e) => patchSnippets({ out_of_scope_default: e.target.value })}
              onBlur={() => showToast("Enregistré")}
              rows={2}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 text-slate-200 text-sm p-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Demande pièces manquantes (missing_docs)</label>
            <textarea
              value={cfg.snippets?.missing_docs ?? ""}
              onChange={(e) => patchSnippets({ missing_docs: e.target.value })}
              onBlur={() => showToast("Enregistré")}
              rows={2}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 text-slate-200 text-sm p-2"
              placeholder="[liste] = documents à fournir"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Non éligible + option garant (ineligible_guarantor_option)</label>
            <textarea
              value={cfg.snippets?.ineligible_guarantor_option ?? ""}
              onChange={(e) => patchSnippets({ ineligible_guarantor_option: e.target.value })}
              onBlur={() => showToast("Enregistré")}
              rows={2}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 text-slate-200 text-sm p-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Relance réponse (followup_reminder)</label>
            <textarea
              value={cfg.snippets?.followup_reminder ?? ""}
              onChange={(e) => patchSnippets({ followup_reminder: e.target.value })}
              onBlur={() => showToast("Enregistré")}
              rows={2}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 text-slate-200 text-sm p-2"
            />
          </div>
        </div>
      </section>

      {/* Politiques par type de demande (intent) — Autopilot autorisé ou brouillon uniquement */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-2">Politiques par type de demande</h2>
        <p className="text-xs text-slate-500 mb-3">En Autopilot, l’IA peut envoyer automatiquement uniquement pour les intents cochés « Autopilot autorisé ». Sinon, un brouillon est généré.</p>
        <div className="space-y-2">
          {[
            { key: "booking_request" as const, label: "Demande de visite / RDV" },
            { key: "property_question" as const, label: "Question sur un bien" },
            { key: "documents_status" as const, label: "Dossier / documents" },
            { key: "application_status" as const, label: "Statut candidature" },
            { key: "reschedule" as const, label: "Report / reprogrammation" },
            { key: "cancel" as const, label: "Annulation" },
            { key: "admin_question" as const, label: "Admin / facturation" },
            { key: "out_of_scope" as const, label: "Hors scope" },
          ].map(({ key, label }) => {
            const policy = (cfg.intent_policies as any)?.[key];
            const allowed = policy?.autopilot_allowed ?? false;
            return (
              <label key={key} className="flex items-center justify-between gap-3 py-1 cursor-pointer">
                <span className="text-sm text-slate-300">{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allowed}
                  onClick={() => patchIntentPolicy(key, { autopilot_allowed: !allowed })}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${allowed ? "bg-emerald-600" : "bg-slate-700"}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${allowed ? "translate-x-5" : "translate-x-1"}`} />
                </button>
              </label>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-700">
          <label className="block text-xs text-slate-400 mb-1">Adresse exacte du bien</label>
          <select
            value={cfg.address_policy}
            onChange={(e) => patchAddressPolicy(e.target.value as "after_qualification" | "after_booking" | "always")}
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-white"
          >
            <option value="always">Toujours (dès la 1re réponse)</option>
            <option value="after_qualification">Après qualification du dossier</option>
            <option value="after_booking">Après confirmation du créneau (recommandé)</option>
          </select>
        </div>
        <div className="mt-4 pt-4 border-t border-slate-700">
          <h3 className="text-xs font-medium text-slate-400 mb-2">Relances automatiques</h3>
          <label className="flex items-center gap-2 py-1 cursor-pointer">
            <button
              type="button"
              role="switch"
              aria-checked={!!cfg.followup_policy?.enabled}
              onClick={() => patchFollowupPolicy({ enabled: !cfg.followup_policy?.enabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${cfg.followup_policy?.enabled ? "bg-blue-600" : "bg-slate-700"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${cfg.followup_policy?.enabled ? "translate-x-5" : "translate-x-1"}`} />
            </button>
            <span className="text-sm text-slate-300">Relances activées</span>
          </label>
          {cfg.followup_policy?.enabled && (
            <div className="flex flex-wrap gap-4 pl-12 mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!cfg.followup_policy?.d1}
                  onChange={(e) => patchFollowupPolicy({ d1: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-900 text-blue-600"
                />
                <span className="text-xs text-slate-400">J+1</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!cfg.followup_policy?.d3}
                  onChange={(e) => patchFollowupPolicy({ d3: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-900 text-blue-600"
                />
                <span className="text-xs text-slate-400">J+3</span>
              </label>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
