# FixTime — Data Model "ELITE" (V1 vendable)

## 1. Source de vérité agence : `settings_v1`

Table existante : `settings_v1 (user_id, assistant_enabled, automation_level, config, updated_at)`.

### 1.1 `config` (JSONB) — Structure cible

Tout reste dans `config` pour migration douce, backward compatible.

```ts
config: {
  // ----- Section 1 : Règles locatives (calculateur) -----
  rental_rules: {
    income_multiplier: number;           // ex 3 (règle 3× loyer)
    accepted_employment_status: string[]; // ["CDI", "CDD", "Indépendant", "Étudiant", "Retraite", "Autre"]
    required_documents: string[];        // ["Pièce d'identité", "3 bulletins", "Avis d'imposition", ...]
    allow_guarantor: boolean;
    guarantor_required_for_status: string[]; // ex ["CDD", "Étudiant"] → garant obligatoire si ce statut
  },

  // ----- Section 2 : FAQ agence (Q/R) -----
  faq_items: Array<{
    id: string;           // uuid ou slug court
    question: string;     // "Les animaux sont-ils acceptés ?"
    answer: string;      // "Oui, chats autorisés, chiens sur accord."
    updated_at?: string; // ISO
  }>,

  // ----- Section 3 : Calendrier (prise de RDV) -----
  scheduling_rules: {
    timezone: string;
    workdays: number[];   // 1-7 (1=lundi)
    hours: { start: string; end: string };
    slot_duration_min: number;
    days_ahead: number;
    min_notice_hours: number;   // délai de prévenance (ex 24)
    travel_buffer_min: number;
    proposal_count: number;
    spread_mode: "multi_day" | "same_day_ok";
    exclude_lunch: boolean;
    constraints_text: string;
  },

  // ----- Existant conservé -----
  ui: { theme, density };
  agent_persona: { agent_name, tone, signature };
  properties: Array<{ id?, name, address, rent }>;
  snippets: { ... };
  intent_policies: { ... };
  address_policy: "after_qualification" | "after_booking" | "always";
  followup_policy: { enabled, d1, d3 };
}
```

### 1.2 Migration depuis l’existant

- **rental_rules** : déjà présent. À ajouter : `accepted_employment_status` (défaut `["CDI","CDD","Indépendant","Étudiant","Retraite","Autre"]`), `guarantor_required_for_status` (défaut `[]`).
- **faq_items** : nouveau. Défaut `[]`. Pas de table dédiée en V1 pour éviter migration DB ; tout dans `config`.
- **scheduling_rules** : déjà présent. À ajouter : `min_notice_hours` (défaut `24`).

Aucune nouvelle table. Lecture : si une clé manque, utiliser les valeurs par défaut du fichier `app/api/settings/route.ts` (DEFAULT_SETTINGS).

---

## 2. Lead / Candidat : table `emails` (couche lead)

Colonnes utilisées pour le pipeline :

| Colonne            | Type      | Rôle |
|--------------------|-----------|------|
| lead_status        | text      | Statut pipeline (voir valeurs ci‑dessous) |
| lead_score         | int       | 1–10 |
| lead_json          | jsonb     | Contexte complet (intent, slots, last_outbound, etc.) |
| lead_profile       | jsonb     | prospect_name, phone, monthly_income, employment_status, has_guarantor, … |
| lead_property_address | text   | Adresse du bien |
| lead_missing_fields| text[]    | Champs manquants pour qualification |
| lead_is_qualified  | boolean   | Dossier OK selon rental_rules |
| lead_last_action   | text      | Dernière action lisible ("Slots envoyés", "IA a répondu", …) |
| lead_last_action_at| timestamptz | |

### 2.1 `lead_status` — Valeurs normalisées ELITE

Pour affichage Pipeline et Détails, utiliser ces libellés (mapping depuis l’existant) :

| Valeur existante   | Valeur ELITE (affichage) | Description |
|--------------------|---------------------------|-------------|
| raw / null         | New                       | Non analysé |
| new_lead           | New                       | Nouveau lead |
| qualifying         | WaitingDocs / ReadyForVisit | En cours de qualification (selon missing_fields) |
| slots_proposed     | SlotsProposed             | Créneaux envoyés |
| booked             | Booked                    | RDV confirmé |
| unqualified        | Unqualified               | Rejeté |
| other              | Other                     | Autre |

Backend et UI peuvent continuer à écrire `qualifying` / `slots_proposed` etc. ; l’UI fait le mapping vers "WaitingDocs", "ReadyForVisit", "SlotsProposed", "Booked" pour l’affichage.

### 2.2 `lead_json` — Structure (à compléter par l’IA / workflow)

```ts
lead_json: {
  intent?: "LOCATION" | "INFORMATION";  // ELITE : classification
  slots_proposed?: string[];           // ISO dates
  slots_duration_min?: number;
  proposal_slots_sent?: boolean;
  last_outbound?: { type, at, to, ... };
  confirmed_slot?: string;
  calendar_event_id?: string;
  booking_confirmed_at?: string;
  draft_reply?: unknown;
  draft_proposal?: unknown;
  analysis?: any;
  raw_ai_output?: any;
  // ... autres champs existants
}
```

- **intent** : à remplir par le pipeline (analyze-inbox / classification). Si absent, déduire de l’existant (ex. présence de `slots_proposed` → LOCATION).
- **last_outbound** : déjà utilisé pour idempotence (reply_sent, proposal_slots, etc.).

### 2.3 Intent (classification)

- **LOCATION** : demande de visite / location / dossier / créneaux.
- **INFORMATION** : question charges, animaux, coloc, règlement, etc. → réponse basée sur FAQ ou snippet.

Stockage : `lead_json.intent`. Si la colonne `emails.lead_intent` existe plus tard, on peut la remplir en miroir ; en V1 tout dans `lead_json` suffit.

---

## 3. Récap migration

1. **settings_v1.config**  
   - Ajouter dans les défauts (et dans l’UI) :  
     `rental_rules.accepted_employment_status`,  
     `rental_rules.guarantor_required_for_status`,  
     `config.faq_items`,  
     `scheduling_rules.min_notice_hours`.
2. **emails**  
   - Aucun changement de schéma. Utiliser `lead_json.intent` pour l’intent. Continuer à utiliser `lead_status` avec les valeurs actuelles ; l’UI mappe vers les libellés ELITE.
3. **Backward compatibility**  
   - Toute clé absente est remplacée par la valeur par défaut dans l’API GET /api/settings et dans les routes qui lisent `config`.

---

## 4. Fichiers à mettre à jour

- `app/api/settings/route.ts` : DEFAULT_SETTINGS avec `faq_items`, `accepted_employment_status`, `guarantor_required_for_status`, `min_notice_hours`.
- `hooks/useSettings.ts` : types Settings étendus.
- `app/settings/SettingsClient.tsx` : 3 sections (Règles locatives, FAQ, Calendrier) + champs nouveaux.
- Pipeline / Détails : lecture de `lead_json.intent` et mapping `lead_status` → libellés ELITE (à faire dans les étapes suivantes).
