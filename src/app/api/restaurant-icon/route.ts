import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_ICON = "/ordry.png";

type SettingsResponse = Array<{ value: string | null }>;

const normalizeLogoUrl = (value?: string | null) => {
  const logoUrl = value?.trim();

  if (!logoUrl || logoUrl.startsWith("blob:")) {
    return DEFAULT_ICON;
  }

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

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

const redirectToDefaultIcon = (request: Request) => {
  return NextResponse.redirect(new URL(DEFAULT_ICON, request.url), {
    headers: responseHeaders,
  });
};

const imageResponseFromDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+)(;base64)?,([\s\S]*)$/);

  if (!match) {
    return null;
  }

  const [, contentType, isBase64, rawData] = match;
  const body = isBase64
    ? Buffer.from(rawData, "base64")
    : Buffer.from(decodeURIComponent(rawData));

  return new Response(body, {
    headers: {
      ...responseHeaders,
      "Content-Type": contentType,
    },
  });
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get("restaurantId")?.trim();

  if (!restaurantId) {
    return redirectToDefaultIcon(request);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return redirectToDefaultIcon(request);
  }

  try {
    const settingsUrl = new URL(`${supabaseUrl}/rest/v1/settings`);
    settingsUrl.searchParams.set("select", "value");
    settingsUrl.searchParams.set("restaurant_id", `eq.${restaurantId}`);
    settingsUrl.searchParams.set("key", "eq.logo_url");
    settingsUrl.searchParams.set("limit", "1");

    const response = await fetch(settingsUrl.toString(), {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return redirectToDefaultIcon(request);
    }

    const data = (await response.json()) as SettingsResponse;
    const logoUrl = normalizeLogoUrl(data[0]?.value);

    if (logoUrl.startsWith("data:image/")) {
      return imageResponseFromDataUrl(logoUrl) || redirectToDefaultIcon(request);
    }

    return NextResponse.redirect(new URL(logoUrl, request.url), {
      headers: responseHeaders,
    });
  } catch {
    return redirectToDefaultIcon(request);
  }
}
