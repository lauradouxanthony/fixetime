# Phase 6 — Tests manuels (final polish sales-ready)

## A) Intent override (anti faux-positifs)

1. Envoyer un email dont le contenu contient une intention visite explicite (ex. "Je souhaite visiter le T2", "Quand puis-je organiser un rendez-vous ?", "Disponibilités pour voir le bien ?").
2. Lancer l’analyse (cron ou manuel).
3. **Attendu** : `eliteIntent = LOCATION` et le lead apparaît en LOCATION dans la Pipeline (pas en INFO), même si l’IA a classé en property_question.

---

## B) FAQ match quality

1. Ajouter une FAQ avec des mots précis (ex. "Les animaux sont-ils acceptés ?").
2. Envoyer un email "Animaux acceptés ?" → doit matcher la FAQ (pas de collision avec "charges" dossier).
3. **Attendu** : réponse basée sur la FAQ, pas sur une autre entrée. Si `showDebug=true` dans l’appel à `matchFaq`, les `topCandidates` (top 3 id + score) sont retournés.

---

## C) Last_action.at partout

1. Après chaque action (générer brouillon, envoyer réponse, envoyer proposition, confirmer créneau, générer créneaux, demande précision FAQ), vérifier en DB ou via l’API que `lead_json.last_action` contient `{ type, at, label }` avec `at` en ISO.
2. **Attendu** : aucune action significative sans `last_action.at` ; le helper `setLastAction` est utilisé dans analyze-inbox et generate-reply (branche INFO).

---

## D) UX INFO status

1. **Intent INFORMATION + Draft + brouillon présent** : badge "INFO — Brouillon prêt".
2. **Intent INFORMATION + autopilot_pending** : badge "INFO — Envoi en cours (Autopilot)".
3. **Intent INFORMATION + last_outbound.type === "info_reply"** : badge "INFO — Réponse envoyée".
4. CTA : "Ajouter à la FAQ" visible ; dans le formulaire, si la question normalisée existe déjà : message "Une entrée avec cette question existe déjà" + bouton "Mettre à jour l'entrée existante".

---

## E) FAQ duplicate protection

1. Ajouter une FAQ "Animaux acceptés ?" / "Oui, chats acceptés.".
2. Sur un lead INFO avec question similaire, cliquer "Ajouter à la FAQ" en gardant la même question (ou une variante qui normalise pareil).
3. **Attendu** : le formulaire propose "Mettre à jour l'entrée existante" au lieu de créer un doublon ; enregistrement met à jour l’entrée existante.

---

## F) Sales wow minis

### Pipeline

1. Lead LOCATION avec loyer connu (bien matché ou `lead_json.rent` renseigné).
2. **Attendu** : badge "Loyer: xxx€" affiché dans la ligne de la table Pipeline.

### Détails LOCATION

1. Ouvrir un lead LOCATION avec revenus et loyer connus.
2. **Attendu** : bloc Solvabilité affiche clairement "Règle agence : revenus nets ≥ loyer × {multiplier}" et "Verdict: OK" ou "Verdict: Sous le seuil".

---

## Récap 6 tests

| # | Type    | Test |
|---|--------|------|
| 1 | LOCATION | Intent override : email "je souhaite visiter" → LOCATION |
| 2 | LOCATION | Pipeline : badge Loyer xxx€ si property_rent connu |
| 3 | LOCATION | Détails : règle income_multiplier + verdict affichés |
| 4 | INFO     | Badge INFO — Brouillon prêt / Envoi en cours / Réponse envoyée |
| 5 | INFO     | CTA Ajouter à la FAQ + Mettre à jour l'entrée existante si doublon |
| 6 | INFO     | FAQ match quality (mots ≥ 4 lettres, stopwords, pas de collision charges) |

---

## Fichiers modifiés (Phase 6)

| Fichier | Changement |
|---------|------------|
| `app/api/ai/analyze-inbox/route.ts` | Intent override LOCATION (regex keywords) ; `setLastAction` pour info |
| `lib/faq/matchFaq.ts` | Scoring (exact + rare), tokens ≥ 4 + stopwords FR, `topCandidates` si showDebug, `normalizeFaqQuestion` export |
| `lib/lead/lastAction.ts` | Nouveau : `setLastAction(leadJson, { type, label }, nowIso)` |
| `app/api/ai/generate-reply/route.ts` | Utilisation de `setLastAction` pour branche INFORMATION |
| `components/emails/EmailDetailPanel.tsx` | Badges INFO (Brouillon prêt / Envoi en cours / Réponse envoyée) ; CTA FAQ + doublon "Mettre à jour l'entrée existante" ; Solvabilité règle + verdict |
| `lib/pipeline/derivePipelineRow.ts` | `property_rent` (rent / matched_property.rent) ; type PipelineRow étendu |
| `components/pipeline/PipelineTable.tsx` | Badge "Loyer: xxx€" si `row.property_rent` |
| `app/api/leads/send-proposal/route.ts` | `last_action` dans draft proposal (Brouillon prêt) |
