"use client";

/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/set-state-in-effect */

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_RESTAURANT_FEATURES,
  RESTAURANT_FEATURES_KEY,
  RestaurantFeatures,
  parseRestaurantFeatures,
  saveRestaurantFeatures,
} from "@/lib/features";
import {
  ADMIN_DASHBOARD_PASSWORD_KEY,
  ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY,
  DEFAULT_ADMIN_DASHBOARD_PASSWORD,
  DEFAULT_ADMIN_DASHBOARD_PASSWORD_REQUIRED,
} from "@/lib/adminDashboardPassword";

type Restaurant = {
  id: string;
  name: string;
  slug?: string | null;
  created_at?: string;
};

type RestaurantOverview = {
  personalPassword: string;
  adminDashboardPassword: string;
  adminDashboardPasswordRequired: boolean;
  tableCount: number;
  lastOrderAt: string | null;
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

const defaultSettingsFor = (restaurantId: string, personalPassword: string) => [
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
  { restaurant_id: restaurantId, key: "personal_password", value: personalPassword },
  { restaurant_id: restaurantId, key: ADMIN_DASHBOARD_PASSWORD_KEY, value: DEFAULT_ADMIN_DASHBOARD_PASSWORD },
  { restaurant_id: restaurantId, key: ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY, value: String(DEFAULT_ADMIN_DASHBOARD_PASSWORD_REQUIRED) },
  { restaurant_id: restaurantId, key: "app_name", value: "ordry" },
  { restaurant_id: restaurantId, key: "logo_url", value: "" },
  { restaurant_id: restaurantId, key: RESTAURANT_FEATURES_KEY, value: JSON.stringify(DEFAULT_RESTAURANT_FEATURES) },
];

const defaultTablesFor = (restaurantId: string): DefaultTable[] => [
  { restaurant_id: restaurantId, label: "1", x: 100, y: 100, shape: "round", level: "EG", seats: 4 },
  { restaurant_id: restaurantId, label: "2", x: 220, y: 100, shape: "round", level: "EG", seats: 4 },
  { restaurant_id: restaurantId, label: "3", x: 340, y: 100, shape: "round", level: "EG", seats: 4 },
  { restaurant_id: restaurantId, label: "4", x: 100, y: 240, shape: "square", level: "EG", seats: 6 },
  { restaurant_id: restaurantId, label: "5", x: 240, y: 240, shape: "rect", level: "EG", seats: 8 },
];

const START_PAGE_SETTINGS_RESTAURANT_ID = "ordry-system";
const START_PAGE_PASSWORD_KEY = "start_page_password";
const DEFAULT_START_PAGE_PASSWORD = "ordry";
const START_PAGE_AUTH_KEY = "ordry_start_page_auth_expiry";
const START_PAGE_AUTH_DURATION = 12 * 60 * 60 * 1000;
const START_PAGE_SETTINGS_TIMEOUT = 3500;

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

const withTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const ensureStartPageSettingsRestaurant = async () => {
  const { error } = await supabase
    .from("restaurants")
    .upsert(
      {
        id: START_PAGE_SETTINGS_RESTAURANT_ID,
        name: "Ordry System",
        slug: START_PAGE_SETTINGS_RESTAURANT_ID,
      },
      { onConflict: "id" }
    );

  return error;
};

const normalizeLogoUrl = (value?: string | null) => {
  const logoUrl = value?.trim();
  if (!logoUrl || logoUrl.startsWith("blob:")) return "";
  if (
    logoUrl.startsWith("/") ||
    logoUrl.startsWith("data:image/") ||
    logoUrl.startsWith("http://") ||
    logoUrl.startsWith("https://")
  ) {
    return logoUrl;
  }
  if (logoUrl.startsWith("public/")) {
    return `/${logoUrl.slice("public/".length)}`;
  }
  return `/${logoUrl}`;
};

const formatLastOrder = (value?: string | null) => {
  if (!value) return "Noch keine Bestellung";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unbekannt";

  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function RestaurantLogoTile({
  logoUrl,
  restaurantName,
}: {
  logoUrl?: string;
  restaurantName: string;
}) {
  const [failedLogoUrl, setFailedLogoUrl] = useState("");
  const normalizedLogoUrl = normalizeLogoUrl(logoUrl);
  const showLogo = normalizedLogoUrl && failedLogoUrl !== normalizedLogoUrl;

  return (
    <div className="bg-white w-16 h-16 rounded-xl flex items-center justify-center font-bold text-lg mb-3 shadow-lg group-hover:scale-110 transition-transform duration-300 overflow-hidden">
      {showLogo ? (
        <img
          src={normalizedLogoUrl}
          alt={`${restaurantName} Logo`}
          className="h-full w-full object-contain p-1"
          loading="lazy"
          onError={() => setFailedLogoUrl(normalizedLogoUrl)}
        />
      ) : (
        <img
          src="/ordry.png"
          alt={`${restaurantName} Standard-Logo`}
          className="h-full w-full object-contain p-1"
          loading="lazy"
        />
      )}
    </div>
  );
}

function OrdryStartLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-white shadow-xl ${className}`}>
      <img
        src="/ordry.png"
        alt="Ordry Logo"
        className="h-full w-full object-cover"
        style={{ objectPosition: "73% 50%" }}
        loading="eager"
      />
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantLogos, setRestaurantLogos] = useState<Record<string, string>>({});
  const [restaurantOverviews, setRestaurantOverviews] = useState<Record<string, RestaurantOverview>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [savingPasswordId, setSavingPasswordId] = useState("");
  const [adminPasswordDrafts, setAdminPasswordDrafts] = useState<Record<string, string>>({});
  const [savingAdminPasswordId, setSavingAdminPasswordId] = useState("");
  const [savingAdminPasswordRequiredId, setSavingAdminPasswordRequiredId] = useState("");
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [restaurantSlug, setRestaurantSlug] = useState("");
  const [restaurantPassword, setRestaurantPassword] = useState("");
  const [createStandardTables, setCreateStandardTables] = useState(true);
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingRestaurantId, setDeletingRestaurantId] = useState("");
  const [renamingRestaurantId, setRenamingRestaurantId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [savingRenameId, setSavingRenameId] = useState("");
  const [restaurantFeatures, setRestaurantFeatures] = useState<Record<string, RestaurantFeatures>>({});
  const [configuringRestaurantId, setConfiguringRestaurantId] = useState("");
  const [featureDraft, setFeatureDraft] = useState<RestaurantFeatures>(DEFAULT_RESTAURANT_FEATURES);
  const [savingFeaturesId, setSavingFeaturesId] = useState("");
  const [startPagePassword, setStartPagePassword] = useState(DEFAULT_START_PAGE_PASSWORD);
  const [startPagePasswordInput, setStartPagePasswordInput] = useState("");
  const [startPagePasswordError, setStartPagePasswordError] = useState("");
  const [startPageAuthInitialized, setStartPageAuthInitialized] = useState(false);
  const [isStartPageAuthenticated, setIsStartPageAuthenticated] = useState(false);
  const [newStartPagePassword, setNewStartPagePassword] = useState("");
  const [newStartPagePasswordConfirm, setNewStartPagePasswordConfirm] = useState("");
  const [startPagePasswordStatus, setStartPagePasswordStatus] = useState("");
  const [savingStartPagePassword, setSavingStartPagePassword] = useState(false);

  const suggestedId = useMemo(() => slugify(restaurantName), [restaurantName]);

  const loadRestaurantsAndLogos = async () => {
    setLoadingRestaurants(true);

    const { data: restaurantData, error: restaurantError } = await supabase
      .from("restaurants")
      .select("id, name, slug, created_at")
      .order("created_at", { ascending: true });

    if (restaurantError) {
      console.error("Restaurants konnten nicht geladen werden:", restaurantError);
      setMessage(`Fehler beim Laden: ${restaurantError.message}`);
      setLoadingRestaurants(false);
      return;
    }

    const nextRestaurants = (restaurantData || []).filter(
      (restaurant) => restaurant.id !== START_PAGE_SETTINGS_RESTAURANT_ID
    );
    setRestaurants(nextRestaurants);

    if (nextRestaurants.length === 0) {
      setRestaurantLogos({});
      setRestaurantOverviews({});
      setLoadingRestaurants(false);
      return;
    }

    const restaurantIds = nextRestaurants.map((restaurant) => restaurant.id);
    const { data, error } = await supabase
      .from("settings")
      .select("restaurant_id, key, value")
      .in("key", ["logo_url", "personal_password", ADMIN_DASHBOARD_PASSWORD_KEY, ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY, RESTAURANT_FEATURES_KEY])
      .in("restaurant_id", restaurantIds);

    if (error) {
      console.error("Restaurant-Einstellungen konnten nicht geladen werden:", error);
      setLoadingRestaurants(false);
      return;
    }

    const logos: Record<string, string> = {};
    const featuresByRestaurant: Record<string, RestaurantFeatures> = {};
    const overviewsByRestaurant: Record<string, RestaurantOverview> = {};

    nextRestaurants.forEach((restaurant) => {
      featuresByRestaurant[restaurant.id] = DEFAULT_RESTAURANT_FEATURES;
      overviewsByRestaurant[restaurant.id] = {
        personalPassword: "Nicht gesetzt",
        adminDashboardPassword: DEFAULT_ADMIN_DASHBOARD_PASSWORD,
        adminDashboardPasswordRequired: DEFAULT_ADMIN_DASHBOARD_PASSWORD_REQUIRED,
        tableCount: 0,
        lastOrderAt: null,
      };
    });

    (data || []).forEach((setting) => {
      if (setting.key === "logo_url") {
        const logoUrl = normalizeLogoUrl(setting.value);
        if (setting.restaurant_id && logoUrl) {
          logos[setting.restaurant_id] = logoUrl;
        }
      }
      if (setting.key === RESTAURANT_FEATURES_KEY && setting.restaurant_id) {
        featuresByRestaurant[setting.restaurant_id] = parseRestaurantFeatures(setting.value);
      }
      if (setting.key === "personal_password" && setting.restaurant_id) {
        overviewsByRestaurant[setting.restaurant_id] = {
          ...overviewsByRestaurant[setting.restaurant_id],
          personalPassword: setting.value || "Nicht gesetzt",
        };
      }
      if (setting.key === ADMIN_DASHBOARD_PASSWORD_KEY && setting.restaurant_id) {
        overviewsByRestaurant[setting.restaurant_id] = {
          ...overviewsByRestaurant[setting.restaurant_id],
          adminDashboardPassword: setting.value || DEFAULT_ADMIN_DASHBOARD_PASSWORD,
        };
      }
      if (setting.key === ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY && setting.restaurant_id) {
        overviewsByRestaurant[setting.restaurant_id] = {
          ...overviewsByRestaurant[setting.restaurant_id],
          adminDashboardPasswordRequired: setting.value !== "false",
        };
      }
    });

    const overviewEntries = await Promise.all(
      nextRestaurants.map(async (restaurant) => {
        const [{ count: tableCount, error: tableCountError }, { data: latestOrder, error: latestOrderError }] =
          await Promise.all([
            supabase
              .from("tables")
              .select("id", { count: "exact", head: true })
              .eq("restaurant_id", restaurant.id),
            supabase
              .from("orders")
              .select("created_at")
              .eq("restaurant_id", restaurant.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

        if (tableCountError) {
          console.error(`Tischanzahl für ${restaurant.id} konnte nicht geladen werden:`, tableCountError);
        }

        if (latestOrderError) {
          console.error(`Letzte Bestellung für ${restaurant.id} konnte nicht geladen werden:`, latestOrderError);
        }

        return [
          restaurant.id,
          {
            ...overviewsByRestaurant[restaurant.id],
            tableCount: tableCountError ? 0 : tableCount || 0,
            lastOrderAt: latestOrderError ? null : latestOrder?.created_at || null,
          },
        ] as const;
      })
    );

    overviewEntries.forEach(([restaurantId, overview]) => {
      overviewsByRestaurant[restaurantId] = overview;
    });

    setRestaurantLogos(logos);
    setRestaurantFeatures(featuresByRestaurant);
    setRestaurantOverviews(overviewsByRestaurant);
    setLoadingRestaurants(false);
  };

  useEffect(() => {
    let isActive = true;

    void loadRestaurantsAndLogos();

    const restaurantChannel = supabase
      .channel("restaurant-selection-restaurants")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "restaurants",
        },
        () => {
          if (isActive) void loadRestaurantsAndLogos();
        }
      )
      .subscribe();

    const settingsChannel = supabase
      .channel("restaurant-selection-settings")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "settings",
        },
        (payload) => {
          const nextSetting = payload.new as { restaurant_id?: string; key?: string; value?: string };
          const previousSetting = payload.old as { restaurant_id?: string };
          const restaurantId = nextSetting?.restaurant_id || previousSetting?.restaurant_id;

          if (!restaurantId) {
            return;
          }

          if (nextSetting.key === "logo_url") {
            setRestaurantLogos((currentLogos) => {
              const nextLogos = { ...currentLogos };
              const logoUrl = normalizeLogoUrl(nextSetting?.value);
              if (logoUrl) {
                nextLogos[restaurantId] = logoUrl;
              } else {
                delete nextLogos[restaurantId];
              }
              return nextLogos;
            });
          }

          if (nextSetting.key === RESTAURANT_FEATURES_KEY) {
            setRestaurantFeatures((currentFeatures) => ({
              ...currentFeatures,
              [restaurantId]: parseRestaurantFeatures(nextSetting.value),
            }));
          }

          if (nextSetting.key === "personal_password") {
            setRestaurantOverviews((currentOverviews) => ({
              ...currentOverviews,
              [restaurantId]: {
                ...currentOverviews[restaurantId],
                personalPassword: nextSetting.value || "Nicht gesetzt",
              },
            }));
          }

          if (nextSetting.key === ADMIN_DASHBOARD_PASSWORD_KEY) {
            setRestaurantOverviews((currentOverviews) => ({
              ...currentOverviews,
              [restaurantId]: {
                ...currentOverviews[restaurantId],
                adminDashboardPassword: nextSetting.value || DEFAULT_ADMIN_DASHBOARD_PASSWORD,
              },
            }));
          }

          if (nextSetting.key === ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY) {
            setRestaurantOverviews((currentOverviews) => ({
              ...currentOverviews,
              [restaurantId]: {
                ...currentOverviews[restaurantId],
                adminDashboardPasswordRequired: nextSetting.value !== "false",
              },
            }));
          }
        }
      )
      .subscribe();

    const tablesChannel = supabase
      .channel("restaurant-selection-tables")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tables",
        },
        () => {
          if (isActive) void loadRestaurantsAndLogos();
        }
      )
      .subscribe();

    const ordersChannel = supabase
      .channel("restaurant-selection-orders")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        () => {
          if (isActive) void loadRestaurantsAndLogos();
        }
      )
      .subscribe();

    return () => {
      isActive = false;
      supabase.removeChannel(restaurantChannel);
      supabase.removeChannel(settingsChannel);
      supabase.removeChannel(tablesChannel);
      supabase.removeChannel(ordersChannel);
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const initializeStartPageAuth = async () => {
      setStartPageAuthInitialized(false);

      let loadedPassword = DEFAULT_START_PAGE_PASSWORD;

      try {
        const { data, error } = await withTimeout(
          supabase
            .from("settings")
            .select("value")
            .eq("restaurant_id", START_PAGE_SETTINGS_RESTAURANT_ID)
            .eq("key", START_PAGE_PASSWORD_KEY)
            .maybeSingle(),
          START_PAGE_SETTINGS_TIMEOUT
        );

        if (error) {
          console.error("Startseiten-Passwort konnte nicht geladen werden:", error);
        }

        loadedPassword = data?.value || DEFAULT_START_PAGE_PASSWORD;
      } catch (error) {
        console.error("Startseiten-Passwort lädt zu lange, Standard wird verwendet:", error);
      }

      if (!isActive) {
        return;
      }
      setStartPagePassword(loadedPassword);

      const expiry = localStorage.getItem(START_PAGE_AUTH_KEY);
      const expiryTime = expiry ? Number.parseInt(expiry, 10) : 0;
      if (expiryTime && Date.now() < expiryTime) {
        setIsStartPageAuthenticated(true);
      } else {
        localStorage.removeItem(START_PAGE_AUTH_KEY);
        setIsStartPageAuthenticated(false);
      }

      setStartPageAuthInitialized(true);
    };

    void initializeStartPageAuth();

    return () => {
      isActive = false;
    };
  }, []);

  const handleSelectRestaurant = (restaurantId: string) => {
    router.push(`/${restaurantId}`);
  };

  const handleStartPageLogin = (event: React.FormEvent) => {
    event.preventDefault();
    setStartPagePasswordError("");

    if (startPagePasswordInput.trim() === startPagePassword.trim()) {
      localStorage.setItem(
        START_PAGE_AUTH_KEY,
        (Date.now() + START_PAGE_AUTH_DURATION).toString()
      );
      setIsStartPageAuthenticated(true);
      setStartPagePasswordInput("");
      return;
    }

    setStartPagePasswordError("Passwort falsch");
    setStartPagePasswordInput("");
  };

  const saveStartPagePassword = async () => {
    const cleanPassword = newStartPagePassword.trim();

    if (cleanPassword.length < 4) {
      setStartPagePasswordStatus("Startseiten-Passwort zu kurz");
      return;
    }

    if (cleanPassword !== newStartPagePasswordConfirm.trim()) {
      setStartPagePasswordStatus("Startseiten-Passwörter stimmen nicht überein");
      return;
    }

    setSavingStartPagePassword(true);
    setStartPagePasswordStatus("Startseiten-Passwort wird gespeichert...");

    const systemRestaurantError = await ensureStartPageSettingsRestaurant();
    if (systemRestaurantError) {
      setSavingStartPagePassword(false);
      setStartPagePasswordStatus(`Fehler: ${systemRestaurantError.message}`);
      return;
    }

    const { error } = await supabase
      .from("settings")
      .upsert(
        {
          restaurant_id: START_PAGE_SETTINGS_RESTAURANT_ID,
          key: START_PAGE_PASSWORD_KEY,
          value: cleanPassword,
        },
        { onConflict: "restaurant_id,key" }
      );

    setSavingStartPagePassword(false);

    if (error) {
      setStartPagePasswordStatus(`Fehler: ${error.message}`);
      return;
    }

    setStartPagePassword(cleanPassword);
    setNewStartPagePassword("");
    setNewStartPagePasswordConfirm("");
    setStartPagePasswordStatus("Startseiten-Passwort gespeichert");
    localStorage.setItem(
      START_PAGE_AUTH_KEY,
      (Date.now() + START_PAGE_AUTH_DURATION).toString()
    );
    setTimeout(() => setStartPagePasswordStatus(""), 2500);
  };

  const createRestaurant = async () => {
    const cleanName = restaurantName.trim();
    const cleanId = slugify(restaurantId || suggestedId);
    const cleanSlug = slugify(restaurantSlug || cleanId);
    const cleanPassword = restaurantPassword.trim();

    if (!cleanName || !cleanId || !cleanSlug || !cleanPassword) {
      setMessage("Bitte Name, Restaurant-ID und Passwort ausfüllen.");
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
      .upsert(defaultSettingsFor(cleanId, cleanPassword), { onConflict: "restaurant_id,key" });

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
    setRestaurantPassword("");
    setCreating(false);
    setMessage(`Restaurant "${cleanName}" erstellt. ID: ${cleanId}`);
    await loadRestaurantsAndLogos();
  };

  const deleteRestaurant = async (restaurant: Restaurant) => {
    const confirmed = window.confirm(
      `Restaurant "${restaurant.name}" wirklich entfernen? Das Restaurant und alle zugehörigen Daten werden aus Supabase gelöscht.`
    );

    if (!confirmed) {
      return;
    }

    setDeletingRestaurantId(restaurant.id);
    setMessage(`Restaurant "${restaurant.name}" wird entfernt...`);

    const childTables = ["reservations", "orders", "settings", "menu", "tables"] as const;

    for (const tableName of childTables) {
      const { error: childDeleteError } = await supabase
        .from(tableName)
        .delete()
        .eq("restaurant_id", restaurant.id);

      if (childDeleteError) {
        setDeletingRestaurantId("");
        setMessage(`Fehler beim Entfernen aus ${tableName}: ${childDeleteError.message}`);
        return;
      }
    }

    const { data: deletedRows, error } = await supabase
      .from("restaurants")
      .delete()
      .eq("id", restaurant.id)
      .select("id");

    setDeletingRestaurantId("");

    if (error) {
      setMessage(`Fehler beim Entfernen: ${error.message}`);
      return;
    }

    if (!deletedRows || deletedRows.length === 0) {
      const { data: stillExistingRestaurant } = await supabase
        .from("restaurants")
        .select("id")
        .eq("id", restaurant.id)
        .maybeSingle();

      if (stillExistingRestaurant) {
        setMessage(
          `Restaurant "${restaurant.name}" konnte in Supabase nicht gelöscht werden. Prüfe die DELETE-Policy für die Tabelle restaurants.`
        );
        await loadRestaurantsAndLogos();
        return;
      }
    }

    setMessage(`Restaurant "${restaurant.name}" wurde entfernt.`);
    await loadRestaurantsAndLogos();
  };

  const startRenameRestaurant = (restaurant: Restaurant) => {
    setRenamingRestaurantId(restaurant.id);
    setRenameValue(restaurant.name);
    setMessage("");
  };

  const cancelRenameRestaurant = () => {
    setRenamingRestaurantId("");
    setRenameValue("");
  };

  const saveRestaurantName = async (restaurant: Restaurant) => {
    const cleanName = renameValue.trim();

    if (!cleanName) {
      setMessage("Bitte einen Restaurant-Namen eingeben.");
      return;
    }

    setSavingRenameId(restaurant.id);
    setMessage(`Restaurant "${restaurant.name}" wird umbenannt...`);

    const { error } = await supabase
      .from("restaurants")
      .update({ name: cleanName })
      .eq("id", restaurant.id);

    setSavingRenameId("");

    if (error) {
      setMessage(`Fehler beim Umbenennen: ${error.message}`);
      return;
    }

    setRenamingRestaurantId("");
    setRenameValue("");
    setMessage(`Restaurant wurde in "${cleanName}" umbenannt.`);
    await loadRestaurantsAndLogos();
  };

  const startConfigureFeatures = (restaurant: Restaurant) => {
    setConfiguringRestaurantId(restaurant.id);
    setFeatureDraft(restaurantFeatures[restaurant.id] || DEFAULT_RESTAURANT_FEATURES);
    setMessage("");
  };

  const updateFeatureDraft = <K extends keyof RestaurantFeatures>(
    key: K,
    value: RestaurantFeatures[K]
  ) => {
    setFeatureDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  };

  const saveFeaturesForRestaurant = async (restaurant: Restaurant) => {
    const cleanFeatures: RestaurantFeatures = {
      ...featureDraft,
      tableLimit: Math.max(0, Math.floor(Number(featureDraft.tableLimit) || 0)),
    };

    setSavingFeaturesId(restaurant.id);
    setMessage(`Features für "${restaurant.name}" werden gespeichert...`);

    const { error } = await saveRestaurantFeatures(restaurant.id, cleanFeatures);

    setSavingFeaturesId("");

    if (error) {
      setMessage(`Fehler beim Speichern der Features: ${error.message}`);
      return;
    }

    setRestaurantFeatures((currentFeatures) => ({
      ...currentFeatures,
      [restaurant.id]: cleanFeatures,
    }));
    setConfiguringRestaurantId("");
    setMessage(`Features für "${restaurant.name}" gespeichert.`);
  };

  const updateRestaurantPassword = async (restaurant: Restaurant) => {
    const cleanPassword = (passwordDrafts[restaurant.id] ?? "").trim();

    if (cleanPassword.length < 4) {
      setMessage("Personalpasswort muss mindestens 4 Zeichen lang sein.");
      return;
    }

    setSavingPasswordId(restaurant.id);
    setMessage(`Personalpasswort für "${restaurant.name}" wird gespeichert...`);

    const { error } = await supabase
      .from("settings")
      .upsert(
        {
          restaurant_id: restaurant.id,
          key: "personal_password",
          value: cleanPassword,
        },
        { onConflict: "restaurant_id,key" }
      );

    setSavingPasswordId("");

    if (error) {
      setMessage(`Fehler beim Speichern des Personalpassworts: ${error.message}`);
      return;
    }

    setRestaurantOverviews((currentOverviews) => ({
      ...currentOverviews,
      [restaurant.id]: {
        ...currentOverviews[restaurant.id],
        personalPassword: cleanPassword,
      },
    }));
    setPasswordDrafts((currentDrafts) => ({
      ...currentDrafts,
      [restaurant.id]: "",
    }));
    setMessage(`Personalpasswort für "${restaurant.name}" gespeichert.`);
  };

  const updateAdminDashboardPassword = async (restaurant: Restaurant) => {
    const cleanPassword = (adminPasswordDrafts[restaurant.id] ?? "").trim();

    if (cleanPassword.length < 4) {
      setMessage("Admin-Dashboard-Passwort muss mindestens 4 Zeichen lang sein.");
      return;
    }

    setSavingAdminPasswordId(restaurant.id);
    setMessage(`Admin-Dashboard-Passwort für "${restaurant.name}" wird gespeichert...`);

    const { error } = await supabase
      .from("settings")
      .upsert(
        {
          restaurant_id: restaurant.id,
          key: ADMIN_DASHBOARD_PASSWORD_KEY,
          value: cleanPassword,
        },
        { onConflict: "restaurant_id,key" }
      );

    setSavingAdminPasswordId("");

    if (error) {
      setMessage(`Fehler beim Speichern des Admin-Dashboard-Passworts: ${error.message}`);
      return;
    }

    setRestaurantOverviews((currentOverviews) => ({
      ...currentOverviews,
      [restaurant.id]: {
        ...currentOverviews[restaurant.id],
        adminDashboardPassword: cleanPassword,
      },
    }));
    setAdminPasswordDrafts((currentDrafts) => ({
      ...currentDrafts,
      [restaurant.id]: "",
    }));
    setMessage(`Admin-Dashboard-Passwort für "${restaurant.name}" gespeichert.`);
  };

  const updateAdminDashboardPasswordRequired = async (restaurant: Restaurant, required: boolean) => {
    setSavingAdminPasswordRequiredId(restaurant.id);
    setMessage(`Admin-Dashboard-Schutz für "${restaurant.name}" wird gespeichert...`);

    const { error } = await supabase
      .from("settings")
      .upsert(
        {
          restaurant_id: restaurant.id,
          key: ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY,
          value: String(required),
        },
        { onConflict: "restaurant_id,key" }
      );

    setSavingAdminPasswordRequiredId("");

    if (error) {
      setMessage(`Fehler beim Speichern des Admin-Dashboard-Schutzes: ${error.message}`);
      return;
    }

    setRestaurantOverviews((currentOverviews) => ({
      ...currentOverviews,
      [restaurant.id]: {
        ...currentOverviews[restaurant.id],
        adminDashboardPasswordRequired: required,
      },
    }));
    setMessage(required ? `Admin-Dashboard-Schutz für "${restaurant.name}" aktiviert.` : `Admin-Dashboard-Schutz für "${restaurant.name}" deaktiviert.`);
  };

  if (!startPageAuthInitialized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-ordry-dark via-ordry-medium to-ordry-dark text-white flex items-center justify-center p-4 font-sans">
        <div className="text-white/70">Startseite wird geladen...</div>
      </div>
    );
  }

  if (!isStartPageAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-ordry-dark via-ordry-medium to-ordry-dark text-white flex items-center justify-center p-4 font-sans relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-ordry-light/20 rounded-full blur-3xl animate-blob"></div>
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-ordry-orange/15 rounded-full blur-3xl animate-blob animation-delay-2000"></div>
        </div>

        <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/20 bg-white/10 p-8 shadow-2xl backdrop-blur-md">
          <div className="mb-8 text-center">
            <div className="mb-5 flex justify-center">
              <OrdryStartLogo className="h-20 w-20" />
            </div>
            <h1 className="text-4xl font-black">Ordry</h1>
            <p className="mt-2 text-sm font-medium uppercase tracking-wide text-white/60">Startseite geschützt</p>
          </div>

          <form onSubmit={handleStartPageLogin} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-white/60">Startseiten-Passwort</span>
              <input
                type="password"
                value={startPagePasswordInput}
                onChange={(event) => {
                  setStartPagePasswordInput(event.target.value);
                  if (startPagePasswordError) setStartPagePasswordError("");
                }}
                placeholder="Passwort eingeben"
                className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                autoFocus
              />
            </label>

            {startPagePasswordError && (
              <div className="rounded-lg border border-red-300/40 bg-red-500/20 p-3 text-sm font-medium text-red-50">
                {startPagePasswordError}
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-lg bg-white px-4 py-3 font-bold text-ordry-dark transition hover:bg-ordry-orange hover:text-white"
            >
              Entsperren
            </button>
          </form>
        </div>

        <style jsx>{`
          @keyframes blob {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            33% {
              transform: translate(30px, -50px) scale(1.1);
            }
            66% {
              transform: translate(-20px, 20px) scale(0.9);
            }
          }
          .animate-blob {
            animation: blob 7s infinite;
          }
          .animation-delay-2000 {
            animation-delay: 2s;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-ordry-dark via-ordry-medium to-ordry-dark text-white flex flex-col items-center p-4 py-10 font-sans relative overflow-hidden">
      
      {/* Hintergrund-Animation */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-ordry-light/20 rounded-full blur-3xl animate-blob"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-ordry-orange/15 rounded-full blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 right-0 w-96 h-96 bg-ordry-medium/20 rounded-full blur-3xl animate-blob animation-delay-4000"></div>
      </div>
      
      {/* LOGO AREA */}
      <div className="relative z-10 text-center mb-10">
        <div className="flex justify-center mb-6">
          <OrdryStartLogo className="h-24 w-24 transition-transform duration-500 hover:scale-105" />
        </div>
        
        <h1 className="text-5xl md:text-6xl font-black mb-4 tracking-tight">
          Ordry
        </h1>
        <p className="text-white/65 font-medium tracking-wide uppercase text-sm">
          Digital Ordering System
        </p>
      </div>

      {/* RESTAURANT AUSWAHL UND ADMIN */}
      <div className="relative z-10 w-full max-w-6xl">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 p-6 md:p-10 rounded-3xl shadow-2xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section>
              <h2 className="text-3xl md:text-4xl font-bold mb-3 text-center lg:text-left">Restaurant auswählen</h2>
              <p className="text-white/70 text-center lg:text-left mb-8">Wähle ein Restaurant, öffne den Admin oder lege direkt ein neues an.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {loadingRestaurants ? (
                  <div className="col-span-full text-center text-white/70 py-10">Restaurants werden geladen...</div>
                ) : restaurants.length === 0 ? (
                  <div className="col-span-full text-center text-white/70 py-10">Noch keine Restaurants angelegt.</div>
                ) : restaurants.map((restaurant) => {
                  const logoUrl = restaurantLogos[restaurant.id];
                  const overview = restaurantOverviews[restaurant.id] || {
                    personalPassword: "Lädt...",
                    adminDashboardPassword: DEFAULT_ADMIN_DASHBOARD_PASSWORD,
                    adminDashboardPasswordRequired: DEFAULT_ADMIN_DASHBOARD_PASSWORD_REQUIRED,
                    tableCount: 0,
                    lastOrderAt: null,
                  };

                  return (
                    <div
                      key={restaurant.id}
                      className="group relative overflow-hidden bg-gradient-to-br from-ordry-dark to-ordry-medium border border-white/20 hover:border-ordry-orange/70 p-6 rounded-2xl transition-all duration-300 hover:shadow-2xl hover:shadow-ordry-orange/20"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-ordry-light/0 via-ordry-light/0 to-ordry-orange/0 group-hover:from-ordry-light/20 group-hover:via-ordry-medium/20 group-hover:to-ordry-orange/20 transition-all duration-500"></div>

                      <div className="relative z-10">
                        <RestaurantLogoTile logoUrl={logoUrl} restaurantName={restaurant.name} />
                        {renamingRestaurantId === restaurant.id ? (
                          <div className="space-y-3">
                            <label className="block">
                              <span className="mb-1 block text-xs font-bold uppercase text-white/60">Name</span>
                              <input
                                type="text"
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    void saveRestaurantName(restaurant);
                                  }
                                  if (event.key === "Escape") {
                                    cancelRenameRestaurant();
                                  }
                                }}
                                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                                autoFocus
                              />
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => saveRestaurantName(restaurant)}
                                disabled={savingRenameId === restaurant.id}
                                className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-ordry-dark transition hover:bg-ordry-orange hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {savingRenameId === restaurant.id ? "Speichert..." : "Speichern"}
                              </button>
                              <button
                                type="button"
                                onClick={cancelRenameRestaurant}
                                className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/20"
                              >
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-lg text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-ordry-orange transition-all duration-300">{restaurant.name}</h3>
                              <button
                                type="button"
                                onClick={() => startRenameRestaurant(restaurant)}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/70 transition hover:border-ordry-orange hover:bg-ordry-orange/20 hover:text-white"
                                aria-label={`${restaurant.name} umbenennen`}
                                title="Name ändern"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L8.332 18.32a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Zm0 0L19.5 7.125" />
                                </svg>
                              </button>
                            </div>
                            <p className="text-sm text-white/60 mt-1">{restaurant.id}</p>
                            {restaurant.slug && <p className="text-xs text-white/45 mt-1">Slug: {restaurant.slug}</p>}

                            <details className="mt-4 overflow-hidden rounded-xl border border-white/15 bg-white/10">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 [&::-webkit-details-marker]:hidden">
                                <span>Restaurant-Info</span>
                                <span className="text-xs font-black text-ordry-orange">+</span>
                              </summary>
                              <div className="grid gap-3 border-t border-white/10 px-4 py-3 text-sm">
                                <div>
                                  <div className="text-xs font-bold uppercase text-white/45">Personalpasswort</div>
                                  <div className="mt-1 break-words font-mono text-white">{overview.personalPassword}</div>
                                </div>
                                <div className="grid gap-2">
                                  <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase text-white/45">Neues Personalpasswort</span>
                                    <input
                                      type="text"
                                      value={passwordDrafts[restaurant.id] ?? ""}
                                      onChange={(event) =>
                                        setPasswordDrafts((currentDrafts) => ({
                                          ...currentDrafts,
                                          [restaurant.id]: event.target.value,
                                        }))
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          void updateRestaurantPassword(restaurant);
                                        }
                                      }}
                                      placeholder="Personalpasswort ändern"
                                      className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => updateRestaurantPassword(restaurant)}
                                    disabled={savingPasswordId === restaurant.id}
                                    className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:border-ordry-orange hover:bg-ordry-orange/20 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {savingPasswordId === restaurant.id ? "Speichert..." : "Personalpasswort speichern"}
                                  </button>
                                </div>
                                <div>
                                  <div className="text-xs font-bold uppercase text-white/45">Admin-Dashboard Passwort</div>
                                  <div className="mt-1 break-words font-mono text-white">{overview.adminDashboardPassword}</div>
                                </div>
                                <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium">
                                  <span>Extra Admin-Passwort benötigt</span>
                                  <input
                                    type="checkbox"
                                    checked={overview.adminDashboardPasswordRequired}
                                    disabled={savingAdminPasswordRequiredId === restaurant.id}
                                    onChange={(event) => updateAdminDashboardPasswordRequired(restaurant, event.target.checked)}
                                    className="h-5 w-5 accent-ordry-orange disabled:cursor-not-allowed disabled:opacity-60"
                                  />
                                </label>
                                <div className="grid gap-2">
                                  <label className="block">
                                    <span className="mb-1 block text-xs font-bold uppercase text-white/45">Neues Admin-Passwort</span>
                                    <input
                                      type="text"
                                      value={adminPasswordDrafts[restaurant.id] ?? ""}
                                      onChange={(event) =>
                                        setAdminPasswordDrafts((currentDrafts) => ({
                                          ...currentDrafts,
                                          [restaurant.id]: event.target.value,
                                        }))
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          void updateAdminDashboardPassword(restaurant);
                                        }
                                      }}
                                      placeholder="Admin-Dashboard Passwort ändern"
                                      className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => updateAdminDashboardPassword(restaurant)}
                                    disabled={savingAdminPasswordId === restaurant.id}
                                    className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:border-ordry-orange hover:bg-ordry-orange/20 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {savingAdminPasswordId === restaurant.id ? "Speichert..." : "Admin-Passwort speichern"}
                                  </button>
                                </div>
                                <div>
                                  <div className="text-xs font-bold uppercase text-white/45">Erstellte Tische</div>
                                  <div className="mt-1 font-semibold text-white">{overview.tableCount}</div>
                                </div>
                                <div>
                                  <div className="text-xs font-bold uppercase text-white/45">Letzte Bestellung</div>
                                  <div className="mt-1 font-semibold text-white">{formatLastOrder(overview.lastOrderAt)}</div>
                                </div>
                              </div>
                            </details>
                          </>
                        )}

                        {configuringRestaurantId === restaurant.id && (
                          <div className="mt-5 rounded-xl border border-white/15 bg-white/10 p-4">
                            <h4 className="mb-3 text-sm font-bold uppercase text-white/70">Features</h4>
                            <div className="space-y-3">
                              <label className="block">
                                <span className="mb-1 block text-xs font-bold uppercase text-white/50">Max. Tischanzahl</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={featureDraft.tableLimit}
                                  onChange={(event) => updateFeatureDraft("tableLimit", Number(event.target.value))}
                                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white outline-none focus:border-ordry-orange"
                                />
                              </label>

                              {[
                                ["upsellingEnabled", "Upselling"],
                                ["reservationsEnabled", "Reservierungen"],
                                ["statisticsEnabled", "Statistiken"],
                                ["themesLockedToOrdry", "Nur Ordry-Theme erlauben"],
                              ].map(([key, label]) => (
                                <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium">
                                  <span>{label}</span>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(featureDraft[key as keyof RestaurantFeatures])}
                                    onChange={(event) => updateFeatureDraft(key as keyof RestaurantFeatures, event.target.checked as never)}
                                    className="h-5 w-5 accent-ordry-orange"
                                  />
                                </label>
                              ))}

                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => saveFeaturesForRestaurant(restaurant)}
                                  disabled={savingFeaturesId === restaurant.id}
                                  className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-ordry-dark transition hover:bg-ordry-orange hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {savingFeaturesId === restaurant.id ? "Speichert..." : "Speichern"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfiguringRestaurantId("")}
                                  className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/20"
                                >
                                  Abbrechen
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {renamingRestaurantId !== restaurant.id && <div className="mt-5 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectRestaurant(restaurant.id)}
                            className="min-w-32 flex-1 rounded-lg bg-white px-3 py-2 text-sm font-bold text-ordry-dark transition hover:bg-ordry-orange hover:text-white"
                          >
                            Öffnen
                          </button>
                          <button
                            type="button"
                            onClick={() => startConfigureFeatures(restaurant)}
                            className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white/80 transition hover:border-ordry-orange hover:bg-ordry-orange/20 hover:text-white"
                          >
                            Features
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRestaurant(restaurant)}
                            disabled={deletingRestaurantId === restaurant.id}
                            className="rounded-lg border border-red-200/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-white/80 transition hover:border-red-200/60 hover:bg-red-500/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingRestaurantId === restaurant.id ? "Entferne..." : "Entfernen"}
                          </button>
                        </div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-white/20 bg-ordry-dark/40 p-5 md:p-6">
              <h2 className="text-2xl font-bold mb-2">Restaurant hinzufügen</h2>
              <p className="text-sm text-white/60 mb-5">Erstellt Restaurant, Grundeinstellungen und optional fünf Standard-Tische.</p>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase text-white/60">Name</span>
                  <input
                    type="text"
                    placeholder="z.B. Pizza Milano"
                    value={restaurantName}
                    onChange={(event) => {
                      setRestaurantName(event.target.value);
                      if (!restaurantId) setRestaurantSlug(slugify(event.target.value));
                    }}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase text-white/60">Restaurant-ID</span>
                  <input
                    type="text"
                    placeholder={suggestedId || "pizza-milano"}
                    value={restaurantId}
                    onChange={(event) => setRestaurantId(slugify(event.target.value))}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 font-mono text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                  />
                  <span className="mt-1 block text-xs text-white/50">
                    URL: /{restaurantId || suggestedId || "restaurant-id"}
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase text-white/60">Slug/Subdomain</span>
                  <input
                    type="text"
                    placeholder={restaurantId || suggestedId || "pizza-milano"}
                    value={restaurantSlug}
                    onChange={(event) => setRestaurantSlug(slugify(event.target.value))}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 font-mono text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase text-white/60">Restaurant-Passwort</span>
                  <input
                    type="text"
                    placeholder="z.B. schnitzel"
                    value={restaurantPassword}
                    onChange={(event) => setRestaurantPassword(event.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-white/15 bg-white/10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={createStandardTables}
                    onChange={(event) => setCreateStandardTables(event.target.checked)}
                    className="h-5 w-5 accent-ordry-orange"
                  />
                  <span className="font-medium">5 Standard-Tische erstellen</span>
                </label>

                <button
                  type="button"
                  onClick={createRestaurant}
                  disabled={creating}
                  className="w-full rounded-lg bg-ordry-orange px-4 py-3 font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? "Erstelle..." : "Restaurant erstellen"}
                </button>

                {message && (
                  <div className="rounded-lg border border-white/15 bg-white/10 p-3 text-sm font-medium text-white/85">
                    {message}
                  </div>
                )}

                <div className="border-t border-white/15 pt-5">
                  <h3 className="mb-2 text-lg font-bold">Startseiten-Passwort</h3>
                  <p className="mb-4 text-sm text-white/60">Schützt diese Restaurant-Auswahl.</p>

                  <div className="space-y-3">
                    <input
                      type="password"
                      placeholder="Neues Passwort"
                      value={newStartPagePassword}
                      onChange={(event) => setNewStartPagePassword(event.target.value)}
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                    />
                    <input
                      type="password"
                      placeholder="Passwort wiederholen"
                      value={newStartPagePasswordConfirm}
                      onChange={(event) => setNewStartPagePasswordConfirm(event.target.value)}
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-ordry-orange"
                    />
                    <button
                      type="button"
                      onClick={saveStartPagePassword}
                      disabled={savingStartPagePassword}
                      className="w-full rounded-lg border border-white/25 bg-white/10 px-4 py-3 font-bold text-white transition hover:border-ordry-orange hover:bg-ordry-orange/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingStartPagePassword ? "Speichert..." : "Startseiten-Passwort speichern"}
                    </button>
                    {startPagePasswordStatus && (
                      <div className="rounded-lg border border-white/15 bg-white/10 p-3 text-sm font-medium text-white/85">
                        {startPagePasswordStatus}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div className="mt-8 text-white/40 text-xs font-mono opacity-60 relative z-10">
        Ordry v1.0 • Restaurant Selection
      </div>

      <style jsx>{`
        @keyframes blob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}
