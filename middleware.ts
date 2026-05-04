import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const url = request.nextUrl.clone();

  // Entferne Port für lokale Entwicklung
  const cleanHostname = hostname.replace(/:\d+$/, '');

  // Prüfe auf Subdomain
  const subdomainMatch = cleanHostname.match(/^([^.]+)\.ordry\.eu$/);
  if (subdomainMatch) {
    const restaurantSlug = subdomainMatch[1];

    // Hier könntest du eine DB-Abfrage machen, um restaurant_id aus slug zu bekommen
    // Für jetzt: Annahme, dass slug = restaurant_id
    const restaurantId = restaurantSlug;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-restaurant-id', restaurantId);

    // Optional: Rewrite zu /[restaurantId]/* für dynamische Routen
    if (url.pathname === '/' || !url.pathname.startsWith('/admin')) {
      url.pathname = `/${restaurantId}${url.pathname}`;
      return NextResponse.rewrite(url, {
        request: {
          headers: requestHeaders,
        },
      });
    }

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Für admin.ordry.eu
  if (cleanHostname === 'admin.ordry.eu') {
    // Spezielle Logik für Admin
    const response = NextResponse.next();
    response.headers.set('x-is-admin', 'true');
    // Rewrite zu /super-admin
    url.pathname = '/super-admin';
    return NextResponse.rewrite(url);
  }

  // Fallback für localhost oder andere
  // Prüfe auf restaurant-spezifische Routen wie /[restaurantId]/*
  const restaurantPathMatch = url.pathname.match(/^\/([^\/]+)(?:\/|$)/);
  if (restaurantPathMatch && !url.pathname.startsWith('/admin') && !url.pathname.startsWith('/super-admin') && !url.pathname.startsWith('/api') && !url.pathname.startsWith('/_next')) {
    const restaurantId = restaurantPathMatch[1];
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-restaurant-id', restaurantId);
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
