"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

/**
 * Souscrit aux changements temps réel sur la table emails pour un user_id.
 * Déclenche onUpdate (ex: mutate SWR) à chaque INSERT/UPDATE.
 * Si le client Supabase n'est pas dispo, ne fait rien (pas de polling de secours).
 */
export function usePipelineRealtime(userId: string | null, onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!userId) return;
    const client = typeof supabaseBrowser === "function" ? supabaseBrowser() : supabaseBrowser;
    if (!client) return;

    const channel = client
      .channel("pipeline-emails")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "emails",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          onUpdateRef.current();
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [userId]);
}
