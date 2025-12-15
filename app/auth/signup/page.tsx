"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSignup() {
    setError("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) return setError(error.message);

    router.push("/home");
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <h1 className="text-2xl font-bold">Créer un compte</h1>

      <input
        type="email"
        className="border p-2 rounded w-64"
        placeholder="Email"
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        className="border p-2 rounded w-64"
        placeholder="Mot de passe"
        onChange={(e) => setPassword(e.target.value)}
      />

      <button onClick={handleSignup} className="bg-green-600 text-white px-4 py-2 rounded">
        S'inscrire
      </button>

      {error && <p className="text-red-500">{error}</p>}

      <a href="/auth/login" className="underline text-sm">
        Déjà un compte ? Se connecter
      </a>
    </div>
  );
}
