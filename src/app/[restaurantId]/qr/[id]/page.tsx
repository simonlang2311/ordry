"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { createNewCustomerTokenForTable, validateQrToken } from "@/lib/tokenManager";

export default function RestaurantQRRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const restaurantId = params?.restaurantId
    ? decodeURIComponent(Array.isArray(params.restaurantId) ? params.restaurantId[0] : params.restaurantId)
    : null;
  const tableId = params?.id ? decodeURIComponent(Array.isArray(params.id) ? params.id[0] : params.id) : null;
  const providedToken = searchParams.get("qr") ?? searchParams.get("token");
  const [invalidQr, setInvalidQr] = useState(false);

  useEffect(() => {
    const validateQrAndRedirect = async () => {
      if (!restaurantId || !tableId) {
        router.push("/");
        return;
      }

      try {
        const isValidQr = await validateQrToken(tableId, providedToken, supabase, restaurantId);

        if (!isValidQr) {
          console.warn("[Restaurant QR Redirect] Ungültiger oder abgelaufener QR-Code:", { tableId, restaurantId });
          setInvalidQr(true);
          return;
        }

        await createNewCustomerTokenForTable(tableId, supabase, restaurantId);
        router.replace(`/${encodeURIComponent(restaurantId)}/t/${encodeURIComponent(tableId)}`);
      } catch (error) {
        console.error("[Restaurant QR Redirect] Unerwarteter Fehler:", error);
        setInvalidQr(true);
      }
    };

    validateQrAndRedirect();
  }, [providedToken, restaurantId, router, tableId]);

  if (invalidQr) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-app-muted/20 bg-app-card p-8 text-center shadow-lg">
          <h1 className="mb-3 text-2xl font-black text-app-text">QR-Code ungültig</h1>
          <p className="mb-6 text-app-muted">
            Dieser QR-Code wurde ersetzt oder ist nicht mehr aktiv. Bitte verwende den neuesten QR-Code für Tisch {tableId}.
          </p>
          <button
            onClick={() => router.push(`/${encodeURIComponent(restaurantId || "")}`)}
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
