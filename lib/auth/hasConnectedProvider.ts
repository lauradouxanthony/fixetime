import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Retourne true si l'utilisateur a au moins un provider connecté (Gmail ou Outlook).
 * Utilisé pour rediriger vers /onboarding si aucun token.
 */
export async function hasConnectedProvider(userId: string): Promise<boolean> {
  const [gmail, microsoft] = await Promise.all([
    supabaseAdmin
      .from("gmail_tokens")
      .select("id, user_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("microsoft_tokens")
      .select("id, user_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);

  const hasGmail = !!(gmail.data?.user_id || gmail.data?.id);
  const hasMicrosoft = !!(microsoft.data?.user_id || microsoft.data?.id);

  return hasGmail || hasMicrosoft;
}

