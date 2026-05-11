"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { createNewCustomerTokenForTable, validateQrToken } from "@/lib/tokenManager";

export default function QRRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tableId = params?.id ? decodeURIComponent(Array.isArray(params.id) ? params.id[0] : params.id) : null;
  const providedToken = searchParams.get('qr') ?? searchParams.get('token');
  const [invalidQr, setInvalidQr] = useState(false);

  useEffect(() => {
    const validateQrAndRedirect = async () => {
      if (!tableId) {
        router.push('/');
        return;
      }

      try {
        if (providedToken) {
          const { data: tokenTable, error: tokenLookupError } = await supabase
            .from('tables')
            .select('label, restaurant_id')
            .eq('label', tableId)
            .eq('current_token', providedToken)
            .maybeSingle();

          if (tokenLookupError) {
            console.error('[QR Redirect] Fehler beim Restaurant-Lookup:', tokenLookupError);
          }

          if (tokenTable?.restaurant_id) {
            const isValidQr = await validateQrToken(tableId, providedToken, supabase, tokenTable.restaurant_id);

            if (!isValidQr) {
              console.warn('[QR Redirect] Ungültiger oder abgelaufener QR-Code für Tisch:', tableId);
              setInvalidQr(true);
              return;
            }

            await createNewCustomerTokenForTable(tokenTable.label || tableId, supabase, tokenTable.restaurant_id);
            router.replace(`/${encodeURIComponent(tokenTable.restaurant_id)}/t/${encodeURIComponent(tokenTable.label || tableId)}`);
            return;
          }
        }

        const fallbackRestaurantId = process.env.NEXT_PUBLIC_RESTAURANT_ID || 'demo-restaurant-1';
        const isValidQr = await validateQrToken(tableId, providedToken, supabase, fallbackRestaurantId);

        if (!isValidQr) {
          console.warn('[QR Redirect] Ungültiger oder abgelaufener QR-Code für Tisch:', tableId);
          setInvalidQr(true);
          return;
        }

        await createNewCustomerTokenForTable(tableId, supabase, fallbackRestaurantId);
        router.replace(`/${encodeURIComponent(fallbackRestaurantId)}/t/${encodeURIComponent(tableId)}`);
      } catch (error) {
        console.error('[QR Redirect] Unerwarteter Fehler:', error);
        setInvalidQr(true);
      }
    };

    validateQrAndRedirect();
  }, [providedToken, router, tableId]);

  if (invalidQr) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-app-muted/20 bg-app-card p-8 text-center shadow-lg">
          <h1 className="mb-3 text-2xl font-black text-app-text">QR-Code ungültig</h1>
          <p className="mb-6 text-app-muted">
            Dieser QR-Code wurde ersetzt oder ist nicht mehr aktiv. Bitte verwende den neuesten QR-Code für Tisch {tableId}.
          </p>
          <button
            onClick={() => router.push('/')}
            className="rounded-xl bg-app-primary px-5 py-3 font-bold text-white transition hover:brightness-110"
          >
            Zur Startseite
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-app-primary mx-auto mb-4"></div>
        <p className="text-app-text">Prüfe QR-Code für Tisch {tableId}...</p>
      </div>
    </div>
  );
}
