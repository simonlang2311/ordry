"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { generateToken } from "@/lib/tokenManager";

export default function RedirectPage() {
  const params = useParams();
  const router = useRouter();
  const tableId = params?.id ? decodeURIComponent(Array.isArray(params.id) ? params.id[0] : params.id) : null;

  useEffect(() => {
    const doRedirect = async () => {
      if (!tableId) {
        router.push('/');
        return;
      }

      try {
        const { data, error } = await supabase
          .from('tables')
          .select('current_token')
          .eq('label', tableId)
          .single();

        if (error || !data) {
          console.error('[Redirect] Fehler beim Token-Abruf:', error);
          router.push('/');
          return;
        }

        let token = data.current_token;

        if (!token) {
          token = generateToken();
          await supabase
            .from('tables')
            .update({ current_token: token })
            .eq('label', tableId);
        }

        router.replace(`/table/${encodeURIComponent(tableId)}?token=${encodeURIComponent(token)}`);
      } catch (err) {
        console.error('[Redirect] Unerwarteter Fehler:', err);
        router.push('/');
      }
    };

    doRedirect();
  }, [router, tableId]);

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-app-primary mx-auto mb-4"></div>
        <p className="text-app-text">Lade Tisch {tableId}...</p>
      </div>
    </div>
  );
}
