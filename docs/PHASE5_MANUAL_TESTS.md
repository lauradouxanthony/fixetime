# Phase 5 — Tests manuels (INFORMATION + last_action)

## 1) INFORMATION + FAQ match

- **Prérequis** : Au moins une entrée dans Paramètres → FAQ agence (ex. Q: "Animaux acceptés ?", R: "Oui, chats et petits chiens acceptés.").
- **Intent** : Un email entrant dont l’analyse donne `intent=INFORMATION` (ex. "Animaux acceptés ?").
- **Draft** :
  - Déclencher l’analyse (ou "Générer brouillon" sur ce lead).
  - Vérifier que le brouillon contient la réponse FAQ (ex. "Oui, chats et petits chiens acceptés.") + ton agent.
  - Pipeline : dernière action affichée du type "Brouillon réponse FAQ" ou "Réponse FAQ envoyée il y a X min" après envoi.
- **Autopilot** :
  - Même scénario avec mode Autopilot activé.
  - Vérifier que l’email est envoyé automatiquement (pas de brouillon).
  - Pipeline : "Réponse FAQ envoyée il y a X min".

## 2) INFORMATION + NO FAQ

- **Prérequis** : Aucune FAQ ne correspond à la question (ex. question très spécifique ou nouvelle).
- **Draft** :
  - Brouillon = demande de précision (ex. "Je n'ai pas trouvé la règle correspondante… Pouvez-vous préciser…").
  - Pas de réponse inventée.
  - CTA "Ajouter à la FAQ" fonctionne (ouvre le formulaire, enregistre en `settings.config.faq_items`).
- **Autopilot** :
  - Même demande de précision envoyée automatiquement.
  - Pas d’invention de règle.

## 3) LOCATION inchangé

- Générer des créneaux → slots affichés, dernière action "Créneaux générés".
- Envoyer proposition → email 1/2/3 envoyé, dernière action "Proposition envoyée".
- Réponse prospect "2" → confirmation créneau, événement calendrier, dernière action "Visite confirmée".
- Aucune régression sur le flux LOCATION (slots, proposal, booking).

## Champs vérifiés

- `lead_json.info_source` : "FAQ" | "MISSING_FAQ".
- `lead_json.info_question` : extrait court de la question.
- `lead_json.last_action` : `{ type, at, label }` mis à jour à chaque action (draft_info_reply, info_answered, proposal_sent, booked, slots_generated, etc.).
- Pipeline : colonne "Dernière action" lue depuis `lead_json.last_action.label` (ou fallback ancien).
