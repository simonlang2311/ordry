'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useParams } from 'next/navigation';
import { Logo } from '@/components/Branding';

const TIME_SUGGESTIONS = ["11:30", "12:00", "12:30", "18:00", "18:30", "19:00", "19:30", "20:00"];

const isCompleteTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

// --- TYPEN ---
type Table = {
  id: number;
  label: string;
  level: string;
  seats: number;
  x: number;
  y: number;
};

type SearchResult = {
  type: 'single' | 'combo';
  labels: string[]; // Die Namen der Tische
  tableIds: number[]; // Für eindeutige Identifizierung
  level: string;
  totalSeats: number;
  displayLabel: string;
};

export default function ReservationPage() {
  const params = useParams();
  const restaurantId = typeof params?.restaurantId === 'string' ? params.restaurantId : process.env.NEXT_PUBLIC_RESTAURANT_ID;
  
  // --- STATE ---
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  
  const [levels, setLevels] = useState<string[]>(['Alle']);
  const [currentLevel, setCurrentLevel] = useState('Alle');

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestCount, setGuestCount] = useState(2);
  
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const isSearchComplete = Boolean(guestName.trim()) && Boolean(date) && isCompleteTime(time) && guestCount > 0;

  // --- INIT ---
  useEffect(() => {
    const fetchTables = async () => {
      let tablesQuery = supabase
        .from('tables')
        .select('*')
        .order('label', { ascending: true });
      if (restaurantId) {
        tablesQuery = tablesQuery.eq('restaurant_id', restaurantId);
      }
      const { data } = await tablesQuery;
        
      if (data) {
        setAllTables(data);
        const uniqueLevels = Array.from(new Set(data.map((t: Table) => t.level || 'EG')));
        setLevels(['Alle', ...uniqueLevels.sort()]);
      }
    };
    fetchTables();
  }, [restaurantId]);

  // --- HELPER: DISTANZ ---
  const getDistance = (t1: Table, t2: Table) => {
    const dx = t1.x - t2.x;
    const dy = t1.y - t2.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // --- LOGIK: CLUSTER FINDEN ---
  // Versucht, ausgehend von 'startTable' so viele nächste Nachbarn zu sammeln, bis 'neededSeats' erreicht sind.
  const findBestCluster = (startTable: Table, availableTables: Table[], neededSeats: number): Table[] | null => {
     const cluster = [startTable];
     let currentSeats = startTable.seats;
     const usedIds = new Set([startTable.id]);

     // Solange wir nicht genug Plätze haben...
     while (currentSeats < neededSeats) {
        let bestCandidate: Table | null = null;
        let minDistance = Infinity;

        // Wir suchen aus ALLEN verfügbaren Tischen denjenigen, 
        // der am nächsten an IRGENDEINEM Tisch im aktuellen Cluster steht.
        for (const candidate of availableTables) {
            if (usedIds.has(candidate.id)) continue; // Schon drin
            if ((candidate.level || 'EG') !== (startTable.level || 'EG')) continue; // Falsche Ebene

            // Prüfe Distanz zu jedem Tisch im Cluster (wir wollen andocken)
            for (const node of cluster) {
                const dist = getDistance(node, candidate);
                
                // Wir nehmen einfach den kleinsten Abstand, egal wie groß er ist
                if (dist < minDistance) {
                    minDistance = dist;
                    bestCandidate = candidate;
                }
            }
        }

        // Wenn wir einen Kandidaten haben, nehmen wir ihn (Distanz egal)
        if (bestCandidate) {
            cluster.push(bestCandidate);
            usedIds.add(bestCandidate.id);
            currentSeats += bestCandidate.seats;
        } else {
            // Keine weiteren Tische auf dieser Ebene verfügbar -> Cluster kann nicht vervollständigt werden
            return null;
        }
     }

     return cluster;
  };

  // --- HAUPTFUNKTION: VERFÜGBARKEIT PRÜFEN ---
  const checkAvailability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSearchComplete) {
      alert("Bitte Name, Datum, Uhrzeit und Personenanzahl eingeben.");
      return;
    }

    // Prüfe, ob das Datum nicht in der Vergangenheit liegt
    const today = new Date().toISOString().split('T')[0];
    if (date < today) {
      alert("Reservierungen können nicht in der Vergangenheit erstellt werden!");
      return;
    }

    setLoading(true);

    // 1. Blockierte Tische laden (für 2-Stunden-Fenster)
    let reservationsQuery = supabase
      .from('reservations')
      .select('table_id, time')
      .eq('date', date);
    if (restaurantId) {
      reservationsQuery = reservationsQuery.eq('restaurant_id', restaurantId);
    }
    const { data: blocked } = await reservationsQuery;

    // Berechne 2-Stunden-Fenster (von time bis time + 2 Stunden)
    const [hours, minutes] = time.split(':').map(Number);
    const bookingStart = hours * 60 + minutes;
    const bookingEnd = bookingStart + 120; // 2 Stunden = 120 Minuten

    // Filtere Blockierungen, die mit unserem Zeitfenster überlappen
    const blockedLabels = blocked ? blocked
      .filter((b: { time: string; table_id: string }) => {
        const [resHours, resMinutes] = b.time.split(':').map(Number);
        const resStart = resHours * 60 + resMinutes;
        const resEnd = resStart + 120; // Angenommen: jede Reservierung dauert 2 Stunden
        
        // Überlappung: resStart < bookingEnd UND resEnd > bookingStart
        return resStart < bookingEnd && resEnd > bookingStart;
      })
      .map((b: { table_id: string }) => b.table_id) : [];

    // 2. Verfügbare Tische
    const freeTables = allTables.filter(t => !blockedLabels.includes(t.label));

    // Set für Deduplizierung
    const uniqueResultKeys = new Set<string>();
    const results: SearchResult[] = [];

    // 3. Für JEDEN freien Tisch schauen, ob er (allein oder im Team) die Gruppe unterbringen kann
    for (const startTable of freeTables) {
        // Findet den besten Cluster startend bei diesem Tisch (OHNE MAX DISTANZ)
        const cluster = findBestCluster(startTable, freeTables, guestCount);

        if (cluster) {
            // Sortieren der IDs für Eindeutigkeit
            const sortedIds = cluster.map(t => t.id).sort((a,b) => a - b);
            const uniqueKey = sortedIds.join('-');

            if (!uniqueResultKeys.has(uniqueKey)) {
                uniqueResultKeys.add(uniqueKey);
                
                const totalSeats = cluster.reduce((sum, t) => sum + t.seats, 0);
                const sortedLabels = cluster.map(t => t.label).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

                results.push({
                    type: cluster.length === 1 ? 'single' : 'combo',
                    labels: sortedLabels,
                    tableIds: sortedIds,
                    level: startTable.level || 'EG',
                    totalSeats: totalSeats,
                    displayLabel: sortedLabels.join(' + ')
                });
            }
        }
    }

    // Sortierung: 
    // 1. Singles vor Combos
    // 2. Am wenigsten leere Stühle ("Verschnitt")
    // 3. Alphabetisch
    results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'single' ? -1 : 1;
        const diffSeats = (a.totalSeats - guestCount) - (b.totalSeats - guestCount);
        if (diffSeats !== 0) return diffSeats;
        return a.displayLabel.localeCompare(b.displayLabel);
    });

    setSearchResults(results.slice(0, 3));
    setHasSearched(true);
    setLoading(false);
  };

  // --- BUCHEN ---
  const bookOption = async (option: SearchResult) => {
    if (!isSearchComplete) {
      alert("Bitte zuerst alle Suchdaten eingeben.");
      return;
    }

    const promises = option.labels.map(label => {
       return supabase.from('reservations').insert({
          table_id: label,
          date: date,
          time: time,
          guest_name: guestName,
          guests_count: guestCount,
          restaurant_id: restaurantId,
       });
    });

    const responses = await Promise.all(promises);
    if (responses.some(r => r.error)) {
      alert("Fehler beim Speichern.");
    } else {
      alert(`${option.displayLabel} reserviert!`);
      // UI Update
      setSearchResults(prev => prev.filter(res => {
         const overlaps = res.tableIds.some(id => option.tableIds.includes(id));
         return !overlaps; 
      }));
      setHasSearched(false);
      setSearchResults([]);
    }
  };

  // Filter für Anzeige
  const filteredDisplay = currentLevel === 'Alle' 
    ? searchResults 
    : searchResults.filter(r => r.level === currentLevel);

  return (
    <div className="min-h-screen bg-app-bg text-app-text font-sans p-4 md:p-8 flex flex-col items-center">
      
      {/* HEADER */}
      <div className="w-full max-w-4xl flex justify-between items-center mb-8 border-b border-app-muted/20 pb-4">
        <h1 className="text-3xl font-bold text-app-accent">Smart Booking</h1>
        <Logo width={120} height={40} />
      </div>

      <div className="w-full max-w-4xl space-y-6">
        <div className="bg-app-card p-5 md:p-6 rounded-2xl shadow-xl border border-app-muted/20">
          <h2 className="text-xl font-bold mb-4 text-app-text">Reservierung suchen</h2>
          <form onSubmit={checkAvailability} className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-4">
              <label className="text-xs uppercase font-bold text-app-muted">Name</label>
              <input type="text" required placeholder="Name der Reservierung" className="w-full bg-app-bg border border-app-muted/30 rounded-lg p-3 text-app-text focus:border-app-primary outline-none" value={guestName} onChange={(e) => { setGuestName(e.target.value); setHasSearched(false); }} />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs uppercase font-bold text-app-muted">Datum</label>
              <input type="date" required min={new Date().toISOString().split('T')[0]} className="w-full bg-app-bg border border-app-muted/30 rounded-lg p-3 outline-none focus:border-app-primary text-app-text" value={date} onChange={(e) => { setDate(e.target.value); setHasSearched(false); }} />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs uppercase font-bold text-app-muted">Uhrzeit</label>
              <input type="time" required step={900} className="w-full bg-app-bg border border-app-muted/30 rounded-lg p-3 outline-none focus:border-app-primary text-app-text" value={time} onChange={(e) => { setTime(e.target.value); setHasSearched(false); }} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs uppercase font-bold text-app-muted">Personen</label>
              <input type="number" required min="1" className="w-full bg-app-bg border border-app-muted/30 rounded-lg p-3 outline-none focus:border-app-primary text-app-text" value={guestCount} onChange={(e) => { setGuestCount(Math.max(1, parseInt(e.target.value, 10) || 1)); setHasSearched(false); }} />
            </div>
            <div className="md:col-span-12 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap gap-2">
                {TIME_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setTime(suggestion);
                      setHasSearched(false);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${time === suggestion ? 'border-app-primary bg-app-primary text-white' : 'border-app-muted/30 bg-app-bg text-app-muted hover:text-app-text'}`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <button type="submit" disabled={loading || !isSearchComplete} className="w-full bg-app-primary hover:bg-app-primary/80 disabled:bg-app-muted/30 disabled:text-app-muted disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl shadow-lg transition-all active:scale-95 md:w-48">
                {loading ? "Suche..." : "Tische suchen"}
              </button>
            </div>
          </form>
        </div>

        {/* --- ERGEBNISSE --- */}
        <div className="flex flex-col h-full">
          
          {hasSearched && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-2 custom-scrollbar">
                  {levels.map(lvl => (
                      <button 
                        key={lvl} 
                        onClick={() => setCurrentLevel(lvl)}
                        className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${currentLevel === lvl ? 'bg-app-accent text-white' : 'bg-app-card text-app-muted hover:bg-app-card/80'}`}
                      >
                          {lvl}
                      </button>
                  ))}
              </div>
          )}

          <div className="bg-app-card rounded-2xl shadow-xl border border-app-muted/20 flex-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-app-muted/20 bg-app-card/50 backdrop-blur-sm flex justify-between items-center">
                <h2 className="font-bold text-lg text-app-text">
                    {hasSearched ? `Vorschläge (${filteredDisplay.length})` : 'Ergebnisse'}
                </h2>
            </div>

            <div className="overflow-y-auto p-4 custom-scrollbar max-h-[600px]">
                {!hasSearched ? (
                    <div className="text-center text-app-muted py-20">Bitte zuerst die Suchdaten eingeben.</div>
                ) : filteredDisplay.length === 0 ? (
                    <div className="text-center py-10 space-y-3">
                        <div className="text-red-400">
                           Keine passenden Tische in <b>{currentLevel}</b>.
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredDisplay.map((option, idx) => (
                            <div key={idx} className={`group flex items-center justify-between p-4 rounded-xl transition-all border animate-in fade-in slide-in-from-bottom-2 ${option.type === 'combo' ? 'bg-app-primary/10 border-app-primary/30 hover:border-app-primary' : 'bg-app-bg border-app-muted/20 hover:border-app-accent'}`}>
                                <div className="min-w-0">
                                    <div className="font-black text-xl text-app-text flex items-center gap-2 flex-wrap">
                                        <span className="truncate">{option.type === 'combo' ? `Tische ${option.displayLabel}` : `Tisch ${option.displayLabel}`}</span>
                                        {option.type === 'combo' && <span className="text-[10px] bg-app-primary text-white px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">Kombi</span>}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs font-bold text-app-muted mt-1">
                                        <span className="uppercase">{option.level}</span>
                                        <span className="w-1 h-1 rounded-full bg-app-muted/50"></span>
                                        <span className={option.totalSeats >= guestCount ? "text-app-accent" : ""}>{option.totalSeats} Plätze frei</span>
                                    </div>
                                </div>
                                
                                <button 
                                    onClick={() => bookOption(option)}
                                    disabled={!isSearchComplete}
                                    className={`px-6 py-3 rounded-lg font-bold transition-all active:scale-95 flex items-center gap-2 shrink-0 disabled:bg-app-muted/30 disabled:text-app-muted disabled:cursor-not-allowed ${option.type === 'combo' ? 'bg-app-primary hover:bg-app-primary/80 text-white' : 'bg-app-primary text-white hover:bg-app-primary/80'}`}
                                >
                                    <span>Buchen</span>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
