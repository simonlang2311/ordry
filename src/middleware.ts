import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Wir machen GAR NICHTS und lassen einfach jeden durch.
  // Das beendet die Endlos-Schleife sofort.
  return NextResponse.next();
}

export const config = {
  matcher: '/kitchen/:path*',
}