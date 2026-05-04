"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Restaurant = {
  id: string;
  name: string;
  slug: string | null;
  created_at?: string;
};

type DefaultTable = {
  restaurant_id: string;
  label: string;
  x: number;
  y: number;
  shape: string;
  level: string;
  seats: number;
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const defaultSettingsFor = (restaurantId: string) => [
  {
    restaurant_id: restaurantId,
    key: "menu_categories",
    value: JSON.stringify([
      { id: "Getränke", label: "Getränke" },
      { id: "Hauptgerichte", label: "Hauptgerichte" },
      { id: "Desserts", label: "Desserts" },
    ]),
  },
  { restaurant_id: restaurantId, key: "theme", value: "ordry" },
  { restaurant_id: restaurantId, key: "font_family", value: "geist" },
  { restaurant_id: restaurantId, key: "allergens_enabled", value: "true" },
  { restaurant_id: restaurantId, key: "drinks_target", value: "bar" },
  { restaurant_id: restaurantId, key: "personal_password", value: "schnitzel" },
  { restaurant_id: restaurantId, key: "app_name", value: "ordry" },
  { restaurant_id: restaurantId, key: "logo_url", value: "" },
];

const defaultTablesFor = (restaurantId: string): DefaultTable[] => [
  { restaurant_id: restaurantId, label: "1", x: 100, y: 100, shape: "round", level: "EG", seats: 4 },
  { restaurant_id: restaurantId, label: "2", x: 220, y: 100, shape: "round", level: "EG", seats: 4 },
  { restaurant_id: restaurantId, label: "3", x: 340, y: 100, shape: "round", level: "EG", seats: 4 },
  { restaurant_id: restaurantId, label: "4", x: 100, y: 240, shape: "square", level: "EG", seats: 6 },
  { restaurant_id: restaurantId, label: "5", x: 240, y: 240, shape: "rect", level: "EG", seats: 8 },
];

const createMissingDefaultTables = async (restaurantId: string) => {
  const standardTables = defaultTablesFor(restaurantId);
  const { data: existingTables, error: existingTablesError } = await supabase
    .from("tables")
    .select("label")
    .eq("restaurant_id", restaurantId);

  if (existingTablesError) {
    return existingTablesError;
  }

  const existingLabels = new Set((existingTables || []).map((table) => table.label));
  const missingTables = standardTables.filter((table) => !existingLabels.has(table.label));

  if (missingTables.length === 0) {
    return null;
  }

  const { error } = await supabase
    .from("tables")
    .insert(missingTables);

  return error;
};

export default function SuperAdminPage() {
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [restaurantSlug, setRestaurantSlug] = useState("");
  const [createStandardTables, setCreateStandardTables] = useState(true);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);

  const suggestedId = useMemo(() => slugify(restaurantName), [restaurantName]);

  const loadRestaurants = async () => {
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, slug, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(`Fehler beim Laden: ${error.message}`);
      return;
    }

    setRestaurants(data || []);
  };

  useEffect(() => {
    void loadRestaurants();
  }, []);

  const createRestaurant = async () => {
    const cleanName = restaurantName.trim();
    const cleanId = slugify(restaurantId || suggestedId);
    const cleanSlug = slugify(restaurantSlug || cleanId);

    if (!cleanName || !cleanId || !cleanSlug) {
      setMessage("Bitte Name und Restaurant-ID ausfüllen.");
      return;
    }

    setCreating(true);
    setMessage("Restaurant wird erstellt...");

    const { error: restaurantError } = await supabase
      .from("restaurants")
      .insert({
        id: cleanId,
        name: cleanName,
        slug: cleanSlug,
      });

    if (restaurantError) {
      setCreating(false);
      setMessage(`Fehler beim Restaurant: ${restaurantError.message}`);
      return;
    }

    const { error: settingsError } = await supabase
      .from("settings")
      .upsert(defaultSettingsFor(cleanId), { onConflict: "restaurant_id,key" });

    if (settingsError) {
      setCreating(false);
      setMessage(`Restaurant erstellt, aber Einstellungen fehlgeschlagen: ${settingsError.message}`);
      return;
    }

    if (createStandardTables) {
      const tablesError = await createMissingDefaultTables(cleanId);

      if (tablesError) {
        setCreating(false);
        setMessage(`Restaurant erstellt, aber Tische fehlgeschlagen: ${tablesError.message}`);
        return;
      }
    }

    setRestaurantName("");
    setRestaurantId("");
    setRestaurantSlug("");
    setCreating(false);
    setMessage(`Restaurant "${cleanName}" erstellt. ID: ${cleanId}`);
    await loadRestaurants();
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text p-8 font-sans">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black">Super Admin</h1>
            <p className="mt-1 text-app-muted">Neue Restaurants mit eigener Supabase restaurant_id anlegen.</p>
          </div>
          <Link href="/" className="rounded-lg border border-app-muted/30 bg-app-card px-4 py-2 font-bold hover:bg-app-muted/10">
            Restaurant-Auswahl
          </Link>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
          <section className="rounded-2xl border border-app-muted/20 bg-app-card p-6 shadow-sm">
            <h2 className="mb-5 text-xl font-bold">Restaurant hinzufügen</h2>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-app-muted">Name</span>
                <input
                  type="text"
                  placeholder="z.B. Pizza Milano"
                  value={restaurantName}
                  onChange={(event) => {
                    setRestaurantName(event.target.value);
                    if (!restaurantId) setRestaurantSlug(slugify(event.target.value));
                  }}
                  className="w-full rounded-lg border border-app-muted/30 bg-app-bg px-4 py-3 outline-none focus:border-app-primary"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-app-muted">Restaurant-ID</span>
                <input
                  type="text"
                  placeholder={suggestedId || "pizza-milano"}
                  value={restaurantId}
                  onChange={(event) => setRestaurantId(slugify(event.target.value))}
                  className="w-full rounded-lg border border-app-muted/30 bg-app-bg px-4 py-3 font-mono outline-none focus:border-app-primary"
                />
                <span className="mt-1 block text-xs text-app-muted">
                  Wird als restaurant_id in Supabase und als URL /{restaurantId || suggestedId || "restaurant-id"} verwendet.
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-app-muted">Slug/Subdomain</span>
                <input
                  type="text"
                  placeholder={restaurantId || suggestedId || "pizza-milano"}
                  value={restaurantSlug}
                  onChange={(event) => setRestaurantSlug(slugify(event.target.value))}
                  className="w-full rounded-lg border border-app-muted/30 bg-app-bg px-4 py-3 font-mono outline-none focus:border-app-primary"
                />
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-app-muted/20 bg-app-bg px-4 py-3">
                <input
                  type="checkbox"
                  checked={createStandardTables}
                  onChange={(event) => setCreateStandardTables(event.target.checked)}
                  className="h-5 w-5 accent-app-primary"
                />
                <span className="font-medium">5 Standard-Tische erstellen</span>
              </label>

              <button
                onClick={createRestaurant}
                disabled={creating}
                className="w-full rounded-lg bg-app-primary px-4 py-3 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? "Erstelle..." : "Restaurant erstellen"}
              </button>

              {message && (
                <div className="rounded-lg border border-app-muted/20 bg-app-bg p-3 text-sm font-medium">
                  {message}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-app-muted/20 bg-app-card p-6 shadow-sm">
            <h2 className="mb-5 text-xl font-bold">Bestehende Restaurants</h2>

            <div className="space-y-3">
              {restaurants.length === 0 ? (
                <p className="text-app-muted">Noch keine Restaurants gefunden.</p>
              ) : (
                restaurants.map((restaurant) => (
                  <div key={restaurant.id} className="flex flex-col gap-3 rounded-xl border border-app-muted/20 bg-app-bg p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-bold">{restaurant.name}</div>
                      <div className="font-mono text-xs text-app-muted">{restaurant.id}</div>
                      {restaurant.slug && <div className="text-xs text-app-muted">Slug: {restaurant.slug}</div>}
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/${restaurant.id}`} className="rounded-lg border border-app-muted/30 bg-app-card px-3 py-2 text-sm font-bold hover:bg-app-muted/10">
                        Öffnen
                      </Link>
                      <Link href={`/${restaurant.id}/admin`} className="rounded-lg bg-app-primary px-3 py-2 text-sm font-bold text-white hover:brightness-95">
                        Admin
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
