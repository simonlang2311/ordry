"use client";
import { useParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/lib/supabase";
import {
  applyCustomThemeColors,
  applyAccessibleThemeColors,
  CUSTOM_THEME_FIELDS,
  CUSTOM_THEME_SETTINGS_KEY,
  CustomThemeColors,
  DEFAULT_CUSTOM_THEME_COLORS,
  FONT_MAP,
  FONT_OPTIONS,
  parseCustomThemeColors,
  validateCustomThemeContrast,
} from "@/lib/appearance";
import { DEFAULT_RESTAURANT_FEATURES, RestaurantFeatures, loadRestaurantFeatures } from "@/lib/features";

function PersonalContent() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [currentTheme, setCurrentTheme] = useState("modern");
  const [currentFont, setCurrentFont] = useState("geist");
  const [customColors, setCustomColors] = useState<CustomThemeColors>(DEFAULT_CUSTOM_THEME_COLORS);
  const [features, setFeatures] = useState<RestaurantFeatures>(DEFAULT_RESTAURANT_FEATURES);
  const [showLogoSection, setShowLogoSection] = useState(false);
  const [showThemeSection, setShowThemeSection] = useState(false);
  const [logoRuleChecks, setLogoRuleChecks] = useState({
    formatOk: null as boolean | null,
    compressedAndSavedOk: null as boolean | null,
    noStorageBucketOk: true,
    shownSystemwideOk: null as boolean | null,
  });

  const getRuleTextClass = (passed: boolean | null) =>
    passed === false ? "text-red-500 font-semibold" : "text-app-muted";
  const customThemeContrastChecks = validateCustomThemeContrast(customColors);
  const customThemeHasContrastIssues = customThemeContrastChecks.some((check) => !check.passed);

  useEffect(() => {
    let isActive = true;

    const fetchFeatures = async () => {
      const nextFeatures = await loadRestaurantFeatures(restaurantId);
      if (!isActive) return;
      setFeatures(nextFeatures);
      if (nextFeatures.themesLockedToOrdry && currentTheme !== "ordry") {
        await saveTheme("ordry");
      }
    };

    void fetchFeatures();

    return () => {
      isActive = false;
    };
  }, [restaurantId]);

  // Konvertiert jede Bilddatei in eine komprimierte Base64-DataURL
  // kein Storage-Bucket nötig, direkt in settings gespeichert
  const processImageToDataUrl = async (file: File): Promise<string> => {
    const lowerType = file.type.toLowerCase();

    // SVG als Text einlesen und als DataURL kodieren
    if (lowerType === "image/svg+xml") {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("SVG konnte nicht gelesen werden"));
        reader.readAsDataURL(file);
      });
    }

    // Rasterbild komprimieren
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Bild konnte nicht geladen werden"));
        image.src = objectUrl;
      });

      // Max 400px auf der längsten Seite – reicht für ein Logo
      const maxDimension = 400;
      const ratio = Math.min(maxDimension / img.width, maxDimension / img.height, 1);
      const targetWidth = Math.max(1, Math.round(img.width * ratio));
      const targetHeight = Math.max(1, Math.round(img.height * ratio));

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas nicht verfügbar");
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      // Ziel: <35KB DataURL (Browser keepalive-Limit vermeiden)
      const TARGET_CHARS = 35 * 1024;
      let quality = 0.85;
      let dataUrl = canvas.toDataURL("image/webp", quality);

      while (dataUrl.length > TARGET_CHARS && quality > 0.3) {
        quality = Math.max(0.3, quality - 0.1);
        dataUrl = canvas.toDataURL("image/webp", quality);
      }

      // Falls immer noch zu groß: Auflösung weiter reduzieren
      if (dataUrl.length > TARGET_CHARS) {
        canvas.width = Math.max(1, Math.round(targetWidth * 0.6));
        canvas.height = Math.max(1, Math.round(targetHeight * 0.6));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL("image/webp", 0.7);
      }

      return dataUrl;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { data, error } = await supabase
          .from("settings")
          .select("key, value")
          .in("key", ["logo_url", "theme", "font_family", CUSTOM_THEME_SETTINGS_KEY])
          .eq("restaurant_id", restaurantId);

        if (error) {
          console.error("Error loading settings:", error);
          return;
        }

        data?.forEach((setting) => {
          if (setting.key === "logo_url") {
            setLogoUrl(setting.value || "");
          }
          if (setting.key === "theme") {
            setCurrentTheme(setting.value || "modern");
          }
          if (setting.key === "font_family") {
            setCurrentFont(setting.value || "geist");
          }
          if (setting.key === CUSTOM_THEME_SETTINGS_KEY) {
            const nextColors = parseCustomThemeColors(setting.value);
            setCustomColors(nextColors);
            applyCustomThemeColors(nextColors);
          }
        });
      } catch (error) {
        console.error("Error:", error);
      }
    };

    void loadSettings();
  }, []);

  const showTemporaryStatus = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(""), 2000);
  };

  const saveLogoUrl = async (url: string) => {
    try {
      const { error } = await supabase
        .from("settings")
      .upsert({ restaurant_id: restaurantId, key: "logo_url", value: url }, { onConflict: "key,restaurant_id" });

      showTemporaryStatus(url ? "Logo gespeichert" : "Logo entfernt");
    } catch (error: any) {
      setStatus("Fehler: " + error.message);
    }
  };

  const saveTheme = async (themeName: string) => {
    setStatus("Speichere...");
    setCurrentTheme(themeName);
    if (themeName === "custom") {
      applyCustomThemeColors(customColors);
    } else {
      applyAccessibleThemeColors(themeName, customColors);
    }

    localStorage.setItem("theme", themeName);
    window.dispatchEvent(new Event("storage"));

    const { error } = await supabase
      .from("settings")
      .upsert({ restaurant_id: restaurantId, key: "theme", value: themeName }, { onConflict: "key,restaurant_id" });

    if (error) {
      setStatus("Fehler: " + error.message);
    } else {
      showTemporaryStatus("Design gespeichert");
    }
  };

  const updateCustomColor = (key: keyof CustomThemeColors, value: string) => {
    const nextColors = { ...customColors, [key]: value };
    setCustomColors(nextColors);
    if (currentTheme === "custom") {
      applyCustomThemeColors(nextColors);
    }
    void saveCustomThemeColors(false, nextColors, true);
  };

  const saveCustomThemeColors = async (activate = false, colors = customColors, quiet = false) => {
    if (!quiet) setStatus("Speichere...");
    if (currentTheme === "custom" || activate) applyCustomThemeColors(colors);

    const { error } = await supabase
      .from("settings")
      .upsert(
        { restaurant_id: restaurantId, key: CUSTOM_THEME_SETTINGS_KEY, value: JSON.stringify(colors) },
        { onConflict: "key,restaurant_id" }
      );

    if (error) {
      setStatus("Fehler: " + error.message);
      return;
    }

    if (activate) {
      await saveTheme("custom");
    } else if (!quiet) {
      showTemporaryStatus("Farben gespeichert");
    }
  };

  const saveFontFamily = async (fontKey: string) => {
    setCurrentFont(fontKey);

    const selectedFont = FONT_MAP[fontKey] || FONT_MAP.geist;
    document.documentElement.style.setProperty("--app-font-sans", selectedFont);
    document.body.style.setProperty("--app-font-sans", selectedFont);
    document.documentElement.style.fontFamily = selectedFont;
    document.body.style.fontFamily = selectedFont;
    localStorage.setItem("font_family", fontKey);
    window.dispatchEvent(new Event("storage"));

    const { error } = await supabase
      .from("settings")
      .upsert({ restaurant_id: restaurantId, key: "font_family", value: fontKey }, { onConflict: "key,restaurant_id" });

    if (error) {
      setStatus("Fehler: " + error.message);
    } else {
      showTemporaryStatus("Schriftart gespeichert");
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isAllowedType =
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      file.type === "image/svg+xml" ||
      lowerName.endsWith(".png") ||
      lowerName.endsWith(".jpg") ||
      lowerName.endsWith(".jpeg") ||
      lowerName.endsWith(".svg");

    if (!isAllowedType) {
      setLogoRuleChecks({
        formatOk: false,
        compressedAndSavedOk: false,
        noStorageBucketOk: true,
        shownSystemwideOk: false,
      });
      setStatus("Bitte nur PNG, JPG oder SVG hochladen");
      return;
    }

    setLogoRuleChecks({
      formatOk: true,
      compressedAndSavedOk: null,
      noStorageBucketOk: true,
      shownSystemwideOk: null,
    });

    if (file.size > 20 * 1024 * 1024) {
      setStatus("Datei zu groß (max. 20MB). Bild wird trotzdem komprimiert gespeichert.");
    }

    setUploading(true);
    setStatus("Bild wird verarbeitet...");

    try {
      const dataUrl = await processImageToDataUrl(file);

      // Eigener Client OHNE keepalive – keepalive limitiert Payload auf 64KB
      const supabaseNoKeepalive = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );

      const { error } = await supabaseNoKeepalive
        .from("settings")
        .upsert({ restaurant_id: restaurantId, key: "logo_url", value: dataUrl }, { onConflict: "key,restaurant_id" });

      if (error) throw new Error("Speichern fehlgeschlagen: " + error.message);

      setLogoUrl(dataUrl);
      setLogoRuleChecks({
        formatOk: true,
        compressedAndSavedOk: true,
        noStorageBucketOk: true,
        shownSystemwideOk: true,
      });
      showTemporaryStatus("Logo erfolgreich gespeichert!");
      e.target.value = "";
    } catch (error: any) {
      setLogoRuleChecks((prev) => ({
        ...prev,
        compressedAndSavedOk: false,
        shownSystemwideOk: false,
      }));
      setStatus("Fehler: " + (error?.message || "Unbekannter Fehler"));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteLogo = async () => {
    if (!confirm("Logo wirklich entfernen?")) return;

    setLogoUrl("");
    await saveLogoUrl("");
  };

  const themes = [
    {
      key: "modern",
      title: "Classic Menu",
      description: "Vintage Speisekarten-Look mit Creme, Taupe und warmem Grau.",
      container: "bg-[#efe9dd] text-[#5f5a53]",
      active: "border-[#8b8278] ring-4 ring-[#8b8278]/25",
      inactive: "border-[#c8beb0] hover:border-[#a89f92]",
      text: "text-[#7f766b]",
      activeText: "text-[#6f665c]",
      swatches: ["bg-[#efe9dd] border border-[#d9d0c4]", "bg-[#8b8278]", "bg-[#5f5a53]"],
    },
    {
      key: "classic",
      title: "Classic Light",
      description: "Helles Papier-Weiß, hoher Kontrast, klassisch.",
      container: "bg-[#f8fafc] text-slate-900",
      active: "border-amber-500 ring-4 ring-amber-500/20",
      inactive: "border-slate-200 hover:border-amber-400",
      text: "text-slate-500",
      activeText: "text-amber-600",
      swatches: ["bg-[#f8fafc] border border-slate-300", "bg-[#d97706]", "bg-[#15803d]"],
    },
    {
      key: "retro_menu",
      title: "Retro Diner Menu",
      description: "Warme Retro-Karte mit Creme, Rot und kräftigem Blau.",
      container: "bg-[#f3e6c8] text-[#5b4b3d]",
      active: "border-[#ead7cf] ring-4 ring-[#ead7cf]/30",
      inactive: "border-[#d8b692] hover:border-[#ead7cf]",
      text: "text-[#8f775f]",
      activeText: "text-[#2e4fa6]",
      swatches: ["bg-[#f3e6c8] border border-[#d8b692]", "bg-[#ead7cf] border border-[#d8bdb4]", "bg-[#2e4fa6]"],
    },
    {
      key: "soft_menu",
      title: "Soft Bistro",
      description: "Helles, modernes Karten-Layout mit Grautönen und grünen Akzenten.",
      container: "bg-[#efefef] text-[#111111]",
      active: "border-[#111111] ring-4 ring-[#111111]/20",
      inactive: "border-[#d7d7d7] hover:border-[#b8b8b8]",
      text: "text-[#6b6b6b]",
      activeText: "text-[#178c52]",
      swatches: ["bg-[#efefef] border border-[#d7d7d7]", "bg-[#111111]", "bg-[#178c52]"],
    },
    {
      key: "ordry",
      title: "Ordry Original",
      description: "Deine Markenfarben. Dunkelblau & Orange.",
      container: "bg-[#f8f9fa] text-[#275D7B]",
      active: "border-[#FF6633] ring-4 ring-[#FF6633]/20",
      inactive: "border-[#275D7B]/20 hover:border-[#FF6633]",
      text: "text-[#2D7596]",
      activeText: "text-[#FF6633]",
      swatches: ["bg-[#275D7B]", "bg-[#358BB2]", "bg-[#FF6633]"],
    },
    {
      key: "futuristic",
      title: "Minimal",
      description: "Weiß, Grautöne, minimalistisch.",
      container: "bg-white text-gray-800",
      active: "border-gray-400 ring-4 ring-gray-400/20",
      inactive: "border-gray-200 hover:border-gray-300",
      text: "text-gray-500",
      activeText: "text-gray-600",
      swatches: ["bg-white border border-gray-300", "bg-[#6b7280]", "bg-[#374151]"],
    },
    {
      key: "custom",
      title: "Benutzerdefiniert",
      description: "Vier eigene Farben für Hintergrund, Karten, Hauptfarbe und Akzent.",
      container: "bg-app-bg text-app-text",
      active: "border-app-accent ring-4 ring-app-accent/20",
      inactive: "border-app-muted/20 hover:border-app-accent",
      text: "text-app-muted",
      activeText: "text-app-accent",
      swatches: [],
    },
  ];
  const availableThemes = features.themesLockedToOrdry
    ? themes.filter((theme) => theme.key === "ordry")
    : themes;

  return (
    <div className="min-h-screen bg-app-bg text-app-text p-8 font-sans pb-32">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black">Personalisierung</h1>
            <p className="text-app-muted mt-1">Logo und Design für dein Restaurant anpassen.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/${restaurantId}`} className="bg-app-card border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/10 font-bold transition-colors">
              Home
            </Link>
            <Link href={`/${restaurantId}/admin`} className="bg-app-card border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/10 font-bold transition-colors">
              ← Dashboard
            </Link>
          </div>
        </div>

        {status && <div className="mb-6 bg-app-card border border-app-muted/20 rounded-lg p-3 text-sm">{status}</div>}

        <div className="space-y-2.5">
          <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowLogoSection(!showLogoSection)}
              className="flex w-full items-center justify-between px-6 py-5 text-left"
              aria-expanded={showLogoSection}
            >
              <div>
                <h2 className="text-xl font-bold mb-1 text-app-text">Dein Logo</h2>
                <p className="text-sm text-app-muted">Logo hochladen, austauschen oder entfernen.</p>
              </div>
              <span className={`text-2xl text-app-muted transition-transform ${showLogoSection ? "rotate-180" : ""}`}>⌃</span>
            </button>

            {showLogoSection && (
              <div className="px-6 pb-6">
                <div className="flex flex-col md:flex-row gap-8 items-start">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-app-muted uppercase mb-2">Aktuelles Logo</label>
                    <div className="w-full h-48 border-2 border-dashed border-app-muted/30 rounded-lg flex items-center justify-center bg-app-bg">
                      {logoUrl ? (
                        <div className="relative w-full h-full p-4">
                          <img src={logoUrl} alt="Restaurant Logo" className="w-full h-full object-contain" loading="lazy" />
                        </div>
                      ) : (
                        <div className="text-center text-app-muted">
                          <svg className="mx-auto h-12 w-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p>Kein Logo hochgeladen</p>
                          <p className="text-xs mt-1">Das Standard-Logo wird verwendet</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1">
                    <label className="block text-xs font-bold text-app-muted uppercase mb-2">Logo hochladen</label>
                    <div className="space-y-4">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        disabled={uploading}
                        className="block w-full text-sm text-app-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-app-primary/10 file:text-app-primary hover:file:bg-app-primary/20 disabled:opacity-50"
                      />
                      <div className="text-xs space-y-1">
                        <p className={getRuleTextClass(logoRuleChecks.formatOk)}>• Erlaubte Dateiformate: PNG, JPG oder SVG</p>
                        <p className={getRuleTextClass(logoRuleChecks.compressedAndSavedOk)}>• Das Bild wird automatisch optimiert und gespeichert</p>
                        <p className={getRuleTextClass(logoRuleChecks.shownSystemwideOk)}>• Nach dem Speichern wird das Logo systemweit angezeigt</p>
                      </div>
                      {logoUrl && (
                        <button onClick={handleDeleteLogo} className="w-full px-4 py-2 bg-app-danger text-white rounded-lg hover:brightness-110 transition-colors font-bold">
                          Logo entfernen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowThemeSection(!showThemeSection)}
              className="flex w-full items-center justify-between px-6 py-5 text-left"
              aria-expanded={showThemeSection}
            >
              <div>
                <h2 className="text-xl font-bold mb-1 text-app-text">Design-Theme</h2>
                <p className="text-sm text-app-muted">Wähle das Farbschema für dein System.</p>
              </div>
              <span className={`text-2xl text-app-muted transition-transform ${showThemeSection ? "rotate-180" : ""}`}>⌃</span>
            </button>

            {showThemeSection && (
              <div className="px-6 pb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {features.themesLockedToOrdry && (
                    <div className="md:col-span-2 rounded-xl border border-app-primary/20 bg-app-primary/10 p-4 text-sm font-medium text-app-text">
                      Für dieses Restaurant ist nur das Ordry-Theme freigeschaltet.
                    </div>
                  )}
                  {availableThemes.map((theme) => (
                    <button
                      key={theme.key}
                      onClick={() => saveTheme(theme.key)}
                      className={`relative p-8 rounded-2xl border-4 text-left transition-all hover:scale-[1.02] shadow-xl ${
                        currentTheme === theme.key ? theme.active : theme.inactive
                      } ${theme.container}`}
                    >
                      <h3 className="text-2xl font-bold mb-2">{theme.title}</h3>
                      <p className={`${theme.text} text-sm`}>{theme.description}</p>
                      <div className="mt-4 flex gap-2">
                        {theme.key === "custom"
                          ? CUSTOM_THEME_FIELDS.map((field) => (
                              <span
                                key={field.key}
                                className="h-8 w-8 rounded-full border border-app-muted/30"
                                style={{ backgroundColor: customColors[field.key] }}
                              />
                            ))
                          : theme.swatches.map((swatchClass) => (
                              <span key={swatchClass} className={`w-8 h-8 rounded-full ${swatchClass}`}></span>
                            ))}
                      </div>
                      {currentTheme === theme.key && <p className={`${theme.activeText} text-xs mt-3`}>Aktiv</p>}
                    </button>
                  ))}
                </div>

                {!features.themesLockedToOrdry && (
                  <div className="mt-6 rounded-2xl border border-app-muted/20 bg-app-bg p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-bold text-app-text">Benutzerdefinierte Farben</h3>
                      <p className="mt-1 text-xs text-app-muted">Wähle vier Farben aus der Farbpalette. Die Auswahl wird automatisch gespeichert.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {CUSTOM_THEME_FIELDS.map((field) => (
                        <label key={field.key} className="rounded-xl border border-app-muted/20 bg-app-card p-3">
                          <span className="mb-2 block text-xs font-bold uppercase text-app-muted">{field.label}</span>
                          <input
                            type="color"
                            value={customColors[field.key]}
                            onChange={(event) => updateCustomColor(field.key, event.target.value)}
                            className="h-12 w-full cursor-pointer rounded-lg border border-app-muted/20 bg-transparent"
                          />
                          <span className="mt-2 block text-xs font-mono text-app-muted">{customColors[field.key]}</span>
                        </label>
                      ))}
                    </div>
                  {customThemeHasContrastIssues && (
                    <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                      Warnung: Der Kontrast könnte nicht hoch genug sein.
                    </div>
                  )}
                  </div>
                )}

                <div className="mt-6 rounded-2xl border border-app-muted/20 bg-app-bg p-4">
                  <label className="mb-2 block text-sm font-bold text-app-text">Schriftart</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {FONT_OPTIONS.map((font) => {
                      const isSelected = currentFont === font.key;
                      return (
                        <button
                          key={font.key}
                          type="button"
                          onClick={() => saveFontFamily(font.key)}
                          style={{ "--preview-font": FONT_MAP[font.key] || FONT_MAP.geist } as CSSProperties}
                          className={`font-preview rounded-xl border px-4 py-3 text-left text-lg transition-all ${
                            isSelected
                              ? "border-app-primary bg-app-primary/10 text-app-primary shadow-sm"
                              : "border-app-muted/20 bg-app-card text-app-text hover:border-app-primary/50 hover:bg-app-primary/5"
                          }`}
                        >
                          {font.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-app-muted">Die Auswahl wird sofort angewendet und systemweit gespeichert.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PersonalPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <PersonalContent />
    </ProtectedRoute>
  );
}
