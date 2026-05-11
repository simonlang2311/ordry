"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Logo, useBranding } from '@/components/Branding';
import { usePersonalAuth } from "@/lib/usePersonalAuth";
import { DEFAULT_RESTAURANT_FEATURES, RestaurantFeatures, loadRestaurantFeatures } from "@/lib/features";
import { supabase } from "@/lib/supabase";

type IconName = "guest" | "staff" | "bar" | "kitchen" | "waiter" | "admin";

type RestaurantTable = {
  label: string;
};

function InfoHint({ text, light = false }: { text: string; light?: boolean }) {
  return (
    <span className="relative inline-flex group/info">
      <button
        type="button"
        aria-label={text}
        className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold transition-colors ${
          light
            ? "border-white/25 text-white/75 hover:bg-white/15 focus:bg-white/15"
            : "border-app-primary/20 text-app-muted hover:bg-app-primary/10 focus:bg-app-primary/10"
        }`}
      >
        i
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 top-8 z-30 w-64 -translate-x-1/2 rounded-lg px-3 py-2 text-xs leading-relaxed opacity-0 shadow-xl transition-opacity group-hover/info:opacity-100 group-focus-within/info:opacity-100 ${
          light ? "bg-white text-app-text" : "bg-app-text text-white"
        }`}
      >
        {text}
      </span>
    </span>
  );
}

function LineIcon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths: Record<IconName, React.ReactNode> = {
    guest: (
      <>
        <path d="M8 19h8" {...common} />
        <path d="M12 15v4" {...common} />
        <path d="M7 5h10l-1 8H8L7 5Z" {...common} />
        <path d="M6 8H4.8a2.2 2.2 0 0 0 0 4.4H7" {...common} />
        <path d="M18 8h1.2a2.2 2.2 0 0 1 0 4.4H17" {...common} />
      </>
    ),
    staff: (
      <>
        <path d="M7 20V8.5a5 5 0 0 1 10 0V20" {...common} />
        <path d="M5 20h14" {...common} />
        <path d="M9 11h6" {...common} />
        <path d="M10 15h4" {...common} />
      </>
    ),
    bar: (
      <>
        <path d="M7 4h10l-1.4 7.5a3.7 3.7 0 0 1-7.2 0L7 4Z" {...common} />
        <path d="M12 15v5" {...common} />
        <path d="M9 20h6" {...common} />
        <path d="M8.2 8h7.6" {...common} />
      </>
    ),
    kitchen: (
      <>
        <path d="M7 4v16" {...common} />
        <path d="M5 4v5a2 2 0 0 0 4 0V4" {...common} />
        <path d="M15 4v16" {...common} />
        <path d="M15 4c2.4 1 3.8 3.1 3.8 5.8 0 2.4-1.3 4.1-3.8 4.8" {...common} />
      </>
    ),
    waiter: (
      <>
        <path d="M5 12h14" {...common} />
        <path d="M7 12a5 5 0 0 1 10 0" {...common} />
        <path d="M12 5V3.5" {...common} />
        <path d="M8 17h8" {...common} />
        <path d="M6 20h12" {...common} />
      </>
    ),
    admin: (
      <>
        <path d="M12 4.5 18 7v4.5c0 4-2.5 7-6 8-3.5-1-6-4-6-8V7l6-2.5Z" {...common} />
        <path d="M9.5 12.2 11.4 14l3.4-4" {...common} />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      {paths[name]}
    </svg>
  );
}

export default function RestaurantPage() {
  const params = useParams();
  const router = useRouter();
  const restaurantId = typeof params?.restaurantId === "string" ? params.restaurantId : "";
  const [tableInput, setTableInput] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [features, setFeatures] = useState<RestaurantFeatures>(DEFAULT_RESTAURANT_FEATURES);
  const [restaurantName, setRestaurantName] = useState("");
  const [tableSuggestions, setTableSuggestions] = useState<string[]>([]);
  const { branding } = useBranding();
  const { isAuthenticated, isAuthInitialized, handlePasswordSubmit, logout } = usePersonalAuth();

  const restaurantPath = (path: string) => `/${encodeURIComponent(restaurantId)}${path}`;

  useEffect(() => {
    let isActive = true;

    const loadFeatures = async () => {
      const nextFeatures = await loadRestaurantFeatures(restaurantId);
      if (isActive) setFeatures(nextFeatures);
    };

    const loadRestaurantName = async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .maybeSingle();

      if (error) {
        console.error("Restaurantname konnte nicht geladen werden:", error);
        return;
      }

      if (isActive) setRestaurantName(data?.name?.trim() || "");
    };

    const loadTableSuggestions = async () => {
      const { data, error } = await supabase
        .from("tables")
        .select("label")
        .eq("restaurant_id", restaurantId)
        .order("label", { ascending: true });

      if (error) {
        console.error("Tischvorschläge konnten nicht geladen werden:", error);
        return;
      }

      if (!isActive) return;

      const labels = (data as RestaurantTable[] | null || [])
        .map((table) => table.label)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .slice(0, 3);

      setTableSuggestions(labels);
    };

    if (restaurantId) void loadFeatures();
    if (restaurantId) void loadRestaurantName();
    if (restaurantId) void loadTableSuggestions();

    return () => {
      isActive = false;
    };
  }, [restaurantId]);

  const handleTableRedirect = (e: React.FormEvent) => {
    e.preventDefault();
    if (tableInput.trim()) {
      router.push(restaurantPath(`/t/${encodeURIComponent(tableInput.trim())}`));
    } else {
      alert("Bitte eine Tischnummer eingeben!");
    }
  };

  const handlePasswordForm = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");

    if (!password) {
      setPasswordError("Passwort erforderlich");
      return;
    }

    if (handlePasswordSubmit(password)) {
      setPassword("");
    } else {
      setPasswordError("Passwort falsch");
      setPassword("");
    }
  };

  const handlePersonalButton = (path: string) => {
    router.push(path);
  };

  const showPersonalActions = isAuthInitialized && isAuthenticated;
  const showPersonalLogin = isAuthInitialized && !isAuthenticated;
  const showPersonalPreview = !isAuthInitialized;

  const personalActionItems = [
    { label: 'Bar Display', description: 'Getränke & Ausgabe', icon: 'bar' as const, path: restaurantPath('/bar') },
    { label: 'Küche Display', description: 'Bestellungen abarbeiten', icon: 'kitchen' as const, path: restaurantPath('/kitchen') },
    { label: 'Kellner / Saalplan', description: 'Abrechnung & Status', icon: 'waiter' as const, path: restaurantPath('/waiter') },
    { label: 'Admin Panel', description: 'Einstellungen & Menu', icon: 'admin' as const, path: restaurantPath('/admin') },
  ];

  const gridContent = (
    <>
      <div className="bg-app-card border border-app-primary/15 p-6 sm:p-8 rounded-2xl shadow-lg shadow-app-text/5 transition-all group">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-app-primary/10 text-app-primary">
              <LineIcon name="guest" className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-app-text">Gast-Zugang</h2>
            </div>
          </div>
          <InfoHint text="Simuliere einen Gast, der den QR-Code scannt. Gib eine Tischnummer ein, um die Speisekarte zu öffnen." />
        </div>

        <form onSubmit={handleTableRedirect} className="flex flex-col sm:flex-row gap-3">
          <div className="relative w-full">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-app-muted font-bold">Tisch</span>
            <input 
              type="text" 
              placeholder="Nr. oder Label" 
              className="w-full bg-app-bg border border-app-primary/20 rounded-xl pl-16 pr-4 py-4 text-xl font-bold text-app-text focus:border-app-primary focus:ring-4 focus:ring-app-primary/10 outline-none transition-all placeholder-app-muted/70"
              value={tableInput}
              onChange={(e) => setTableInput(e.target.value)}
              autoFocus
            />
          </div>
          <button 
            type="submit"
            className="bg-app-primary hover:brightness-95 text-white font-bold px-8 py-4 rounded-xl text-lg transition-transform active:scale-95 shadow-lg shadow-app-primary/20 flex items-center justify-center gap-2"
          >
            <span>Los</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
          </button>
        </form>
        
        {/* Quick Links */}
        {tableSuggestions.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2 justify-center sm:justify-start mb-4">
          <span className="text-xs text-app-muted py-1">Schnellwahl:</span>
          {tableSuggestions.map(label => (
            <button
              key={label}
              onClick={() => router.push(restaurantPath(`/t/${encodeURIComponent(label)}`))}
              className="text-xs bg-app-bg hover:bg-app-primary hover:text-white border border-app-primary/20 px-3 py-1 rounded-full text-app-muted transition-colors font-medium"
            >
              Tisch {label}
            </button>
          ))}
        </div>
        )}

        <button 
          onClick={() => router.push(restaurantPath(`/available-tables`))}
          disabled={!showPersonalActions}
          className="w-full bg-app-primary hover:brightness-95 disabled:bg-app-muted/30 disabled:text-app-muted disabled:cursor-not-allowed text-white border border-app-primary/30 font-bold py-3 rounded-xl transition-all flex items-center justify-between px-4"
        >
          <span>Verfügbare Tische</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        </button>

        {features.reservationsEnabled && (
          <button 
            onClick={() => router.push(restaurantPath(`/reservations`))}
            disabled={!showPersonalActions}
            className="w-full bg-app-primary hover:brightness-95 disabled:bg-app-muted/30 disabled:text-app-muted disabled:cursor-not-allowed text-white border border-app-primary/30 font-bold py-3 rounded-xl transition-all flex items-center justify-between px-4 mt-2"
          >
            <span>Smart Booking</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </button>
        )}
      </div>

      {/* --- RECHTS: PERSONAL (Blau Branding) --- */}
      {showPersonalActions ? (
        <div className="bg-app-primary text-white p-6 sm:p-8 rounded-2xl shadow-lg shadow-app-primary/15 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-3 mb-8">
            <div className="flex items-center gap-3">
             <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-white">
              <LineIcon name="staff" className="h-7 w-7" />
             </div>
             <div>
                <h2 className="text-2xl font-bold">Personal-Bereich</h2>
             </div>
            </div>
            <InfoHint text="Zugänge für Bar, Küche, Service und Administration." light />
          </div>
          <div className="space-y-4">
            {personalActionItems.map((item) => (
              <div key={item.path} className="relative">
                <button
                  onClick={() => handlePersonalButton(item.path)}
                  className="w-full bg-white/10 hover:bg-white/20 hover:backdrop-blur-md transition-all p-4 pr-24 rounded-xl border border-white/10 text-left flex items-center justify-between group/btn"
                >
                  <div className="flex items-center gap-3">
                    <span className="bg-white/10 w-10 h-10 flex items-center justify-center rounded-lg">
                      <LineIcon name={item.icon} className="h-6 w-6" />
                    </span>
                    <div>
                      <div className="font-bold text-lg">{item.label}</div>
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 opacity-50 group-hover/btn:opacity-100 group-hover/btn:translate-x-1 transition-all"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>
                <span className="absolute right-12 top-1/2 -translate-y-1/2">
                  <InfoHint text={item.description} light />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : showPersonalLogin ? (
        /* PASSWORT-BEREICH */
        <div className="bg-app-primary text-white p-6 sm:p-8 rounded-2xl shadow-lg shadow-app-primary/15 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-3 mb-8">
            <div className="flex items-center gap-3">
             <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-white">
              <LineIcon name="staff" className="h-7 w-7" />
             </div>
             <div>
                <h2 className="text-2xl font-bold">Personal-Bereich</h2>
             </div>
            </div>
            <InfoHint text="Melde dich an, um die internen Bereiche zu öffnen." light />
          </div>

          <form onSubmit={handlePasswordForm} className="space-y-4">
            <div>
              <label className="text-sm font-bold text-white/80 uppercase mb-2 block">
                Passwort
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Passwort eingeben"
                  autoFocus
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 pr-12 text-white outline-none focus:border-white focus:ring-4 focus:ring-white/20 transition-all placeholder-white/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-white/75 hover:bg-white/15 hover:text-white"
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

            {passwordError && (
              <div className="bg-red-500/30 border border-red-400 text-red-100 px-4 py-3 rounded-lg text-sm font-medium">
                {passwordError}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-white text-app-primary font-bold py-3 rounded-lg hover:bg-white/90 transition-colors active:scale-95 shadow-lg"
            >
              Anmelden
            </button>

            <div className="flex items-center justify-center gap-2 pt-1 text-sm font-medium text-white/75">
              <span>Passwort vergessen?</span>
              <InfoHint text="Bitte kontaktiere dafür den Kundensupport von ordry." light />
            </div>
          </form>
        </div>
      ) : showPersonalPreview ? (
        <div className="bg-app-primary text-white p-6 sm:p-8 rounded-2xl shadow-lg shadow-app-primary/15 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-3 mb-8">
            <div className="flex items-center gap-3">
             <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-white">
              <LineIcon name="staff" className="h-7 w-7" />
             </div>
             <div>
                <h2 className="text-2xl font-bold">Personal-Bereich</h2>
             </div>
            </div>
            <InfoHint text="Zugänge für Bar, Küche, Service und Administration." light />
          </div>

          <div className="space-y-4 opacity-90">
            {personalActionItems.map((item) => (
              <div
                key={item.path}
                className="w-full bg-white/10 p-4 rounded-xl border border-white/10 text-left flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-white/10 w-10 h-10 flex items-center justify-center rounded-lg">
                    <LineIcon name={item.icon} className="h-6 w-6" />
                  </span>
                  <div>
                    <div className="font-bold text-lg">{item.label}</div>
                  </div>
                </div>
                <span className="flex items-center gap-3">
                  <InfoHint text={item.description} light />
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 opacity-50"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="min-h-screen bg-app-bg text-app-text flex flex-col items-center justify-center p-4 pb-14 font-sans relative overflow-hidden">
      {showPersonalActions && (
        <button
          type="button"
          onClick={logout}
          className="absolute left-4 top-4 z-20 rounded-xl border border-app-primary/20 bg-app-card px-4 py-2 text-sm font-bold text-app-text shadow-lg shadow-app-text/5 transition-colors hover:bg-app-primary hover:text-white"
        >
          Logout
        </button>
      )}

      {/* LOGO AREA */}
      <div className="relative z-10 text-center mb-10">
        <div className="flex justify-center mb-4">
          <div className="hero-logo-shell hover:scale-105 transition-transform duration-500 drop-shadow-sm">
            <Logo width={120} height={80} priority />
          </div>
        </div>
        
        <h1 className="text-3xl sm:text-5xl font-bold tracking-normal text-app-text mt-3">
          {restaurantName || branding.appName || "Restaurant"}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl relative z-10">
        {gridContent}
      </div>

      <a
        href="https://ordry.eu"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-4 text-app-muted text-sm font-medium opacity-70 transition-opacity hover:opacity-100"
      >
        ordry.eu
      </a>
    </div>
  );
}
