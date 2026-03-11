import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // @supabase/ssr v0.5+ utilise getAll / setAll
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // L'écriture de cookies n'est autorisée que dans les Route Handlers
          // et les Server Actions — pas depuis un Server Component (pages).
          // On wrap dans un try/catch pour ignorer silencieusement les erreurs
          // de contexte Server Component : la lecture reste fonctionnelle
          // et le token sera rafraîchi au prochain appel via un Route Handler.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Contexte Server Component — écriture de cookies non autorisée, on ignore.
          }
        },
      },
    }
  );
}
