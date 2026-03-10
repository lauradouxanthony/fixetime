"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleLogin() {
    console.log("➡️ handleLogin called");

    setErrorMsg("");

    console.log("📡 Sending request to Supabase…", email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    console.log("📩 Response from Supabase:", { data, error });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    console.log("✅ Login success — redirecting to /home");

    // IMPORTANT : petit délai pour laisser Supabase créer le cookie
    setTimeout(() => {
      router.push("/home");
    }, 150);
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <img src="/logo-fixtime.png" alt="FixTime" className="h-16 w-auto object-contain mx-auto mb-6" />
      <h1 className="text-2xl font-bold">Connexion</h1>

      <input
        type="email"
        placeholder="Email"
        className="border p-2 rounded w-64"
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        placeholder="Mot de passe"
        className="border p-2 rounded w-64"
        onChange={(e) => setPassword(e.target.value)}
      />

      <button
        onClick={handleLogin}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Se connecter
      </button>

      {errorMsg && <p className="text-red-500">{errorMsg}</p>}

      <a href="/auth/signup" className="underline text-sm">
        Pas encore de compte ? S’inscrire
      </a>
    </div>
  );
}
