'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useParams } from 'next/navigation';

type Table = {
  id: number;
  label: string;
  level: string;
  seats: number;
  x: number;
  y: number;
  shape?: string;
};

type TableStatus = {
  table: Table;
  isAvailable: boolean;
  hasOpenOrder: boolean;
};

export default function AvailableTablesPage() {
  const params = useParams();
  const restaurantId = typeof params?.restaurantId === 'string' ? params.restaurantId : process.env.NEXT_PUBLIC_RESTAURANT_ID;
  const [tableStatus, setTableStatus] = useState<TableStatus[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [currentLevel, setCurrentLevel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchTablesAndStatus = useCallback(async () => {
    setLoading(true);

    let tablesQuery = supabase
      .from('tables')
      .select('*')
      .order('label', { ascending: true });
    if (restaurantId) {
      tablesQuery = tablesQuery.eq('restaurant_id', restaurantId);
    }
    const { data: tablesData } = await tablesQuery;

    if (tablesData) {
      const uniqueLevels = Array.from(new Set(tablesData.map((t: Table) => t.level || 'EG')));
      setLevels(uniqueLevels.sort());
      setCurrentLevel((previousLevel) => previousLevel || uniqueLevels[0] || '');

      let ordersQuery = supabase
        .from('orders')
        .select('table_id')
        .neq('status', 'paid');
      if (restaurantId) {
        ordersQuery = ordersQuery.eq('restaurant_id', restaurantId);
      }
      const { data: ordersData } = await ordersQuery;

      const tableIdsWithOpenOrders = new Set(ordersData?.map((o: { table_id: string }) => o.table_id) || []);

      const status = tablesData.map((table: Table) => ({
        table,
        hasOpenOrder: tableIdsWithOpenOrders.has(table.label),
        isAvailable: !tableIdsWithOpenOrders.has(table.label)
      }));

      setTableStatus(status);
    }

    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    fetchTablesAndStatus();
  }, [fetchTablesAndStatus]);

  const filteredTables = tableStatus.filter(ts => (ts.table.level || 'EG') === currentLevel);
  const availableTables = filteredTables.filter(ts => ts.isAvailable);
  const occupiedTables = filteredTables.filter(ts => !ts.isAvailable);

  // Berechne maximale Koordinaten
  const maxX = Math.max(...filteredTables.map(ts => ts.table.x), 0);
  const maxY = Math.max(...filteredTables.map(ts => ts.table.y), 0);
  
  // Berechne Skalierungsfaktor basierend auf verfügbarer Breite
  const getScale = () => {
    if (!isMobile || maxX === 0) return 1;
    const availableWidth = window.innerWidth - 32; // 16px padding auf jeder Seite
    const neededWidth = maxX + 200; // Extra Platz für die Tischgröße und rechts Puffer
    return availableWidth / neededWidth;
  };
  
  const scale = getScale();
  const planWidth = Math.max((maxX * scale) + (isMobile ? 120 : 260), isMobile ? 360 : 1200);
  const planHeight = Math.max((maxY * scale) + (isMobile ? 120 : 260), isMobile ? 520 : 900);

  const getShapeStyle = (shape: string) => {
    if (isMobile) {
      switch (shape) {
        case 'square': return 'w-14 h-14 rounded-lg';
        case 'rect': return 'w-20 h-14 rounded-lg';
        default: return 'w-14 h-14 rounded-full';
      }
    }
    switch (shape) {
        case 'square': return 'w-32 h-32 rounded-2xl';
        case 'rect': return 'w-48 h-32 rounded-2xl';
        default: return 'w-32 h-32 rounded-full';
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-app-bg text-app-text font-sans p-2 md:p-8">
      
      <div className="max-w-7xl mx-auto mb-4 md:mb-8">
        <div className="flex justify-between items-center border-b border-app-muted/20 pb-2 md:pb-4">
          <h1 className="text-2xl md:text-4xl font-bold text-app-text">Tischübersicht</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        
        {/* STATISTIK - AUF DESKTOP UND MOBILE */}
        {!isMobile && (
          <div className="hidden md:grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-app-card p-4 rounded-xl border border-app-muted/20">
              <div className="text-xs text-app-muted uppercase font-bold mb-1">Gesamt</div>
              <div className="text-2xl font-black text-app-text">{filteredTables.length}</div>
            </div>
            <div className="bg-emerald-500/10 p-4 rounded-xl border border-emerald-500/30">
              <div className="text-xs text-emerald-300 uppercase font-bold mb-1">Frei</div>
              <div className="text-2xl font-black text-green-400">{availableTables.length}</div>
            </div>
            <div className="bg-red-500/10 p-4 rounded-xl border border-red-500/30">
              <div className="text-xs text-red-300 uppercase font-bold mb-1">Besetzt</div>
              <div className="text-2xl font-black text-red-400">{occupiedTables.length}</div>
            </div>
            <div className="bg-app-primary/10 p-4 rounded-xl border border-app-primary/30">
              <div className="text-xs text-app-primary uppercase font-bold mb-1">Auslastung</div>
              <div className="text-2xl font-black text-app-primary">
                {filteredTables.length > 0 ? Math.round((occupiedTables.length / filteredTables.length) * 100) : 0}%
              </div>
            </div>
          </div>
        )}

        {/* LEVEL FILTER */}
        <div className="flex px-0 md:px-4 gap-1 overflow-x-auto mb-4 md:mb-8 pb-2">
          {levels.map(lvl => (
            <button
              key={lvl}
              onClick={() => setCurrentLevel(lvl)}
              className={`px-3 md:px-4 py-1 md:py-2 text-xs md:text-sm font-bold rounded-lg transition-all whitespace-nowrap ${
                currentLevel === lvl 
                  ? 'bg-app-primary text-white' 
                  : 'bg-app-card text-app-muted hover:bg-app-muted/10 hover:text-app-text border border-app-muted/20'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        {/* MOBILE: NUR STATISTIK */}
        {isMobile ? (
          loading ? (
            <div className="text-center py-20 text-app-muted">Lade Tische...</div>
          ) : filteredTables.length === 0 ? (
            <div className="text-center py-20 text-app-muted">Keine Tische auf dieser Ebene</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-app-card p-4 rounded-xl border border-app-muted/20">
                <div className="text-xs text-app-muted uppercase font-bold mb-2">Gesamt</div>
                <div className="text-4xl font-black text-app-text">{filteredTables.length}</div>
              </div>
              <div className="bg-emerald-500/10 p-4 rounded-xl border border-emerald-500/30">
                <div className="text-xs text-green-300 uppercase font-bold mb-2">Frei</div>
                <div className="text-4xl font-black text-green-400">{availableTables.length}</div>
              </div>
              <div className="bg-red-500/10 p-4 rounded-xl border border-red-500/30">
                <div className="text-xs text-red-300 uppercase font-bold mb-2">Besetzt</div>
                <div className="text-4xl font-black text-red-400">{occupiedTables.length}</div>
              </div>
              <div className="bg-app-primary/10 p-4 rounded-xl border border-app-primary/30">
                <div className="text-xs text-app-primary uppercase font-bold mb-2">Auslastung</div>
                <div className="text-4xl font-black text-app-primary">
                  {filteredTables.length > 0 ? Math.round((occupiedTables.length / filteredTables.length) * 100) : 0}%
                </div>
              </div>
            </div>
          )
        ) : (
          /* DESKTOP: TISCHPLAN */
          <>
            {loading ? (
              <div className="text-center py-20 text-app-muted">Lade Tische...</div>
            ) : filteredTables.length === 0 ? (
              <div className="text-center py-20 text-app-muted">Keine Tische auf dieser Ebene</div>
            ) : (
              <div className="w-full overflow-x-auto overflow-y-hidden rounded-2xl bg-app-bg/60 pb-6">
                <div
                  className="relative p-2 md:p-8"
                  style={{
                    width: `${planWidth}px`,
                    height: `${planHeight}px`,
                    minWidth: isMobile ? '100%' : `${planWidth}px`,
                  }}
                >
                {filteredTables.map(ts => {
                  const isAvailable = ts.isAvailable;
                  const bgColor = isAvailable ? '#16a34a' : '#dc2626';
                  const borderColor = isAvailable ? '#86efac' : '#fca5a5';
                  
                  const leftPos = ts.table.x * scale;
                  const topPos = ts.table.y * scale;

                  return (
                    <div
                      key={ts.table.id}
                      style={{
                        position: 'absolute',
                        left: `${leftPos}px`,
                        top: `${topPos}px`,
                        touchAction: 'none'
                      }}
                      className="flex flex-col items-center"
                    >
                      <div
                        style={{
                          background: bgColor,
                          borderColor: borderColor
                        }}
                        className={`${getShapeStyle(ts.table.shape || 'round')} flex flex-col justify-center items-center shadow-lg md:shadow-2xl ${isMobile ? 'border-2' : 'border-4'} cursor-default transition-transform`}
                      >
                        <div className={`font-black text-white drop-shadow-md text-center ${isMobile ? 'text-xs px-0.5' : 'text-3xl px-2'} break-words`}>
                          {ts.table.label}
                        </div>
                      </div>
                      <div className="hidden md:block mt-2 text-xs font-bold text-app-text bg-app-card border border-app-muted/20 px-2 py-1 rounded">
                        {isAvailable ? 'Frei' : 'Besetzt'}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
