"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ProtectedRoute } from "@/components/ProtectedRoute";

function SettingsContent() {
  const [drinksTarget, setDrinksTarget] = useState<"bar" | "kitchen">("bar");
  const [allergensEnabled, setAllergensEnabled] = useState(true);
  const [allergensDisabledNotice, setAllergensDisabledNotice] = useState("");
  const [showDrinksSection, setShowDrinksSection] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [showRestaurantLinkSection, setShowRestaurantLinkSection] = useState(false);
  const [showAllergensSection, setShowAllergensSection] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [restaurantLink, setRestaurantLink] = useState("");
  const [savedRestaurantLink, setSavedRestaurantLink] = useState("");
  const [restaurantLinkError, setRestaurantLinkError] = useState("");
  const [restaurantLinkStatus, setRestaurantLinkStatus] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const loadSettings = async () => {
      const { data } = await supabase
        .from("settings")
        .select("key, value")
        .in("key", ["drinks_target", "personal_password", "restaurant_link", "allergens_enabled", "allergens_disabled_notice"])
        .eq("restaurant_id", process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'demo-restaurant-1');

      data?.forEach((setting) => {
        if (setting.key === "drinks_target" && (setting.value === "bar" || setting.value === "kitchen")) {
          setDrinksTarget(setting.value);
        }
        if (setting.key === "allergens_enabled") {
          setAllergensEnabled(setting.value !== "false");
        }
        if (setting.key === "restaurant_link") {
          const value = (setting.value || "").trim();
          setRestaurantLink(value);
          setSavedRestaurantLink(value);
        }
        if (setting.key === "allergens_disabled_notice") {
          setAllergensDisabledNotice(setting.value || "");
        }
      });
    };

    loadSettings();
  }, []);

  const saveDrinksTarget = async (value: "bar" | "kitchen") => {
    setDrinksTarget(value);
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "drinks_target", value, restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'demo-restaurant-1' }, { onConflict: "key,restaurant_id" });

    if (error) {
      setStatus("Fehler: " + error.message);
    } else {
      setStatus("Getränke-Zuordnung gespeichert");
      setTimeout(() => setStatus(""), 2000);
    }
  };

  const savePassword = async () => {
    if (!password || password.length < 4) {
      setStatus("Passwort zu kurz");
      return;
    }
    if (password !== passwordConfirm) {
      setStatus("Passwörter stimmen nicht überein");
      return;
    }

    const { error } = await supabase
      .from("settings")
      .upsert({ key: "personal_password", value: password, restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'demo-restaurant-1' }, { onConflict: "key,restaurant_id" });

    if (error) {
      setStatus("Fehler: " + error.message);
    } else {
      setStatus("Passwort gespeichert");
      setPassword("");
      setPasswordConfirm("");
      setTimeout(() => setStatus(""), 2000);
    }
  };

  const saveRestaurantLink = async () => {
    setRestaurantLinkError("");
    setRestaurantLinkStatus("");

    const trimmedLink = restaurantLink.trim();

    if (!trimmedLink) {
      setRestaurantLinkError("Link kann nicht leer sein");
      return;
    }

    // Validiere URL-Format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedLink);
    } catch {
      setRestaurantLinkError("Ungültiges URL-Format (z.B. https://example.com)");
      return;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      setRestaurantLinkError("Bitte eine gültige http:// oder https:// URL eingeben");
      return;
    }

    const { error } = await supabase
      .from("settings")
      .upsert({ key: "restaurant_link", value: trimmedLink, restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'demo-restaurant-1' }, { onConflict: "key,restaurant_id" });

    if (error) {
      setRestaurantLinkError("Fehler: " + error.message);
    } else {
      setRestaurantLink(trimmedLink);
      setSavedRestaurantLink(trimmedLink);
      setRestaurantLinkStatus("Restaurant-Link gespeichert");
      setTimeout(() => setRestaurantLinkStatus(""), 2000);
    }
  };

  const saveAllergensEnabled = async (value: boolean) => {
    setAllergensEnabled(value);
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "allergens_enabled", value: String(value), restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'demo-restaurant-1' }, { onConflict: "key,restaurant_id" });

    if (error) {
      setStatus("Fehler: " + error.message);
    } else {
      setStatus(value ? "Allergene aktiviert" : "Allergene deaktiviert");
      setTimeout(() => setStatus(""), 2000);
    }
  };

  const saveAllergensDisabledNotice = async () => {
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "allergens_disabled_notice", value: allergensDisabledNotice, restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'demo-restaurant-1' }, { onConflict: "key,restaurant_id" });

    if (error) {
      setStatus("Fehler: " + error.message);
    } else {
      setStatus("Hinweistext gespeichert");
      setTimeout(() => setStatus(""), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text p-8 transition-colors duration-500 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black mb-2">Einstellungen</h1>
            <p className="text-app-muted">Systemverhalten und Zugang verwalten.</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="bg-app-card text-app-text border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/20 transition-colors">Home</a>
            <Link href="/admin" className="bg-app-card text-app-text border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/20 transition-colors">
              ← Dashboard
            </Link>
          </div>
        </header>

        {status && (
          <div className="mb-6 bg-app-card border border-app-muted/20 rounded-lg p-3 text-sm">
            {status}
          </div>
        )}

        <div className="space-y-2.5">
          <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDrinksSection(!showDrinksSection)}
              className="flex w-full items-center justify-between px-6 py-5 text-left"
              aria-expanded={showDrinksSection}
            >
              <div>
                <h2 className="text-xl font-bold mb-1">Getränke-Zuordnung</h2>
                <p className="text-sm text-app-muted">Lege fest, ob Getränke in der Bar oder Küche landen.</p>
              </div>
              <span className={`text-2xl text-app-muted transition-transform ${showDrinksSection ? "rotate-180" : ""}`}>⌃</span>
            </button>
            {showDrinksSection && (
              <div className="px-6 pb-6 space-y-3">
                <button
                  onClick={() => saveDrinksTarget("bar")}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    drinksTarget === "bar"
                      ? "bg-app-primary text-white border-app-primary"
                      : "bg-app-bg text-app-text border-app-muted/30 hover:bg-app-muted/10"
                  }`}
                >
                  Bar (Getränke erscheinen in /bar)
                </button>
                <button
                  onClick={() => saveDrinksTarget("kitchen")}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    drinksTarget === "kitchen"
                      ? "bg-app-primary text-white border-app-primary"
                      : "bg-app-bg text-app-text border-app-muted/30 hover:bg-app-muted/10"
                  }`}
                >
                  Küche (Getränke erscheinen in /kitchen)
                </button>
              </div>
            )}
          </div>

          <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPasswordSection(!showPasswordSection)}
              className="flex w-full items-center justify-between px-6 py-5 text-left"
              aria-expanded={showPasswordSection}
            >
              <div>
                <h2 className="text-xl font-bold mb-1">Personal-Passwort</h2>
                <p className="text-sm text-app-muted">Ändere das Passwort für den Personalbereich.</p>
              </div>
              <span className={`text-2xl text-app-muted transition-transform ${showPasswordSection ? "rotate-180" : ""}`}>⌃</span>
            </button>
            {showPasswordSection && (
              <div className="px-6 pb-6 space-y-3">
                <input
                  type="password"
                  placeholder="Neues Passwort"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-primary"
                />
                <input
                  type="password"
                  placeholder="Passwort bestätigen"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-primary"
                />
                <button
                  onClick={savePassword}
                  className="w-full bg-app-accent text-white font-bold py-3 rounded-xl hover:brightness-110 transition-colors"
                >
                  Passwort speichern
                </button>
              </div>
            )}
          </div>

          <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRestaurantLinkSection(!showRestaurantLinkSection)}
              className="flex w-full items-center justify-between px-6 py-5 text-left"
              aria-expanded={showRestaurantLinkSection}
            >
              <div>
                <h2 className="text-xl font-bold mb-1">Restaurant-Website</h2>
                <p className="text-sm text-app-muted">Für deine Website</p>
              </div>
              <span className={`text-2xl text-app-muted transition-transform ${showRestaurantLinkSection ? "rotate-180" : ""}`}>⌃</span>
            </button>
            {showRestaurantLinkSection && (
              <div className="px-6 pb-6 space-y-3">
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={restaurantLink}
                  onChange={(e) => {
                    setRestaurantLink(e.target.value);
                    if (restaurantLinkError) setRestaurantLinkError("");
                  }}
                  className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-primary"
                />
                {restaurantLinkError && (
                  <div className="text-sm text-red-500 -mt-1">{restaurantLinkError}</div>
                )}
                <button
                  onClick={saveRestaurantLink}
                  className="w-full bg-app-primary text-white font-bold py-3 rounded-xl hover:brightness-110 transition-colors"
                >
                  Link speichern
                </button>
                {restaurantLinkStatus && (
                  <div className="text-sm text-green-600">{restaurantLinkStatus}</div>
                )}
                {savedRestaurantLink && (
                  <div className="mt-2 text-xs text-app-muted break-all">
                    Aktueller Link: <a href={savedRestaurantLink} target="_blank" rel="noopener noreferrer" className="text-app-primary hover:underline">{savedRestaurantLink}</a>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAllergensSection(!showAllergensSection)}
              className="flex w-full items-center justify-between px-6 py-5 text-left"
              aria-expanded={showAllergensSection}
            >
              <div>
                <h2 className="text-xl font-bold mb-1">Allergene</h2>
                <p className="text-sm text-app-muted">Schaltet die Allergen-Funktion global im Admin und auf der Tischansicht ein oder aus.</p>
              </div>
              <span className={`text-2xl text-app-muted transition-transform ${showAllergensSection ? "rotate-180" : ""}`}>⌃</span>
            </button>
            {showAllergensSection && (
              <div className="px-6 pb-6">
                <div className="space-y-4 rounded-2xl border border-app-muted/20 bg-app-bg px-5 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-app-text">Allergene anzeigen & bearbeiten</p>
                      <p className="text-sm text-app-muted">
                        Wenn ausgeschaltet, sind Allergen-Felder im Admin deaktiviert und in der Speisekarte verborgen.
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => saveAllergensEnabled(!allergensEnabled)}
                        className={`relative h-9 w-[72px] rounded-full border transition-all duration-200 ${
                          allergensEnabled
                            ? "border-app-primary/80 bg-app-primary shadow-sm"
                            : "border-app-muted/30 bg-slate-300"
                        }`}
                        aria-label={allergensEnabled ? "Allergene deaktivieren" : "Allergene aktivieren"}
                      >
                        <div
                          className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow-md transition-transform duration-200 ${
                            allergensEnabled ? "translate-x-9" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {!allergensEnabled && (
                    <div className="rounded-xl border border-app-muted/20 bg-white p-4">
                      <label className="mb-2 block text-sm font-bold text-app-text">
                        Hinweistext für die Speisekarte bei deaktivierten Allergenen
                      </label>
                      <textarea
                        value={allergensDisabledNotice}
                        onChange={(e) => setAllergensDisabledNotice(e.target.value)}
                        placeholder="z.B. Informationen zu Allergenen erhalten Sie auf Nachfrage bei unserem Personal."
                        rows={4}
                        className="w-full rounded-lg border border-app-muted/20 bg-app-bg p-3 outline-none focus:border-app-primary"
                      />
                      <button
                        type="button"
                        onClick={saveAllergensDisabledNotice}
                        className="mt-3 w-full rounded-xl bg-app-primary py-3 font-bold text-white hover:brightness-110 transition-colors"
                      >
                        Hinweistext speichern
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsContent />
    </ProtectedRoute>
  );
}
