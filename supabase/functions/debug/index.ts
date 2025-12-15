// supabase/functions/debug/index.ts

Deno.serve(() => {
  const env = Deno.env.toObject();

  return new Response(
    JSON.stringify(env, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
