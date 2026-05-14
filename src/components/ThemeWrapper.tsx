"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  applyAccessibleThemeColors,
  applyCustomThemeColors,
  CUSTOM_THEME_SETTINGS_KEY,
  DEFAULT_CUSTOM_THEME_COLORS,
  FONT_MAP,
  parseCustomThemeColors,
} from "@/lib/appearance";
import { RESTAURANT_FEATURES_KEY, parseRestaurantFeatures } from "@/lib/features";

export default function ThemeWrapper({
  children,
  initialTheme,
  initialFontFamily,
}: {
  children: React.ReactNode;
  initialTheme: string;
  initialFontFamily: string;
}) {
  const params = useParams();
  const pathname = usePathname();
  const isRootPage = pathname === "/";
  const isGlobalAdmin = pathname.startsWith("/admin") || pathname.startsWith("/super-admin");
  const restaurantParam = params?.restaurantId;
  const restaurantId =
    isRootPage || isGlobalAdmin
      ? undefined
      : typeof restaurantParam === "string"
        ? restaurantParam
        : Array.isArray(restaurantParam)
          ? restaurantParam[0]
          : process.env.NEXT_PUBLIC_RESTAURANT_ID ?? undefined;
  const [theme, setTheme] = useState(initialTheme);
  const [fontFamily, setFontFamily] = useState(initialFontFamily);
  const [customColors, setCustomColors] = useState(DEFAULT_CUSTOM_THEME_COLORS);
  const [themesLockedToOrdry, setThemesLockedToOrdry] = useState(false);

  useEffect(() => {
    if (!restaurantId) {
      return;
    }

    // 1. Initial laden
    const fetchSettings = async () => {
      let query = supabase
        .from('settings')
        .select('key, value')
        .in('key', ['theme', 'font_family', CUSTOM_THEME_SETTINGS_KEY, RESTAURANT_FEATURES_KEY]);

      if (restaurantId) {
        query = query.eq('restaurant_id', restaurantId);
      }

      const { data } = await query;
      const features = parseRestaurantFeatures(
        data?.find((setting) => setting.key === RESTAURANT_FEATURES_KEY)?.value
      );

      if (features.themesLockedToOrdry) {
        setThemesLockedToOrdry(true);
        setTheme("ordry");
      } else {
        setThemesLockedToOrdry(false);
      }
      
      data?.forEach((setting) => {
        if (setting.key === 'theme' && setting.value && !features.themesLockedToOrdry) setTheme(setting.value);
        if (setting.key === 'font_family' && setting.value) setFontFamily(setting.value);
        if (setting.key === CUSTOM_THEME_SETTINGS_KEY) {
          const nextCustomColors = parseCustomThemeColors(setting.value);
          setCustomColors(nextCustomColors);
          if ((features.themesLockedToOrdry ? "ordry" : data.find((item) => item.key === "theme")?.value) === "custom") {
            applyCustomThemeColors(nextCustomColors);
          }
        }
      });
    };
    fetchSettings();

    // 2. Live-Updates
    const channel = supabase
      .channel(`theme-updates-${restaurantId}`)
      .on(
        'postgres_changes',
        { 
          event: '*',
          schema: 'public', 
          table: 'settings',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const newData = payload.new as { key?: string; value?: string };
          if (!newData?.key) return;
          if (newData.key === RESTAURANT_FEATURES_KEY) {
            const features = parseRestaurantFeatures(newData.value);
            setThemesLockedToOrdry(features.themesLockedToOrdry);
            if (features.themesLockedToOrdry) setTheme("ordry");
          }
          if (newData.key === 'theme' && newData.value) {
            setTheme((currentTheme) => themesLockedToOrdry ? currentTheme : newData.value || currentTheme);
          }
          if (newData.key === 'font_family' && newData.value) {
            setFontFamily(newData.value);
          }
          if (newData.key === CUSTOM_THEME_SETTINGS_KEY) {
            const nextCustomColors = parseCustomThemeColors(newData.value);
            setCustomColors(nextCustomColors);
            if (theme === "custom") applyCustomThemeColors(nextCustomColors);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId, themesLockedToOrdry]);

  // Theme setzen
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "custom") {
      applyCustomThemeColors(customColors);
    } else {
      applyAccessibleThemeColors(theme, customColors);
    }
    localStorage.setItem("theme", theme);
  }, [theme, customColors]);

  // Schriftart global setzen
  useLayoutEffect(() => {
    const cssFont = FONT_MAP[fontFamily] || FONT_MAP.geist;
    document.documentElement.style.setProperty("--app-font-sans", cssFont);
    document.documentElement.style.fontFamily = cssFont;
    localStorage.setItem("font_family", fontFamily);
    document.documentElement.setAttribute("data-font", fontFamily);
  }, [fontFamily]);

  return <>{children}</>;
}
