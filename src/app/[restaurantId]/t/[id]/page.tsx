"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchCurrentCustomerTokenForTable, saveToken } from "@/lib/tokenManager";
import { supabase } from "@/lib/supabase";

export default function RedirectPage() {
  const params = useParams();
  const router = useRouter();
  const tableId = params?.id ? decodeURIComponent(Array.isArray(params.id) ? params.id[0] : params.id) : null;
  const restaurantId = params?.restaurantId ? decodeURIComponent(Array.isArray(params.restaurantId) ? params.restaurantId[0] : params.restaurantId) : null;
  // ...existing code...

  useEffect(() => {
    const doRedirect = async () => {
      if (!tableId || !restaurantId) {
        router.push('/');
        return;
      }

      try {
        const customerToken = await fetchCurrentCustomerTokenForTable(tableId, supabase, restaurantId);
        saveToken(tableId, customerToken, restaurantId);

        router.replace(`/${encodeURIComponent(restaurantId)}/table/${encodeURIComponent(tableId)}?token=${encodeURIComponent(customerToken)}`);
      } catch (err) {
        console.error('[Redirect] Unerwarteter Fehler:', err);
        router.push('/');
      }
    };

    doRedirect();
  }, [router, tableId, restaurantId]);

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-app-primary mx-auto mb-4"></div>
        <p className="text-app-text">Lade Tisch {tableId}...</p>
      </div>
    </div>
  );
}
