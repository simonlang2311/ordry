"use client";

import { ReactNode, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ADMIN_DASHBOARD_AUTH_DURATION,
  ADMIN_DASHBOARD_PASSWORD_KEY,
  ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY,
  DEFAULT_ADMIN_DASHBOARD_PASSWORD_REQUIRED,
  DEFAULT_ADMIN_DASHBOARD_PASSWORD,
  getAdminDashboardAuthKey,
} from "@/lib/adminDashboardPassword";

type AdminDashboardGateProps = {
  children: ReactNode;
  restaurantId: string;
  homeHref: string;
};

export default function AdminDashboardGate({ children, restaurantId, homeHref }: AdminDashboardGateProps) {
  const [expectedPassword, setExpectedPassword] = useState(DEFAULT_ADMIN_DASHBOARD_PASSWORD);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let isActive = true;

    const loadPassword = async () => {
      const authKey = getAdminDashboardAuthKey(restaurantId);
      const storedExpiry = Number(localStorage.getItem(authKey) || "0");
      if (storedExpiry > Date.now()) setIsUnlocked(true);

      if (!restaurantId) {
        if (isActive) setIsInitialized(true);
        return;
      }

      const { data } = await supabase
        .from("settings")
        .select("key, value")
        .eq("restaurant_id", restaurantId)
        .in("key", [ADMIN_DASHBOARD_PASSWORD_KEY, ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY]);

      if (!isActive) return;
      const passwordSetting = data?.find((setting) => setting.key === ADMIN_DASHBOARD_PASSWORD_KEY);
      const requiredSetting = data?.find((setting) => setting.key === ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY);
      const isRequired = requiredSetting?.value ? requiredSetting.value !== "false" : DEFAULT_ADMIN_DASHBOARD_PASSWORD_REQUIRED;

      setExpectedPassword(passwordSetting?.value || DEFAULT_ADMIN_DASHBOARD_PASSWORD);
      if (!isRequired) setIsUnlocked(true);
      setIsInitialized(true);
    };

    void loadPassword();

    return () => {
      isActive = false;
    };
  }, [restaurantId]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (password.trim() === expectedPassword.trim()) {
      localStorage.setItem(getAdminDashboardAuthKey(restaurantId), String(Date.now() + ADMIN_DASHBOARD_AUTH_DURATION));
      setIsUnlocked(true);
      setPassword("");
      return;
    }

    setError("Admin-Passwort falsch");
    setPassword("");
  };

  if (!isInitialized) {
    return <div className="min-h-screen bg-app-bg" />;
  }

  if (isUnlocked) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#275D7B] text-white flex items-center justify-center p-4">
      <div className="bg-[#1e4a62] rounded-2xl shadow-2xl w-full max-w-md p-8 border border-white/10">
        <div className="mb-8">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-lg font-black">A</div>
          <h2 className="text-2xl font-bold">Admin-Dashboard</h2>
          <p className="mt-1 text-sm text-blue-100">Zusätzliches Passwort erforderlich</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-bold text-blue-100 uppercase mb-2 block">Admin-Passwort</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Passwort eingeben"
                autoFocus
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 pr-12 text-white outline-none focus:border-white focus:ring-4 focus:ring-white/20 transition-all placeholder-blue-200/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-blue-100 hover:bg-white/15 hover:text-white"
                aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                title={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPassword && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </div>
          </div>

          {error && <div className="rounded-lg border border-red-400 bg-red-500/30 px-4 py-3 text-sm font-medium text-red-100">{error}</div>}

          <button type="submit" className="w-full bg-white text-[#275D7B] font-bold py-3 rounded-lg hover:bg-blue-50 transition-colors active:scale-95 shadow-lg">
            Admin öffnen
          </button>
          <a href={homeHref} className="block w-full rounded-lg border border-white/20 bg-white/10 py-3 text-center font-bold text-white transition-colors hover:bg-white/20">
            Zurück
          </a>
        </form>
      </div>
    </div>
  );
}
