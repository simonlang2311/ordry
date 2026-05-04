import { createClient } from '@supabase/supabase-js';

// Wir laden die Schlüssel jetzt sicher aus der Umgebungsvariable (.env.local)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Sicherheits-Check: Falls die Datei .env.local nicht gefunden wird, warnen wir sofort
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL oder Key fehlt! Überprüfe deine .env.local Datei.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false
  },
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        keepalive: true
      });
    }
  }
});