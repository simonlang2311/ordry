import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ restaurantId?: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { restaurantId } = await context.params;

  if (!restaurantId) {
    return NextResponse.redirect(new URL("/ordry.png", request.url), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  const url = new URL("/api/restaurant-icon", request.url);
  url.searchParams.set("restaurantId", restaurantId);
  url.searchParams.set("v", new URL(request.url).searchParams.get("v") || "");

  return NextResponse.redirect(url, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
