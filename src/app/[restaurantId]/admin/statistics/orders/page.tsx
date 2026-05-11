'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DEFAULT_RESTAURANT_FEATURES, RestaurantFeatures, loadRestaurantFeatures } from '@/lib/features';

type OrderListEntry = {
  id: number;
  date: string;
  time: string;
  table: string;
  status: string;
  itemCount: number;
  items: string[];
  revenue: number;
};

type StatisticsOrderListResponse = {
  orderList: OrderListEntry[];
};

function StatisticsOrdersContent() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;
  const [orders, setOrders] = useState<OrderListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<RestaurantFeatures>(DEFAULT_RESTAURANT_FEATURES);
  const [featuresLoaded, setFeaturesLoaded] = useState(false);

  const formatCurrency = (value: number) => `${value.toFixed(2).replace('.', ',')} €`;

  useEffect(() => {
    let isActive = true;

    const fetchFeatures = async () => {
      const nextFeatures = await loadRestaurantFeatures(restaurantId);
      if (!isActive) return;
      setFeatures(nextFeatures);
      setFeaturesLoaded(true);
    };

    void fetchFeatures();

    return () => {
      isActive = false;
    };
  }, [restaurantId]);

  useEffect(() => {
    if (!featuresLoaded || !features.statisticsEnabled) return;

    const fetchOrderList = async () => {
      try {
        const response = await fetch(`/api/statistics?restaurantId=${encodeURIComponent(restaurantId)}`);
        if (!response.ok) throw new Error('Fehler beim Laden der Bestellliste');
        const data: StatisticsOrderListResponse = await response.json();
        setOrders(data.orderList || []);
      } catch (err: any) {
        setError(err.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };

    fetchOrderList();
  }, [features.statisticsEnabled, featuresLoaded, restaurantId]);

  if (featuresLoaded && !features.statisticsEnabled) {
    notFound();
  }

  const totalRevenue = useMemo(
    () => orders.reduce((sum, order) => sum + order.revenue, 0),
    [orders]
  );

  const totalItems = useMemo(
    () => orders.reduce((sum, order) => sum + order.itemCount, 0),
    [orders]
  );

  const exportToExcel = () => {
    const workbook = XLSX.utils.book_new();
    const rows = [
      ['Bestell-ID', 'Datum', 'Uhrzeit', 'Tisch', 'Status', 'Positionen', 'Einnahmen (€)', 'Artikel'],
      ...orders.map((order) => [
        order.id,
        order.date,
        order.time,
        order.table,
        order.status,
        order.itemCount,
        order.revenue,
        order.items.join(', '),
      ]),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bestellliste');
    XLSX.writeFile(workbook, `bestellliste-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text p-8 flex items-center justify-center">
        <div className="text-2xl font-bold">Lade Bestellliste...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-6 text-red-400">
            Fehler: {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg text-app-text p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-col gap-4 border-b border-app-muted/20 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-4xl font-black mb-2">Bestellliste & Einnahmen</h1>
            <p className="text-app-muted">Alle bereits bezahlten Bestellungen auf einer eigenen Seite, ohne stornierte Positionen.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={exportToExcel}
              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors font-bold text-white"
            >
              Excel Export
            </button>
            <Link
              href={`/${restaurantId}/admin/statistics`}
              className="bg-app-card border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/20 transition-colors font-bold"
            >
              ← Statistiken
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm">
            <p className="text-app-muted text-sm font-bold mb-2">BESTELLUNGEN</p>
            <p className="text-3xl font-black text-app-primary">{orders.length}</p>
          </div>
          <div className="bg-app-card border border-green-500/20 rounded-lg p-6 shadow-sm">
            <p className="text-app-muted text-sm font-bold mb-2">POSITIONEN</p>
            <p className="text-3xl font-black text-green-500">{totalItems}</p>
          </div>
          <div className="bg-app-card border border-blue-500/20 rounded-lg p-6 shadow-sm">
            <p className="text-app-muted text-sm font-bold mb-2">EINNAHMEN</p>
            <p className="text-3xl font-black text-blue-500">{formatCurrency(totalRevenue)}</p>
          </div>
        </div>

        <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm">
          {orders.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-app-muted/15">
              <table className="w-full text-sm">
                <thead className="bg-app-bg/70">
                  <tr className="border-b border-app-muted/20 text-app-muted uppercase text-xs">
                    <th className="text-left py-3 px-4 font-bold">ID</th>
                    <th className="text-left py-3 px-4 font-bold">Datum</th>
                    <th className="text-left py-3 px-4 font-bold">Zeit</th>
                    <th className="text-left py-3 px-4 font-bold">Tisch</th>
                    <th className="text-left py-3 px-4 font-bold">Status</th>
                    <th className="text-right py-3 px-4 font-bold">Positionen</th>
                    <th className="text-right py-3 px-4 font-bold">Einnahmen</th>
                    <th className="text-left py-3 px-4 font-bold">Artikel</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-app-muted/10 hover:bg-app-muted/5 transition-colors align-top">
                      <td className="py-3 px-4 font-bold text-app-primary">#{order.id}</td>
                      <td className="py-3 px-4">{order.date}</td>
                      <td className="py-3 px-4">{order.time}</td>
                      <td className="py-3 px-4">{order.table}</td>
                      <td className="py-3 px-4 capitalize">{order.status}</td>
                      <td className="py-3 px-4 text-right font-bold">{order.itemCount}</td>
                      <td className="py-3 px-4 text-right font-bold text-green-500">{formatCurrency(order.revenue)}</td>
                      <td className="py-3 px-4 text-app-muted min-w-[320px]">{order.items.join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-app-muted/15 bg-app-bg/50 px-4 py-6 text-app-muted text-sm">
              Keine bezahlten Bestellungen gefunden.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StatisticsOrdersPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <StatisticsOrdersContent />
    </ProtectedRoute>
  );
}
