import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
// Wichtig: Den Wrapper importieren
import ThemeWrapper from "@/components/ThemeWrapper";
import { BrandingProvider, DEFAULT_BRANDING } from "@/components/Branding";
import FullscreenButton from "@/components/FullscreenButton";
import { FONT_MAP } from "@/lib/appearance";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ordry",
  description: "Bestellsystem",
  icons: {
    icon: "/ordry.png",
  },
};

type SettingsResponse = Array<{ key: string; value: string }>;
type RestaurantResponse = Array<{ name: string | null }>;

const fetchInitialSettings = async (restaurantId?: string) => {
  if (!restaurantId) {
    return {
      initialTheme: "futuristic",
      initialFontFamily: "geist",
      initialBranding: DEFAULT_BRANDING,
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      initialTheme: "modern",
      initialFontFamily: "geist",
      initialBranding: DEFAULT_BRANDING,
    };
  }

  try {
    const settingsUrl = new URL(`${supabaseUrl}/rest/v1/settings`);
    settingsUrl.searchParams.set("select", "key,value");
    settingsUrl.searchParams.set(
      "key",
      "in.(theme,font_family,custom_theme_colors,logo_url,app_name,restaurant_link)"
    );
    settingsUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);

    const restaurantUrl = new URL(`${supabaseUrl}/rest/v1/restaurants`);
    restaurantUrl.searchParams.set("select", "name");
    restaurantUrl.searchParams.set("id", `eq.${restaurantId}`);
    restaurantUrl.searchParams.set("limit", "1");

    const requestHeaders = {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    };

    const [settingsResponse, restaurantResponse] = await Promise.all([
      fetch(settingsUrl.toString(), {
        headers: requestHeaders,
        cache: "no-store",
      }),
      fetch(restaurantUrl.toString(), {
        headers: requestHeaders,
        cache: "no-store",
      }),
    ]);

    if (!settingsResponse.ok || !restaurantResponse.ok) {
      throw new Error(`Appearance request failed`);
    }

    const [data, restaurants] = (await Promise.all([
      settingsResponse.json(),
      restaurantResponse.json(),
    ])) as [SettingsResponse, RestaurantResponse];
    const initialBranding = { ...DEFAULT_BRANDING };
    let initialTheme = "modern";
    let initialFontFamily = "geist";

    data.forEach((setting) => {
      if (setting.key === "theme" && setting.value) {
        initialTheme = setting.value;
      }
      if (setting.key === "font_family" && setting.value) {
        initialFontFamily = setting.value;
      }
      if (setting.key === "logo_url") {
        initialBranding.logoUrl = setting.value || "";
      }
      if (setting.key === "app_name") {
        initialBranding.appName = setting.value || "ordry";
      }
      if (setting.key === "restaurant_link") {
        initialBranding.restaurantLink = setting.value || undefined;
      }
    });

    const restaurantName = restaurants[0]?.name?.trim();
    if (restaurantName) {
      initialBranding.appName = restaurantName;
    }

    return { initialTheme, initialFontFamily, initialBranding };
  } catch {
    return {
      initialTheme: "modern",
      initialFontFamily: "geist",
      initialBranding: DEFAULT_BRANDING,
    };
  }
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const restaurantId = headersList.get('x-restaurant-id') || undefined;
  const appearancePromise = fetchInitialSettings(restaurantId);

  return <RootLayoutInner appearancePromise={appearancePromise}>{children}</RootLayoutInner>;
}

async function RootLayoutInner({
  children,
  appearancePromise,
}: Readonly<{
  children: React.ReactNode;
  appearancePromise: ReturnType<typeof fetchInitialSettings>;
}>) {
  const { initialTheme, initialFontFamily, initialBranding } = await appearancePromise;
  const initialFontCss = FONT_MAP[initialFontFamily] || FONT_MAP.geist;

  const htmlStyle = {
    ["--app-font-sans" as string]: initialFontCss,
    fontFamily: initialFontCss,
  } satisfies CSSProperties;

  return (
    <html
      lang="de"
      data-theme={initialTheme}
      data-font={initialFontFamily}
      style={htmlStyle}
      suppressHydrationWarning
    >
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Wichtig: Hier wickeln wir alles ein */}
        <ThemeWrapper initialTheme={initialTheme} initialFontFamily={initialFontFamily}>
          <BrandingProvider initialBranding={initialBranding}>
            <FullscreenButton />
            {children}
          </BrandingProvider>
        </ThemeWrapper>
      </body>
    </html>
  );
}
