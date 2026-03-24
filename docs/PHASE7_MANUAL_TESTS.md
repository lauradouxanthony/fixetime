# Phase 7 — Tests manuels (Go-Live hardening)

## A) Autopilot guardrails

### 1) Quiet hours
- Paramètres → Garde-fous Autopilot : définir quiet 20:00–08:00 (timezone Europe/Paris).
- Simuler une exécution cron en dehors de la plage (ou modifier l’heure de test) : aucun envoi.
- Pour un email qui aurait été envoyé : `lead_json.autopilot_block_reason = "quiet hours"`, `last_action` = "Autopilot bloqué (quiet hours)".

### 2) Rate limit
- Définir `max_autopilot_emails_per_hour: 2` en Settings.
- Envoyer 2 e-mails via Autopilot dans l’heure.
- Le 3ᵉ lead à traiter doit être bloqué : `autopilot_block_reason = "rate limit"`, last_action "Autopilot bloqué (rate limit)".

### 3) Calendar required
- `require_calendar_connected: true`, déconnecter Google et Microsoft (ou utiliser un user sans tokens).
- Relancer le cron : pour les actions slots/proposal, blocage avec `autopilot_block_reason = "calendar"`.

### 4) Property match (LOCATION)
- `require_property_match_for_location: true`.
- Lead LOCATION sans `property_id` ni `lead_json.rent` : blocage "property missing".

### 5) FAQ match (INFORMATION)
- `require_faq_match_for_information: true`.
- Lead INFORMATION avec `info_source !== "FAQ"` : blocage "faq missing".

### 6) UI blocage
- Ouvrir un email avec `autopilot_block_reason` renseigné.
- Vérifier le badge "Autopilot bloqué: <reason>" et les CTA (Paramètres / Connexion calendrier, FAQ, Biens, rate limit).

---

## B) Audit trail / Live Feed

### 7) Activity log
- Vérifier que les actions enregistrent une ligne dans `activity_log` : info draft created, info reply sent, slots generated, proposal sent, booked confirmed, autopilot blocked (avec reason).
- GET `/api/activity/recent?limit=20` : retourne les 20 derniers événements pour l’utilisateur connecté (created_at, type, title, etc.).

### 8) Live Feed Pipeline
- Page Pipeline : colonne droite "Live Feed" avec les 20 derniers événements et "time ago" (il y a X min, il y a Xh, etc.).
- Après une action (ex. envoi proposition), l’événement apparaît dans le Live Feed après actualisation (ou refresh 30s).

---

## C) Setup status (onboarding)

### 9) Composant Setup
- Paramètres : bloc "Prêt pour l’Autopilot" en haut (Ready / Not ready).
- Vérifier les lignes : Google connecté, Microsoft connecté, Calendrier disponible, FAQ (N entrées, recommandé 5+), Biens (N).
- Si calendrier absent ou 0 bien : "Not ready" + recommandations listées.

### 10) Ready for Autopilot
- Connecter au moins un provider (Google ou Microsoft) et ajouter au moins un bien.
- Vérifier le passage à "Ready" (sans exiger 5 FAQ pour le statut ready).
- Option : afficher un avertissement ou désactiver le switch Autopilot si "Not ready" (à valider en prod).

---

## Récap 10 tests

| # | Domaine        | Test |
|---|----------------|------|
| 1 | Guardrails     | Quiet hours → skip + last_action "Autopilot bloqué (quiet hours)" |
| 2 | Guardrails     | Rate limit → blocage après N envois/heure |
| 3 | Guardrails     | Calendar required → bloc "calendar" si pas de token |
| 4 | Guardrails     | Property match LOCATION → bloc "property missing" |
| 5 | Guardrails     | FAQ match INFORMATION → bloc "faq missing" |
| 6 | Guardrails     | UI badge + CTA selon reason |
| 7 | Audit          | activity_log peuplé + GET /api/activity/recent |
| 8 | Audit          | Live Feed colonne droite Pipeline avec time ago |
| 9 | Setup          | Composant Setup Status dans Paramètres |
| 10| Setup          | Ready for Autopilot quand calendrier + au moins 1 bien |

---

## Fichiers modifiés / ajoutés (Phase 7)

| Fichier | Rôle |
|---------|------|
| `app/api/settings/route.ts` | Defaults `config.autopilot_guardrails` |
| `app/settings/SettingsClient.tsx` | UI Section 4 Garde-fous + cfg + `SetupStatus` |
| `lib/autopilot/guardrails.ts` | **Nouveau** : `isInQuietHours()` |
| `app/api/cron/autopilot-dispatch/route.ts` | Chargement config/guardrails, quiet hours, rate limit, calendar, property, FAQ, `setAutopilotBlock` |
| `components/emails/EmailDetailPanel.tsx` | Badge + CTA `autopilot_block_reason` |
| `lib/pipeline/derivePipelineRow.ts` | Label `autopilot_blocked` |
| `app/api/activity/recent/route.ts` | **Nouveau** : GET /api/activity/recent?limit=20 |
| `components/activity/LiveFeed.tsx` | **Nouveau** : Live Feed 20 derniers + time ago |
| `app/(app)/pipeline/page.tsx` | Colonne droite Live Feed |
| `app/api/setup/status/route.ts` | **Nouveau** : GET /api/setup/status (google, microsoft, calendar, faq_count, properties_count, ready) |
| `components/setup/SetupStatus.tsx` | **Nouveau** : Bloc "Prêt pour l’Autopilot" + recommandations |
