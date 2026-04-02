import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logActivity } from "@/lib/activity/logActivity";
import { isInQuietHours } from "@/lib/autopilot/guardrails";
import { setLastAction } from "@/lib/lead/lastAction";
import { isSystemEmail } from "@/lib/email/ignoreFilter";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const startTime = Date.now();

  const cronKey =
    req.headers.get("x-fixetime-cron-key") ||
    req.headers.get("x-cron-key") ||
    (() => {
      const auth = req.headers.get("authorization");
      if (auth?.startsWith("Bearer ")) return auth.slice(7);
      return null;
    })();

  const expectedKey = process.env.FIXETIME_INTERNAL_CRON_KEY || process.env.CRON_SECRET || "dev123";
  if (cronKey !== expectedKey) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const targetUserId = url.searchParams.get("user_id");
  const debug = url.searchParams.get("debug") === "1";
  const dryRun = url.searchParams.get("dry") === "1";

  const origin = url.origin || `http://${req.headers.get("host") || "localhost:3000"}`;

  let usersToProcess: { user_id: string }[] = [];

  if (targetUserId) {
    usersToProcess = [{ user_id: targetUserId }];
  } else {
    const { data: settingsRows } = await supabaseAdmin
      .from("settings_v1")
      .select("user_id")
      .eq("assistant_enabled", true)
      .eq("automation_level", "autopilot")
      .limit(20);

    usersToProcess = (settingsRows ?? []).map((r) => ({ user_id: r.user_id }));
  }

  if (usersToProcess.length === 0) {
    return NextResponse.json({
      success: true,
      dryRun: dryRun || undefined,
      users_processed: 0,
      emails_processed: 0,
      replies_sent: 0,
      proposals_sent: 0,
      skipped_locked: 0,
      duration_ms: Date.now() - startTime,
      ...(dryRun ? { leads_would_process: 0, leads_would_block: 0, block_reasons: {} } : {}),
    });
  }

  let usersProcessed = 0;
  let emailsProcessed = 0;
  let repliesSent = 0;
  let proposalsSent = 0;
  // Counters used in payload/stats (ensure defined for TS)
  let generatedSlotsCount = 0;
  let stage1RepliesSent = 0;
  let stage2ProposalsSent = 0;
  const debugInfo: any[] = [];

  const dryRunCounts = dryRun ? { would_process: 0, would_block: 0, block_reasons: {} as Record<string, number> } : null;

  for (const { user_id: userId } of usersToProcess) {
    try {
    const { data: settings } = await supabaseAdmin
      .from("settings_v1")
      .select("assistant_enabled, automation_level, config")
      .eq("user_id", userId)
      .maybeSingle();

    const config = (settings as any)?.config ?? {};
    const guardrails = config?.autopilot_guardrails ?? {};
    const intentPolicies: Record<string, { autopilot_allowed?: boolean }> =
      config?.intent_policies ?? {};
    const requireCalendar = guardrails?.require_calendar_connected !== false;
    const quietHours = guardrails?.quiet_hours ?? { start: "20:00", end: "08:00", timezone: config?.scheduling_rules?.timezone ?? "Europe/Paris" };
    const maxPerHour = Math.max(1, Math.min(100, Number(guardrails?.max_autopilot_emails_per_hour) || 30));
    const requirePropertyMatch = guardrails?.require_property_match_for_location !== false;
    const requireFaqMatch = guardrails?.require_faq_match_for_information === true;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: sentLastHour } = await supabaseAdmin
      .from("activity_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("type", ["email_sent", "proposal_sent", "ai_reply_sent"])
      .gte("created_at", oneHourAgo);
    const sentCount = typeof sentLastHour === "number" ? sentLastHour : 0;
    const rateLimitReached = sentCount >= maxPerHour;

    let hasCalendar = false;
    if (requireCalendar) {
      const [g, m] = await Promise.all([
        supabaseAdmin.from("gmail_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.from("microsoft_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
      ]);
      hasCalendar = !!(g?.data?.user_id || m?.data?.user_id);
    }

    const assistantEnabled = (settings as any)?.assistant_enabled === true;
    const automationLevel = (settings as any)?.automation_level ?? "draft";

    if (!assistantEnabled || automationLevel !== "autopilot") {
      if (debug) {
        debugInfo.push({
          user_id: userId,
          autopilot_enabled: false,
          reason: assistantEnabled ? `automation_level=${automationLevel}` : "assistant_enabled=false",
        });
      }
      continue;
    }

    if (!dryRun) {
      const { data: inboxState } = await supabaseAdmin
        .from("inbox_state")
        .select("autopilot_locked_until")
        .eq("user_id", userId)
        .maybeSingle();
      const lockedUntil = (inboxState as any)?.autopilot_locked_until;
      if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
        if (debug) debugInfo.push({ user_id: userId, skip: "autopilot_locked" });
        continue;
      }
      await supabaseAdmin
        .from("inbox_state")
        .upsert(
          { user_id: userId, autopilot_locked_until: new Date(Date.now() + 2 * 60 * 1000).toISOString(), updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        )
        .then(() => {});
    }

    const { data: emails, error: emailsError } = await supabaseAdmin
      .from("emails")
      .select("id, user_id, lead_status, decision, ai_reply, lead_json, lead_missing_fields, property_id, received_at, lead_last_action")
      .eq("user_id", userId)
      .in("lead_status", ["qualifying", "unqualified", "slots_proposed", "other"])
      .eq("decision", "traiter")
      // Filtre DB anti-doublon : exclure les emails déjà envoyés (NULLs = pas encore envoyé, donc inclus)
      .or("lead_last_action.is.null,lead_last_action.not.like.%auto-envoyée%")
      .order("received_at", { ascending: false })
      .limit(25);

    if (emailsError || !emails || emails.length === 0) {
      if (debug) {
        debugInfo.push({
          user_id: userId,
          autopilot_enabled: true,
          candidate_count: 0,
          candidates_sample: [],
          skip_reasons_count: {},
        });
      }
      continue;
    }

    const candidatesSample: any[] = [];
    const skipReasons: Record<string, number> = {
      SKIP_MISSING_AI_REPLY: 0,
      SKIP_ALREADY_SENT_REPLY: 0,
      SKIP_MISSING_SLOTS: 0,
      SKIP_ALREADY_SENT_PROPOSAL: 0,
      SKIP_FETCH_ERROR: 0,
      SKIP_MISSING_FIELDS: 0,
      SKIP_STAGE1_SKIP: 0,
      SKIP_STAGE2_SKIP: 0,
    };

    const setAutopilotBlock = async (emailId: string, reason: string, leadJson: any) => {
      const nowIso = new Date().toISOString();
      const nextLj = {
        ...leadJson,
        autopilot_pending: false,
        autopilot_block_reason: reason,
        last_action: setLastAction(leadJson, { type: "autopilot_blocked", label: `Autopilot bloqué (${reason})` }, nowIso),
      };
      await supabaseAdmin.from("emails").update({ lead_json: nextLj, lead_last_action: `Autopilot bloqué (${reason})`, lead_last_action_at: nowIso }).eq("id", emailId).eq("user_id", userId);
      await logActivity({ userId, actor: "system", type: "autopilot_blocked", title: `Autopilot bloqué: ${reason}`, emailId, meta: { reason } }).catch(() => null);
    };

    for (const email of emails) {
      // Ignorer les emails système (banques, noreply, newsletters…)
      const emailSender = (email as Record<string, unknown>).sender as string ?? "";
      const emailSubject = (email as Record<string, unknown>).subject as string ?? "";
      if (isSystemEmail(emailSender, emailSubject)) continue;

      const leadJson = (email.lead_json as any) ?? {};
      // Ne traiter que les leads explicitement flagués par l'analyse IA (Phase 4)
      if (leadJson?.autopilot_pending !== true) continue;
      const lastOutboundType = leadJson?.last_outbound?.type || null;
      const missingFields = Array.isArray(email.lead_missing_fields) ? email.lead_missing_fields : [];
      const propertyId = (email as any).property_id;
      const slotsProposed = Array.isArray(leadJson?.slots_proposed) ? leadJson.slots_proposed : [];
      const slotsProposedCount = slotsProposed.length;

      if (debug && candidatesSample.length < 10) {
        candidatesSample.push({
          id: email.id,
          lead_status: email.lead_status,
          last_outbound_type: lastOutboundType,
          ai_reply_present: !!(email.ai_reply),
          slots_proposed_count: slotsProposedCount,
          missing_fields_count: missingFields.length,
          property_id: propertyId,
        });
      }

      const leadStatus = email.lead_status || "";
      const intent = leadJson?.intent;
      const autopilotAction = leadJson?.autopilot_action;
      const isInfoLead = leadStatus === "other" && intent === "INFORMATION" && autopilotAction === "send_info_reply";

      if (!["qualifying", "unqualified", "slots_proposed", "other"].includes(leadStatus)) {
        continue;
      }

      const intentDetail = leadJson?.intent_detail as string | undefined;
      if (
        intentDetail &&
        intentPolicies[intentDetail]?.autopilot_allowed === false
      ) {
        if (dryRun && dryRunCounts) {
          dryRunCounts.would_block++;
          dryRunCounts.block_reasons["intent_policy"] =
            (dryRunCounts.block_reasons["intent_policy"] || 0) + 1;
          continue;
        }
        await setAutopilotBlock(
          email.id,
          `intent_policy_blocked:${intentDetail}`,
          leadJson
        );
        continue;
      }

      if (debug) {
        continue;
      }

      // INFORMATION (other) : envoi réponse FAQ / demande précision
      if (isInfoLead) {
        if (lastOutboundType === "info_reply" || lastOutboundType === "reply_sent" || lastOutboundType === "ai_reply") {
          skipReasons.SKIP_ALREADY_SENT_REPLY++;
          continue;
        }
        if (!email.ai_reply || !String(email.ai_reply).trim()) {
          skipReasons.SKIP_MISSING_AI_REPLY++;
          continue;
        }
        if (isInQuietHours(quietHours)) {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["quiet hours"] = (dryRunCounts.block_reasons["quiet hours"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "quiet hours", leadJson);
          continue;
        }
        if (rateLimitReached) {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["rate limit"] = (dryRunCounts.block_reasons["rate limit"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "rate limit", leadJson);
          continue;
        }
        if (requireFaqMatch && String(leadJson?.info_source || "").toUpperCase() !== "FAQ") {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["faq missing"] = (dryRunCounts.block_reasons["faq missing"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "faq missing", leadJson);
          continue;
        }
        if (dryRun && dryRunCounts) { dryRunCounts.would_process++; continue; }
        try {
          const response = await fetch(`${origin}/api/leads/send-reply`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-fixetime-cron-key": cronKey || "",
              "x-fix-trigger": "autopilot",
            },
            body: JSON.stringify({ emailId: email.id }),
          });
          if (response.ok) {
            stage1RepliesSent++;
            repliesSent++;
            emailsProcessed++;
          } else {
            console.error(`[AUTOPILOT] Send info reply failed for ${email.id}: ${response.status}`);
            skipReasons.SKIP_FETCH_ERROR++;
          }
        } catch (e: any) {
          console.error(`[AUTOPILOT] Send info reply error for ${email.id}`, e);
          skipReasons.SKIP_FETCH_ERROR++;
        }
        continue;
      }

      if (["qualifying", "unqualified"].includes(leadStatus)) {
        if (lastOutboundType === "ai_reply" || lastOutboundType === "reply_sent") {
          skipReasons.SKIP_ALREADY_SENT_REPLY++;
          if (leadStatus === "qualifying" && missingFields.length === 0 && propertyId && slotsProposedCount === 0) {
            if (isInQuietHours(quietHours)) {
              if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["quiet hours"] = (dryRunCounts.block_reasons["quiet hours"] || 0) + 1; continue; }
              await setAutopilotBlock(email.id, "quiet hours", leadJson);
              continue;
            }
            if (rateLimitReached) {
              if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["rate limit"] = (dryRunCounts.block_reasons["rate limit"] || 0) + 1; continue; }
              await setAutopilotBlock(email.id, "rate limit", leadJson);
              continue;
            }
            if (requireCalendar && !hasCalendar) {
              if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["calendar"] = (dryRunCounts.block_reasons["calendar"] || 0) + 1; continue; }
              await setAutopilotBlock(email.id, "calendar", leadJson);
              continue;
            }
            if (requirePropertyMatch && (!propertyId || !(leadJson?.rent ?? leadJson?.matched_property?.rent))) {
              if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["property missing"] = (dryRunCounts.block_reasons["property missing"] || 0) + 1; continue; }
              await setAutopilotBlock(email.id, "property missing", leadJson);
              continue;
            }
            if (dryRun && dryRunCounts) { dryRunCounts.would_process++; continue; }
            try {
              const generateRes = await fetch(`${origin}/api/leads/generate-slots`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-fixetime-cron-key": cronKey || "",
                },
                body: JSON.stringify({ emailId: email.id, duration_min: 30 }),
              });
              if (generateRes.ok) {
                generatedSlotsCount++;
                const genData = await generateRes.json().catch(() => ({}));
                if (genData.slots && Array.isArray(genData.slots) && genData.slots.length >= 3) {
                  const proposalRes = await fetch(`${origin}/api/leads/send-proposal`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-fixetime-cron-key": cronKey || "",
                      "x-fix-trigger": "autopilot",
                    },
                    body: JSON.stringify({ emailId: email.id }),
                  });
                  if (proposalRes.ok) {
                    stage2ProposalsSent++;
                    proposalsSent++;
                    emailsProcessed++;
                  } else {
                    console.error(`[AUTOPILOT] Send proposal failed after generate for ${email.id}: ${proposalRes.status}`);
                    skipReasons.SKIP_FETCH_ERROR++;
                  }
                }
              } else {
                console.error(`[AUTOPILOT] Generate slots failed for ${email.id}: ${generateRes.status}`);
                skipReasons.SKIP_FETCH_ERROR++;
              }
            } catch (e: any) {
              console.error(`[AUTOPILOT] Generate slots error for ${email.id}`, e);
              skipReasons.SKIP_FETCH_ERROR++;
            }
          }
          continue;
        }

        if (!email.ai_reply || !String(email.ai_reply).trim()) {
          skipReasons.SKIP_MISSING_AI_REPLY++;
          continue;
        }
        if (isInQuietHours(quietHours)) {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["quiet hours"] = (dryRunCounts.block_reasons["quiet hours"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "quiet hours", leadJson);
          continue;
        }
        if (rateLimitReached) {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["rate limit"] = (dryRunCounts.block_reasons["rate limit"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "rate limit", leadJson);
          continue;
        }
        if (dryRun && dryRunCounts) { dryRunCounts.would_process++; continue; }
        try {
          const response = await fetch(`${origin}/api/leads/send-reply`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-fixetime-cron-key": cronKey || "",
              "x-fix-trigger": "autopilot",
            },
            body: JSON.stringify({ emailId: email.id }),
          });

          if (response.ok) {
            stage1RepliesSent++;
            repliesSent++;
            emailsProcessed++;
          } else {
            console.error(`[AUTOPILOT] Send reply failed for ${email.id}: ${response.status}`);
            skipReasons.SKIP_FETCH_ERROR++;
          }
        } catch (e: any) {
          console.error(`[AUTOPILOT] Send reply error for ${email.id}`, e);
          skipReasons.SKIP_FETCH_ERROR++;
        }
      }

      if (leadStatus === "slots_proposed" || (leadStatus === "qualifying" && missingFields.length === 0 && propertyId && slotsProposedCount >= 3)) {
        if (lastOutboundType === "proposal_slots" || lastOutboundType === "proposal_slots_sent") {
          skipReasons.SKIP_ALREADY_SENT_PROPOSAL++;
          continue;
        }

        if (slotsProposedCount < 3) {
          if (leadStatus === "qualifying" && missingFields.length === 0 && propertyId) {
            if (isInQuietHours(quietHours)) {
              if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["quiet hours"] = (dryRunCounts.block_reasons["quiet hours"] || 0) + 1; continue; }
              await setAutopilotBlock(email.id, "quiet hours", leadJson);
              continue;
            }
            if (rateLimitReached) {
              if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["rate limit"] = (dryRunCounts.block_reasons["rate limit"] || 0) + 1; continue; }
              await setAutopilotBlock(email.id, "rate limit", leadJson);
              continue;
            }
            if (requireCalendar && !hasCalendar) {
              if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["calendar"] = (dryRunCounts.block_reasons["calendar"] || 0) + 1; continue; }
              await setAutopilotBlock(email.id, "calendar", leadJson);
              continue;
            }
            if (requirePropertyMatch && (!propertyId || !(leadJson?.rent ?? leadJson?.matched_property?.rent))) {
              if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["property missing"] = (dryRunCounts.block_reasons["property missing"] || 0) + 1; continue; }
              await setAutopilotBlock(email.id, "property missing", leadJson);
              continue;
            }
            if (dryRun && dryRunCounts) { dryRunCounts.would_process++; continue; }
            try {
              const generateRes = await fetch(`${origin}/api/leads/generate-slots`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-fixetime-cron-key": cronKey || "",
                },
                body: JSON.stringify({ emailId: email.id, duration_min: 30 }),
              });
              if (generateRes.ok) {
                generatedSlotsCount++;
                const genData = await generateRes.json().catch(() => ({}));
                if (genData.slots && Array.isArray(genData.slots) && genData.slots.length >= 3) {
                  const proposalRes = await fetch(`${origin}/api/leads/send-proposal`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-fixetime-cron-key": cronKey || "",
                      "x-fix-trigger": "autopilot",
                    },
                    body: JSON.stringify({ emailId: email.id }),
                  });
                  if (proposalRes.ok) {
                    stage2ProposalsSent++;
                    proposalsSent++;
                    emailsProcessed++;
                  } else {
                    console.error(`[AUTOPILOT] Send proposal failed after generate for ${email.id}: ${proposalRes.status}`);
                    skipReasons.SKIP_FETCH_ERROR++;
                  }
                } else {
                  skipReasons.SKIP_MISSING_SLOTS++;
                }
              } else {
                console.error(`[AUTOPILOT] Generate slots failed for ${email.id}: ${generateRes.status}`);
                skipReasons.SKIP_FETCH_ERROR++;
              }
            } catch (e: any) {
              console.error(`[AUTOPILOT] Generate slots error for ${email.id}`, e);
              skipReasons.SKIP_FETCH_ERROR++;
            }
          } else {
            skipReasons.SKIP_MISSING_SLOTS++;
          }
          continue;
        }
        if (isInQuietHours(quietHours)) {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["quiet hours"] = (dryRunCounts.block_reasons["quiet hours"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "quiet hours", leadJson);
          continue;
        }
        if (rateLimitReached) {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["rate limit"] = (dryRunCounts.block_reasons["rate limit"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "rate limit", leadJson);
          continue;
        }
        if (requireCalendar && !hasCalendar) {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["calendar"] = (dryRunCounts.block_reasons["calendar"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "calendar", leadJson);
          continue;
        }
        if (requirePropertyMatch && (!propertyId || !(leadJson?.rent ?? leadJson?.matched_property?.rent))) {
          if (dryRun && dryRunCounts) { dryRunCounts.would_block++; dryRunCounts.block_reasons["property missing"] = (dryRunCounts.block_reasons["property missing"] || 0) + 1; continue; }
          await setAutopilotBlock(email.id, "property missing", leadJson);
          continue;
        }
        if (dryRun && dryRunCounts) { dryRunCounts.would_process++; continue; }
        try {
          const response = await fetch(`${origin}/api/leads/send-proposal`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-fixetime-cron-key": cronKey || "",
              "x-fix-trigger": "autopilot",
            },
            body: JSON.stringify({ emailId: email.id }),
          });

          if (response.ok) {
            stage2ProposalsSent++;
            proposalsSent++;
            emailsProcessed++;
          } else {
            console.error(`[AUTOPILOT] Send proposal failed for ${email.id}: ${response.status}`);
            skipReasons.SKIP_FETCH_ERROR++;
          }
        } catch (e: any) {
          console.error(`[AUTOPILOT] Send proposal error for ${email.id}`, e);
          skipReasons.SKIP_FETCH_ERROR++;
        }
      }
    }

    if (debug) {
      debugInfo.push({
        user_id: userId,
        autopilot_enabled: true,
        candidate_count: emails.length,
        candidates_sample: candidatesSample,
        skip_reasons_count: skipReasons,
      });
    }

    usersProcessed++;
    } finally {
      if (!dryRun) {
        await supabaseAdmin
          .from("inbox_state")
          .update({ autopilot_locked_until: null, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .then(() => {});
      }
    }
  }

  const duration_ms = Date.now() - startTime;

  if (dryRun && dryRunCounts) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      dry_run: true,
      users_count: usersToProcess.length,
      leads_would_process: dryRunCounts.would_process,
      leads_would_block: dryRunCounts.would_block,
      block_reasons: dryRunCounts.block_reasons,
      duration_ms,
    });
  }

  const response: any = {
    success: true,
    users_processed: usersProcessed,
    emails_processed: emailsProcessed,
    replies_sent: repliesSent,
    proposals_sent: proposalsSent,
    generated_slots_count: generatedSlotsCount,
    stage1_replies_sent: stage1RepliesSent,
    stage2_proposals_sent: stage2ProposalsSent,
    skipped_locked: 0,
    duration_ms,
  };

  if (debug) {
    response.debug = debugInfo;
  }

  return NextResponse.json(response);
}

/**
 * GET /api/cron/autopilot-dispatch
 * Vercel Cron envoie des GET avec Authorization: Bearer CRON_SECRET.
 * On délègue vers le POST handler après vérification de la clé.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const key = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const expected =
    process.env.FIXETIME_INTERNAL_CRON_KEY ||
    process.env.CRON_SECRET ||
    "dev123";
  if (key !== expected) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  // Crée une requête POST synthétique et délègue
  const postReq = new Request(req.url, { method: "POST", headers: req.headers });
  return POST(postReq);
}
