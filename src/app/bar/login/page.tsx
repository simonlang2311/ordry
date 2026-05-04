"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BarLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = () => {
    if (password === "schnitzel") {
      document.cookie = "is-chef=true; path=/; max-age=86400; SameSite=Lax";
      setError("Erfolgreich! Weiterleitung...");
      window.location.href = "/bar";
    } else {
      setError("Das war leider falsch. Bitte nochmal versuchen.");
      setPassword("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-4">
      <div className="w-full max-w-md bg-slate-800 p-8 rounded-2xl border border-slate-700 text-center shadow-2xl">
        <h2 className="text-3xl font-bold mb-2">Bar-Login</h2>
        <p className="text-slate-400 mb-6 text-sm">Nur für Personal</p>

        <div className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error && !error.includes("Erfolgreich")) setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            className="w-full rounded-lg bg-slate-900 border border-slate-600 p-3 text-white text-center text-lg focus:ring-2 focus:ring-blue-500 outline-none placeholder-slate-600 transition-all"
            placeholder="Passwort eingeben..."
          />

          {error && (
            <div
              className={`text-sm font-bold p-2 rounded border ${
                error.includes("Erfolgreich")
                  ? "text-green-400 bg-green-900/20 border-green-900/50"
                  : "text-red-400 bg-red-900/20 border-red-900/50"
              }`}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-all active:scale-[0.98] shadow-lg shadow-blue-900/20"
          >
            Anmelden
          </button>
        </div>
      </div>
    </div>
  );
}
