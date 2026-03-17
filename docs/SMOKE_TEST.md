# Smoke test Phase 7

Un endpoint **GET /api/health/smoke** permet de vérifier automatiquement que l’environnement et les briques Phase 7 (guardrails, activity_log, settings merge, routes) répondent correctement avant des tests manuels.

## Sécurité

- **Protection** : l’endpoint exige le header `x-fixetime-cron-key` (ou `x-cron-key`) égal à `process.env.FIXETIME_INTERNAL_CRON_KEY` (ou `CRON_SECRET`). Sinon réponse **401** JSON.
- Toujours **réponse JSON** (y compris en erreur), pas de throw non catché.

## Appel

```bash
curl -s -H "x-fixetime-cron-key: VOTRE_CLE_CRON" "http://localhost:3000/api/health/smoke"
```

En prod, remplacer l’URL par celle du site (ex. `https://votre-app.vercel.app/api/health/smoke`).

La clé doit être celle définie dans les variables d’environnement du projet (`FIXETIME_INTERNAL_CRON_KEY` ou `CRON_SECRET`).

## Format de la réponse

```json
{
  "ok": true,
  "started_at": "2025-02-24T12:00:00.000Z",
  "duration_ms": 1234,
  "checks": [
    { "name": "env_openai", "ok": true, "details": "set" },
    { "name": "db_emails", "ok": true, "details": "ok" },
    ...
  ]
}
```

- **ok** : `true` si tous les checks sont verts, `false` sinon.
- **started_at** : heure de début (ISO).
- **duration_ms** : durée totale en millisecondes.
- **checks** : tableau de `{ name, ok, details? }`. Chaque check a un `name` et `ok` (boolean). En cas d’échec ou d’info utile, `details` peut contenir un message ou un objet.

## Checks effectués

| Nom | Description |
|-----|-------------|
| **env_openai** | Présence de `OPENAI_API_KEY`. |
| **env_cron_key** | Présence de `FIXETIME_INTERNAL_CRON_KEY` ou `CRON_SECRET`. |
| **env_site_url** | Présence de `NEXT_PUBLIC_SITE_URL` ou `NEXT_PUBLIC_APP_URL`. |
| **db_emails** | Table `emails` accessible (select 1). |
| **db_settings_v1** | Table `settings_v1` accessible. |
| **db_activity_log** | Table `activity_log` accessible. |
| **db_properties** | Table `properties` accessible. |
| **db_gmail_tokens** | Table `gmail_tokens` accessible. |
| **db_microsoft_tokens** | Table `microsoft_tokens` accessible. |
| **settings_merge** | Merge des settings par défaut : `config.autopilot_guardrails` (5 clés), `config.scheduling_rules.min_notice_hours`, `config.faq_items` (array). |
| **route_setup_status** | GET /api/setup/status → 200 avec `ready_for_autopilot` boolean, ou 401 (pas de 500). |
| **route_activity_recent** | GET /api/activity/recent?limit=1 → 200 avec tableau `items`, ou 401 (pas de 500). |
| **route_pipeline_list** | GET /api/pipeline/list?period=7d → 200 avec tableau `pipelineRows`, ou 401 (pas de 500). |
| **guardrails_quiet_hours** | `isInQuietHours()` : true à 22h, false à 14h (timezone Europe/Paris). |
| **activity_log_insert_read** | Insertion d’une ligne test (actor=system, type=smoke_test), lecture, puis suppression. |
| **autopilot_dry_run** | POST /api/cron/autopilot-dispatch?dry=1 → 200 avec `dryRun: true`, `leads_would_process`, `leads_would_block`, `block_reasons`. |

## Comment lire le JSON

- **Tout vert** : `ok === true` et chaque élément de `checks` a `ok === true`. Vous pouvez enchaîner avec les tests manuels Phase 7.
- **Un ou plusieurs rouges** : `ok === false`. Parcourir `checks` et regarder les entrées avec `ok === false` ; `details` indique la cause (ex. table absente, env manquante, route en 500).
- **401** : clé cron manquante ou incorrecte. Vérifier le header `x-fixetime-cron-key` et la variable d’environnement.
- **500 avec `error: "SMOKE_THREW"`** : exception non gérée dans le smoke ; `details` contient le message d’erreur.

Exemple de lecture en shell (jq) :

```bash
curl -s -H "x-fixetime-cron-key: $FIXETIME_INTERNAL_CRON_KEY" "http://localhost:3000/api/health/smoke" | jq '.ok, (.checks[] | select(.ok == false) | {name, details})'
```

## Dry-run Autopilot

Le smoke appelle **POST /api/cron/autopilot-dispatch?dry=1** avec la même clé cron. Ce mode :

- N’envoie aucun email et ne modifie pas les leads (pas d’effet de bord métier).
- Ne pose pas de lock autopilot.
- Retourne le nombre de leads qui seraient traités, bloqués, et le détail des raisons de blocage (`block_reasons`).

C’est utilisé comme check de cohérence (route répond, structure JSON correcte) dans le smoke test.
