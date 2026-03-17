# Pipeline — Mapping statuts et intents

## Intent (ELITE)

| Valeur DB `lead_json.intent` | Affichage UI | Description |
|------------------------------|--------------|-------------|
| `LOCATION` | LOCATION (badge bleu) | Demande visite / location / dossier / créneaux |
| `INFORMATION` | INFO (badge gris) | Question type FAQ (charges, animaux, coloc, etc.) |

**Dérivation** (si `lead_json.intent` absent) :  
- Si `lead_status` ∈ { `slots_proposed`, `booked` } ou `slots_proposed` non vide → **LOCATION**  
- Sinon → **LOCATION** par défaut (backend remplit désormais `intent` à l’analyse).

## Statut (ELITE)

| Valeur DB `lead_status` | Libellé affiché (Pipeline + Détails) |
|-------------------------|--------------------------------------|
| `raw` | New |
| `new_lead` | New |
| `qualifying` | WaitingDocs / En qualification |
| `slots_proposed` | SlotsProposed |
| `booked` | Booked |
| `unqualified` | Unqualified |
| `other` | Other |

## Dernière action

- Texte lisible : `lead_last_action` ou dérivé de `lead_json.last_outbound.type` (ex. "Proposition envoyée", "Réponse envoyée").
- Horodatage : `lead_last_action_at` ou `last_outbound.at`.

## Fichiers concernés

- **Constantes** : `lib/pipeline/constants.ts` (`LEAD_STATUS_TO_LABEL`)
- **Dérivation ligne** : `lib/pipeline/derivePipelineRow.ts`
- **API liste** : `app/api/pipeline/list/route.ts` (filtres `intent`, `status`)
- **Détails** : `components/emails/EmailDetailPanel.tsx` (badge intent + sections LOCATION / INFORMATION)
