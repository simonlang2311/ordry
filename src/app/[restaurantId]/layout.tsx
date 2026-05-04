import type { Metadata } from "next";

const DEFAULT_APP_NAME = "ordry";

type SettingsResponse = Array<{ key: string; value: string | null }>;
type RestaurantResponse = Array<{ name: string | null }>;

type RestaurantLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ restaurantId?: string }>;
}>;

const iconUrlFor = (restaurantId: string, logoUrl?: string | null) => {
  const source = logoUrl?.trim() || restaurantId;
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  const version = hash.toString(36);

  return `/${encodeURIComponent(restaurantId)}/favicon.ico?v=${version}`;
};

const fetchRestaurantBranding = async (restaurantId?: string) => {
  if (!restaurantId) {
    return { appName: DEFAULT_APP_NAME, iconUrl: "/ordry.png" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { appName: DEFAULT_APP_NAME, iconUrl: "/ordry.png" };
  }

  try {
    const settingsUrl = new URL(`${supabaseUrl}/rest/v1/settings`);
    settingsUrl.searchParams.set("select", "key,value");
    settingsUrl.searchParams.set("key", "in.(logo_url,app_name)");
    settingsUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);

    const restaurantUrl = new URL(`${supabaseUrl}/rest/v1/restaurants`);
    restaurantUrl.searchParams.set("select", "name");
    restaurantUrl.searchParams.set("id", `eq.${restaurantId}`);
    restaurantUrl.searchParams.set("limit", "1");

    const headers = {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    };

    const [settingsResponse, restaurantResponse] = await Promise.all([
      fetch(settingsUrl.toString(), { headers, cache: "no-store" }),
      fetch(restaurantUrl.toString(), { headers, cache: "no-store" }),
    ]);

    if (!settingsResponse.ok || !restaurantResponse.ok) {
      throw new Error("Branding request failed");
    }

    const [settings, restaurants] = (await Promise.all([
      settingsResponse.json(),
      restaurantResponse.json(),
    ])) as [SettingsResponse, RestaurantResponse];
    const logoSetting = settings.find((setting) => setting.key === "logo_url");
    const appNameSetting = settings.find((setting) => setting.key === "app_name");
    const restaurantName = restaurants[0]?.name?.trim();
    const settingsName = appNameSetting?.value?.trim();

    return {
      appName: restaurantName || settingsName || DEFAULT_APP_NAME,
      iconUrl: iconUrlFor(restaurantId, logoSetting?.value),
    };
  } catch {
    return { appName: DEFAULT_APP_NAME, iconUrl: "/ordry.png" };
  }
};

export async function generateMetadata({
  params,
}: {
  params: RestaurantLayoutProps["params"];
}): Promise<Metadata> {
  const { restaurantId } = await params;
  const { appName, iconUrl } = await fetchRestaurantBranding(restaurantId);

  return {
    title: appName,
    icons: {
      icon: iconUrl,
      shortcut: iconUrl,
      apple: iconUrl,
    },
  };
}

export default function RestaurantLayout({ children }: RestaurantLayoutProps) {
  return children;
}
