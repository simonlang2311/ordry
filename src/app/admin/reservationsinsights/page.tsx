'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

// --- HILFSFUNKTION FÜR ZEIT-EINGABE ---
const handleTimeInput = (value: string): string => {
  // Nur Ziffern erlauben
  let digits = value.replace(/\D/g, '');
  
  // Auf 4 Ziffern begrenzen (erste 4 Ziffern nehmen)
  if (digits.length > 4) {
    digits = digits.slice(0, 4);
  }
  
  // Wenn 1-2 Ziffern, nur Ziffern anzeigen
  if (digits.length <= 2) return digits;
  
  // Wenn 3 Ziffern, validieren und formatieren
  if (digits.length === 3) {
    const hours = parseInt(digits.slice(0, 1));
    const mins = parseInt(digits.slice(1, 3));
    if (hours > 23 || mins > 59) return ''; // Ungültig - Feld leeren
    return digits.slice(0, 1) + ':' + digits.slice(1);
  }
  
  // Wenn 4 Ziffern, validieren und formatieren
  if (digits.length === 4) {
    const hours = parseInt(digits.slice(0, 2));
    const mins = parseInt(digits.slice(2, 4));
    if (hours > 23 || mins > 59) return ''; // Ungültig - Feld leeren
    return digits.slice(0, 2) + ':' + digits.slice(2);
  }
  
  return '';
};

// --- TYPEN ---
type ReservationRow = {
  id: number;
  table_id: string;
  guest_name: string;
  date: string;
  time: string;
  guests_count: number;
};

// Typ für die gruppierte Anzeige (Ein Eintrag pro Gruppe/Buchung)
type GroupedBooking = {
  ids: number[];        // Alle IDs der Datenbank-Einträge (zum Löschen)
  guest_name: string;
  time: string;
  table_labels: string[]; // Liste der Tische (z.B. ["1", "2"])
  total_guests: number;   // Gästezahl (nehmen wir aus dem ersten Eintrag)
};

export default function AdminReservationsPage() {
  const router = useRouter();
  
  // --- STATE ---
  // Standardmäßig heutiges Datum
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [bookings, setBookings] = useState<GroupedBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ totalGuests: 0, totalBookings: 0 });
  const [filterTable, setFilterTable] = useState('');
  const [filterTimeStart, setFilterTimeStart] = useState('');
  const [filterTimeEnd, setFilterTimeEnd] = useState('');
  const [allTables, setAllTables] = useState<string[]>([]);

  // --- DATEN LADEN ---
  useEffect(() => {
    fetchReservations();
  }, [selectedDate]);

  const fetchReservations = async () => {
    setLoading(true);
    
    // 1. Hole alle Rohdaten für das Datum
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID)
      .eq('date', selectedDate)
      .order('time', { ascending: true });

    if (error) {
      alert("Fehler beim Laden: " + error.message);
      setLoading(false);
      return;
    }

    const rawData = data as ReservationRow[];

    // 2. Gruppieren der Daten
    // Problem: Kombi-Buchungen stehen als separate Zeilen in der DB.
    // Lösung: Wir fassen Einträge mit gleicher Zeit + gleichem Namen zusammen.
    const grouped: GroupedBooking[] = [];

    rawData.forEach(row => {
      // Suche, ob wir diese "Buchung" schon in der Liste haben
      const existing = grouped.find(
        g => g.guest_name === row.guest_name && g.time === row.time
      );

      if (existing) {
        // Existiert schon -> Tisch hinzufügen und ID merken
        existing.table_labels.push(row.table_id);
        existing.ids.push(row.id);
        // Hinweis: guests_count ist in jedem Eintrag gleich gespeichert, daher müssen wir es nicht addieren
      } else {
        // Neu -> Erstellen
        grouped.push({
          ids: [row.id],
          guest_name: row.guest_name,
          time: row.time.slice(0, 5), // "19:00:00" -> "19:00"
          table_labels: [row.table_id],
          total_guests: row.guests_count
        });
      }
    });

    // Sortieren nach Labels innerhalb der Gruppen (damit "1, 2" steht und nicht "2, 1")
    grouped.forEach(g => g.table_labels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));

    // Sammeln aller eindeutigen Tische für Filter
    const allTablesSet = new Set<string>();
    grouped.forEach(g => {
      g.table_labels.forEach(label => allTablesSet.add(label));
    });
    setAllTables(Array.from(allTablesSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));

    setBookings(grouped);

    // 3. Statistiken berechnen
    const totalGuests = grouped.reduce((sum, b) => sum + b.total_guests, 0);
    setStats({ totalGuests, totalBookings: grouped.length });
    
    setLoading(false);
  };

  // --- ACTION: LÖSCHEN ---
  const handleDelete = async (booking: GroupedBooking) => {
    if (!confirm(`Buchung von ${booking.guest_name} wirklich stornieren?`)) return;

    // Wir löschen ALLE IDs, die zu dieser Gruppe gehören
    const { error } = await supabase
      .from('reservations')
      .delete()
      .in('id', booking.ids);

    if (error) {
      alert("Fehler beim Löschen");
    } else {
      // Liste neu laden
      fetchReservations();
    }
  };

  // --- FILTER ANWENDEN ---
  const filteredBookings = bookings.filter(booking => {
    const matchesTable = !filterTable || booking.table_labels.includes(filterTable);
    
    let matchesTime = true;
    if (filterTimeStart || filterTimeEnd) {
      const bookingTime = booking.time;
      if (filterTimeStart && bookingTime < filterTimeStart) matchesTime = false;
      if (filterTimeEnd && bookingTime > filterTimeEnd) matchesTime = false;
    }
    
    return matchesTable && matchesTime;
  });

  return (
    <div className="min-h-screen bg-app-bg text-app-text font-sans p-6 md:p-12">
      
      {/* HEADER */}
      <div className="max-w-6xl mx-auto mb-8 flex flex-col gap-4 border-b border-app-muted/20 pb-6 xl:max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
           <h1 className="text-3xl font-bold text-app-text mb-1">Admin Reservierungen</h1>
           <p className="text-app-muted text-sm">Übersicht aller Buchungen und Tische.</p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="bg-app-card text-app-text border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/20 transition-colors font-bold"
          >
            ← Dashboard
          </button>
        </div>
        
        <div className="flex w-full flex-wrap items-center gap-3 bg-app-card p-3 rounded-xl border border-app-muted/20 xl:w-auto">
           <a href="/" className="px-4 py-2 text-sm font-bold text-app-muted hover:text-app-text transition-colors">Home</a>
           <div className="h-6 w-[1px] bg-app-muted/30"></div>
           <button onClick={() => router.push('/')} className="px-4 py-2 text-sm font-bold text-app-muted hover:text-app-text transition-colors">
             Zum Restaurant
           </button>
           <div className="h-6 w-[1px] bg-app-muted/30"></div>
           <input 
             type="date" 
             min={new Date().toISOString().split('T')[0]}
             value={selectedDate} 
             onChange={(e) => setSelectedDate(e.target.value)} 
             className="bg-app-bg text-app-text border border-app-muted/30 rounded-lg px-3 py-2 outline-none focus:border-app-primary font-bold min-w-[180px] flex-1 sm:flex-none sm:w-48"
           />
           <div className="h-6 w-[1px] bg-app-muted/30"></div>
           <select
             value={filterTable}
             onChange={(e) => setFilterTable(e.target.value)}
             className="bg-app-bg text-app-text border border-app-muted/30 rounded-lg px-3 py-2 outline-none focus:border-app-primary font-bold text-sm min-w-[160px] flex-1 sm:flex-none"
           >
             <option value="">Alle Tische</option>
             {allTables.map(table => (
               <option key={table} value={table}>Tisch {table}</option>
             ))}
           </select>
           <div className="h-6 w-[1px] bg-app-muted/30"></div>
           <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[260px]">
             <input
               type="text"
               value={filterTimeStart}
               onChange={(e) => setFilterTimeStart(handleTimeInput(e.target.value))}
               placeholder="Von"
               maxLength={5}
               className="bg-app-bg text-app-text border border-app-muted/30 rounded-lg px-3 py-2 outline-none focus:border-app-primary font-bold text-sm min-w-[110px] flex-1 sm:flex-none sm:w-32"
             />
             <span className="text-app-muted">bis</span>
             <input
               type="text"
               value={filterTimeEnd}
               onChange={(e) => setFilterTimeEnd(handleTimeInput(e.target.value))}
               placeholder="Bis"
               maxLength={5}
               className="bg-app-bg text-app-text border border-app-muted/30 rounded-lg px-3 py-2 outline-none focus:border-app-primary font-bold text-sm min-w-[110px] flex-1 sm:flex-none sm:w-32"
             />
             {(filterTimeStart || filterTimeEnd) && (
               <button
                 onClick={() => {
                   setFilterTimeStart('');
                   setFilterTimeEnd('');
                 }}
                 className="text-app-muted hover:text-app-text text-xs px-2 py-1"
               >
                 X
               </button>
             )}
           </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6 xl:max-w-7xl">
        
        {/* --- STATS CARDS --- */}
        <div className="md:col-span-1 space-y-4">
            <div className="bg-app-card p-6 rounded-2xl border border-app-muted/20 shadow-lg">
                <div className="text-app-muted text-xs font-bold uppercase mb-1">Reservierungen</div>
                <div className="text-4xl font-black text-app-primary">{stats.totalBookings}</div>
            </div>
            <div className="bg-app-card p-6 rounded-2xl border border-app-muted/20 shadow-lg">
                <div className="text-app-muted text-xs font-bold uppercase mb-1">Gäste Erwartet</div>
                <div className="text-4xl font-black text-app-accent">{stats.totalGuests}</div>
            </div>
        </div>

        {/* --- LISTE --- */}
        <div className="md:col-span-3">
            <div className="bg-app-card rounded-2xl border border-app-muted/20 overflow-hidden shadow-xl min-h-[500px]">
                {/* Tabellen Kopf */}
                <div className="grid grid-cols-12 gap-4 p-4 bg-app-bg/50 border-b border-app-muted/20 text-xs font-bold text-app-muted uppercase tracking-wider">
                    <div className="col-span-2">Uhrzeit</div>
                    <div className="col-span-4">Gast Name</div>
                    <div className="col-span-3">Tische</div>
                    <div className="col-span-2 text-center">Pers.</div>
                    <div className="col-span-1 text-right">Action</div>
                </div>

                {/* Tabellen Inhalt */}
                <div className="divide-y divide-app-muted/20">
                    {loading ? (
                        <div className="p-10 text-center text-app-muted">Lade Daten...</div>
                    ) : filteredBookings.length === 0 ? (
                        <div className="p-10 text-center flex flex-col items-center text-app-muted">
                            <span className="text-4xl mb-2 font-bold text-app-muted/60">—</span>
                            <span>Keine Reservierungen für diese Filter.</span>
                        </div>
                    ) : (
                        filteredBookings.map((booking, idx) => (
                            <div key={idx} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-app-primary/10 transition-colors group">
                                
                                {/* Uhrzeit */}
                                <div className="col-span-2 font-mono font-bold text-lg text-app-primary">
                                    {booking.time}
                                </div>
                                
                                {/* Name */}
                                <div className="col-span-4 font-bold text-app-text truncate pr-2">
                                    {booking.guest_name}
                                </div>

                                {/* Tische (Badges) */}
                                <div className="col-span-3 flex flex-wrap gap-1">
                                    {booking.table_labels.map(label => (
                                        <span key={label} className={`text-xs px-2 py-1 rounded font-bold border ${booking.table_labels.length > 1 ? 'bg-app-primary/20 border-app-primary text-app-primary' : 'bg-app-card border-app-muted/30 text-app-text'}`}>
                                            {label}
                                        </span>
                                    ))}
                                </div>

                                {/* Personen */}
                                <div className="col-span-2 text-center font-bold text-app-text">
                                    {booking.total_guests}
                                </div>

                                {/* Löschen */}
                                <div className="col-span-1 text-right">
                                    <button 
                                        onClick={() => handleDelete(booking)}
                                        className="text-app-muted hover:text-app-danger p-2 rounded-lg hover:bg-app-danger/10 transition-colors font-bold"
                                        title="Stornieren"
                                    >
                                        X
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>

      </div>
    </div>
  );
}
