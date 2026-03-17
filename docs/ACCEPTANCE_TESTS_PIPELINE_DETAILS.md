# Checklist de test manuel — Pipeline, Détails, Backend

## A) Pipeline (page /pipeline)

1. **Liste**  
   - [ ] Au moins une ligne par candidat (max 20)  
   - [ ] Tri par dernière action (la plus récente en premier)  
   - [ ] Colonnes visibles : Candidat (nom + score), Intent (LOCATION / INFO), Statut, Dernière action  

2. **Filtres**  
   - [ ] Filtre **Intent = INFORMATION** : seuls les leads avec intent INFORMATION s’affichent  
   - [ ] Filtre **Statut = SlotsProposed** : seuls les leads avec `lead_status = slots_proposed`  
   - [ ] Recherche (nom / sujet / email) : la liste se filtre correctement  

3. **Clic ligne**  
   - [ ] Au clic sur une ligne, le panneau de détail à droite s’ouvre sans freeze  
   - [ ] Le contenu du détail correspond au candidat sélectionné  

---

## B) Détails — LOCATION (3 cas)

4. **Lead LOCATION — solvabilité + docs + booking**  
   - [ ] Widget Solvabilité : Revenus, Loyer, règle X×, verdict ou "Loyer manquant"  
   - [ ] Fiche prospect + dossier (documents requis / manquants)  
   - [ ] Zone Créneaux : boutons "Générer des créneaux" et "Envoyer proposition"  
   - [ ] Draft : "Envoyer proposition" crée un brouillon, pas d’envoi direct  
   - [ ] Autopilot : "Envoyer proposition" envoie réellement et track `proposal_slots_sent`  

5. **Confirmation 1/2/3**  
   - [ ] Réponse "2" dans l’inbox → slot 2 confirmé, event calendrier créé, mail de confirmation, `lead_status = booked`  

6. **Prochaine action**  
   - [ ] Avant créneaux : CTA "Générer des créneaux"  
   - [ ] Après créneaux, avant envoi : CTA "Envoyer proposition"  
   - [ ] Après envoi : "Attendre réponse du prospect" + bouton Relancer  
   - [ ] Après booked : "Visite confirmée"  

---

## C) Détails — INFORMATION (3 cas)

7. **Lead INFORMATION — question / réponse / source**  
   - [ ] Section "Assistant information" : question détectée, réponse envoyée/préparée, source (FAQ ou IA)  
   - [ ] CTA "Ajouter à la FAQ" : ouvre le mini-formulaire (question + réponse préremplis)  
   - [ ] Enregistrer : l’item est ajouté à `settings.config.faq_items` et un toast confirme  

8. **Draft vs Autopilot (INFO)**  
   - [ ] Mode Draft : génère un brouillon de réponse (pas d’envoi direct)  
   - [ ] Mode Autopilot : envoie la réponse info et met à jour le suivi  

9. **Pas de debug en prod**  
   - [ ] Le bloc "Dernier appel API" n’apparaît pas si `NEXT_PUBLIC_SHOW_DEBUG !== "true"`  

---

## D) Backend (workflow)

10. **Intent**  
    - [ ] Email du type "Animaux acceptés ?" → après analyse, `lead_json.intent = INFORMATION`  
    - [ ] Email du type "Je veux visiter T2 Rivoli, CDI 3100" → `lead_json.intent = LOCATION`  

11. **LOCATION — loyer manquant**  
    - [ ] Si loyer absent côté bien / lead : demande de complément (ex. brouillon "demander loyer") avant de proposer des créneaux  

12. **LOCATION — flux complet**  
    - [ ] Loyer + infos OK → génération de créneaux (duration, notice, horizon, multi-day depuis settings)  
    - [ ] Proposition 1/2/3 envoyée  
    - [ ] Réponse "2" → créneau confirmé, event créé, mail de confirmation, `lead_status = booked`  

---

## Résumé 6 cas (3 LOCATION, 3 INFO)

| # | Type   | Cas                                      | Critère de succès |
|---|--------|------------------------------------------|-------------------|
| 1 | LOCATION | Générer créneaux                         | Slots affichés, durée/notice/horizon respectés |
| 2 | LOCATION | Envoyer proposition (Draft vs Autopilot) | Draft = brouillon ; Autopilot = envoi + tracking |
| 3 | LOCATION | Réponse "2" → booked                     | Event calendrier + mail confirmation + lead_status=booked |
| 4 | INFO   | Réponse basée FAQ                        | Réponse cohérente, source "FAQ" affichée |
| 5 | INFO   | FAQ manquante → CTA "Ajouter à la FAQ"   | Formulaire prérempli, enregistrement dans settings |
| 6 | INFO   | Draft vs Autopilot                       | Draft = brouillon ; Autopilot = envoi réponse info |
