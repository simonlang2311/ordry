"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/lib/supabase";

type ReservationRow = {
  id: number;
  table_id: string;
  guest_name: string;
  date: string;
  time: string;
  guests_count: number;
};

type GroupedReservation = {
  ids: number[];
  guestName: string;
  date: string;
  time: string;
  tableLabels: string[];
  guests: number;
};

const formatDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

function StaffReservationsContent({ restaurantId }: { restaurantId: string }) {
  const [reservations, setReservations] = useState<GroupedReservation[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState("");
  const [tableFilters, setTableFilters] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const waiterHref = restaurantId ? `/${restaurantId}/waiter` : "/waiter";
  const homeHref = restaurantId ? `/${restaurantId}` : "/";

  const loadReservations = async () => {
    setLoading(true);

    const today = new Date().toISOString().split("T")[0];
    let query = supabase
      .from("reservations")
      .select("id, table_id, guest_name, date, time, guests_count")
      .gte("date", today)
      .order("date", { ascending: true })
      .order("time", { ascending: true });

    if (restaurantId) query = query.eq("restaurant_id", restaurantId);

    const { data, error } = await query;
    if (error) {
      alert(`Reservierungen konnten nicht geladen werden: ${error.message}`);
      setLoading(false);
      return;
    }

    const groupedMap = new Map<string, GroupedReservation>();
    (data as ReservationRow[] | null)?.forEach((row) => {
      const cleanTime = row.time.slice(0, 5);
      const key = `${row.date}|${cleanTime}|${row.guest_name}|${row.guests_count}`;
      const existing = groupedMap.get(key);

      if (existing) {
        existing.ids.push(row.id);
        existing.tableLabels.push(row.table_id);
      } else {
        groupedMap.set(key, {
          ids: [row.id],
          guestName: row.guest_name,
          date: row.date,
          time: cleanTime,
          tableLabels: [row.table_id],
          guests: row.guests_count,
        });
      }
    });

    const nextReservations = Array.from(groupedMap.values()).map((reservation) => ({
      ...reservation,
      tableLabels: reservation.tableLabels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }));

    const tableSet = new Set<string>();
    nextReservations.forEach((reservation) => {
      reservation.tableLabels.forEach((label) => tableSet.add(label));
    });

    setTables(Array.from(tableSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    setReservations(nextReservations);
    setLoading(false);
  };

  useEffect(() => {
    void loadReservations();
  }, [restaurantId]);

  const filteredReservations = useMemo(() => {
    return reservations.filter((reservation) => {
      const matchesDate = !dateFilter || reservation.date === dateFilter;
      const matchesTable = tableFilters.length === 0 || tableFilters.some((table) => reservation.tableLabels.includes(table));
      return matchesDate && matchesTable;
    });
  }, [reservations, dateFilter, tableFilters]);

  const stats = useMemo(() => {
    return {
      bookings: filteredReservations.length,
      guests: filteredReservations.reduce((sum, reservation) => sum + reservation.guests, 0),
    };
  }, [filteredReservations]);

  const deleteReservation = async (reservation: GroupedReservation) => {
    if (!confirm(`Reservierung von ${reservation.guestName} wirklich stornieren?`)) return;

    const { error } = await supabase.from("reservations").delete().in("id", reservation.ids);
    if (error) {
      alert(`Reservierung konnte nicht gelöscht werden: ${error.message}`);
      return;
    }

    await loadReservations();
  };

  return (
    <div className="min-h-screen bg-app-bg p-4 text-app-text md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-app-muted/20 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-black">Reservierungen</h1>
            <p className="text-sm text-app-muted">Alle Buchungen im Personalbereich.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={homeHref} className="rounded-lg border border-app-muted/30 bg-app-card px-4 py-2 text-sm font-bold hover:bg-app-muted/10">
              Home
            </Link>
            <Link href={waiterHref} className="rounded-lg bg-app-primary px-4 py-2 text-sm font-bold text-white hover:bg-app-primary/80">
              Kellner
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-3 rounded-xl border border-app-muted/20 bg-app-card p-4 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-bold uppercase text-app-muted">Datum</label>
            <input
              type="date"
              min={new Date().toISOString().split("T")[0]}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full rounded-lg border border-app-muted/30 bg-app-bg px-3 py-2 font-bold outline-none focus:border-app-primary"
            />
          </div>
          <div className="md:col-span-4">
            <label className="mb-1 block text-xs font-bold uppercase text-app-muted">Tisch</label>
            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded-lg border border-app-muted/30 bg-app-bg p-2">
              {tables.length === 0 ? (
                <span className="px-2 py-1 text-sm text-app-muted">Keine Tische</span>
              ) : (
                tables.map((table) => {
                  const selected = tableFilters.includes(table);
                  return (
                    <button
                      key={table}
                      type="button"
                      onClick={() => {
                        setTableFilters((prev) =>
                          prev.includes(table) ? prev.filter((item) => item !== table) : [...prev, table]
                        );
                      }}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                        selected
                          ? "border-app-primary bg-app-primary text-white"
                          : "border-app-muted/30 bg-app-card text-app-muted hover:text-app-text"
                      }`}
                    >
                      Tisch {table}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex items-end gap-2 md:col-span-4">
            <button
              onClick={() => {
                setDateFilter("");
                setTableFilters([]);
              }}
              className="w-full rounded-lg border border-app-muted/30 bg-app-bg px-3 py-2 text-sm font-bold hover:bg-app-muted/10"
            >
              Filter löschen
            </button>
            <button onClick={() => void loadReservations()} className="w-full rounded-lg bg-app-primary px-3 py-2 text-sm font-bold text-white hover:bg-app-primary/80">
              Aktualisieren
            </button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 md:w-96">
          <div className="rounded-xl border border-app-muted/20 bg-app-card p-4">
            <div className="text-xs font-bold uppercase text-app-muted">Buchungen</div>
            <div className="text-3xl font-black text-app-primary">{stats.bookings}</div>
          </div>
          <div className="rounded-xl border border-app-muted/20 bg-app-card p-4">
            <div className="text-xs font-bold uppercase text-app-muted">Gäste</div>
            <div className="text-3xl font-black text-app-accent">{stats.guests}</div>
          </div>
        </div>

        <section className="overflow-hidden rounded-xl border border-app-muted/20 bg-app-card shadow-lg">
          <div className="grid grid-cols-12 gap-3 border-b border-app-muted/20 bg-app-bg/60 px-4 py-3 text-xs font-bold uppercase text-app-muted">
            <div className="col-span-3">Datum</div>
            <div className="col-span-2">Zeit</div>
            <div className="col-span-3">Gast</div>
            <div className="col-span-2">Tische</div>
            <div className="col-span-1 text-center">Pers.</div>
            <div className="col-span-1 text-right"></div>
          </div>

          <div className="divide-y divide-app-muted/20">
            {loading ? (
              <div className="p-10 text-center text-app-muted">Lade Reservierungen...</div>
            ) : filteredReservations.length === 0 ? (
              <div className="p-10 text-center text-app-muted">Keine Reservierungen für diese Filter.</div>
            ) : (
              filteredReservations.map((reservation) => (
                <div key={reservation.ids.join("-")} className="grid grid-cols-12 gap-3 px-4 py-4 text-sm hover:bg-app-primary/5">
                  <div className="col-span-3 font-bold">{formatDate(reservation.date)}</div>
                  <div className="col-span-2 font-mono text-lg font-black text-app-primary">{reservation.time}</div>
                  <div className="col-span-3 truncate font-bold">{reservation.guestName}</div>
                  <div className="col-span-2 flex flex-wrap gap-1">
                    {reservation.tableLabels.map((label) => (
                      <span key={label} className="rounded border border-app-muted/30 bg-app-bg px-2 py-0.5 text-xs font-bold">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="col-span-1 text-center font-bold">{reservation.guests}</div>
                  <div className="col-span-1 text-right">
                    <button
                      onClick={() => void deleteReservation(reservation)}
                      className="rounded-lg px-2 py-1 font-bold text-app-muted hover:bg-app-danger/10 hover:text-app-danger"
                    >
                      X
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function StaffReservationsOverview({ restaurantId }: { restaurantId: string }) {
  return (
    <ProtectedRoute>
      <StaffReservationsContent restaurantId={restaurantId} />
    </ProtectedRoute>
  );
}
