import { NextResponse } from 'next/server'

export function middleware() {
  // Wir machen GAR NICHTS und lassen einfach jeden durch.
  // Das beendet die Endlos-Schleife sofort.
  return NextResponse.next();
}

export const runtime = 'experimental-edge';

export const config = {
  matcher: '/kitchen/:path*',
}
