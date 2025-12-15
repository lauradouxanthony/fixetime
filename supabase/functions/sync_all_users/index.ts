// supabase/functions/sync_all_users/index.ts

// Cette fonction synchronise TOUS les utilisateurs ayant connecté Google
// Et appelle ton endpoint /api/sync/all pour chacun.

import { serve } from "https://deno.land/x/sift@0.7.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req) => {
  try {
    console.log("🔄 Lancement CRON — Sync all users");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // ⚠️ service role
    );

    // 1) Récupérer tous les utilisateurs ayant un token Google
    const { data: tokens, error } = await supabase
      .from("gmail_tokens")
      .select("user_id");

    if (error) {
      console.error("DB_ERROR:", error);
      return new Response("DB ERROR", { status: 500 });
    }

    if (!tokens || tokens.length === 0) {
      console.log("Aucun utilisateur à synchroniser.");
      return new Response("OK");
    }

    console.log(`➡️ ${tokens.length} utilisateurs trouvés.`);

    // 2) Appeler /api/sync/all pour CHAQUE utilisateur
    for (const row of tokens) {
      const userId = row.user_id;

      console.log(`Sync user: ${userId}`);

      // On génère un JWT impersonnel pour appeler l'API côté Next.js
      const jwt = supabase.auth.admin.generateLink({
        type: "magiclink",
        email: "fake@example.com",
      });

      await fetch(`${Deno.env.get("APP_URL")}/api/sync/all`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt.data?.properties?.token ?? ""}`,
        },
      });
    }

    return new Response("CRON SYNC DONE");
  } catch (err) {
    console.error("CRON_ERROR:", err);
    return new Response("ERROR", { status: 500 });
  }
});
