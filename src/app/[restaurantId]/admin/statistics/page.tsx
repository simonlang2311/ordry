'use client';
import { notFound, useParams } from "next/navigation";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DEFAULT_RESTAURANT_FEATURES, RestaurantFeatures, loadRestaurantFeatures } from '@/lib/features';
import * as XLSX from 'xlsx';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

interface StatisticsData {
  orderList: Array<{
    id: number;
    date: string;
    time: string;
    table: string;
    status: string;
    itemCount: number;
    items: string[];
    revenue: number;
  }>;
  orderCountByDay: Array<{ date: string; orders: number; revenue: number }>;
  topDishes: Array<{ name: string; count: number }>;
  todayStats: { date: string; orders: number; revenue: number };
  last7DaysAvg: number;
  ordersByHour: Array<{ hour: string; orders: number; revenue: number }>;
  revenueByTable: Array<{ table: string; orders: number; revenue: number }>;
  summary: {
    totalOrders: number;
    totalRevenue: number;
    avgOrderValue: number;
    uniqueDishes: number;
  };
}

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'];

function StatisticsContent() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;
  const [stats, setStats] = useState<StatisticsData | null>(null);
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

    const fetchStats = async () => {
      try {
        const response = await fetch('/api/statistics');
        if (!response.ok) throw new Error('Fehler beim Laden der Statistiken');
        const data = await response.json();
        setStats(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [features.statisticsEnabled, featuresLoaded]);

  if (featuresLoaded && !features.statisticsEnabled) {
    notFound();
  }

  if (!featuresLoaded || loading) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text p-8 flex items-center justify-center">
        <div className="text-2xl font-bold">Lade Statistiken...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-6 text-red-500">
            Fehler: {error}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="min-h-screen bg-app-bg text-app-text p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between border-b border-app-muted/20 pb-4">
          <div>
            <h1 className="text-4xl font-black mb-2">Statistiken & Analysen</h1>
            <p className="text-app-muted">Detaillierte Auswertung Ihrer Geschäftsdaten</p>
          </div>
          <div className="flex gap-3 mt-4 md:mt-0">
            <button
              onClick={() => {
                if (!stats) return;
                
                // Erstelle Workbook
                const wb = XLSX.utils.book_new();
                
                // Sheet 1: Übersicht
                const summaryData = [
                  ['Statistik-Übersicht', ''],
                  ['Datum', new Date().toLocaleDateString('de-DE')],
                  ['', ''],
                  ['Gesamt Bestellungen', stats.summary.totalOrders],
                  ['Gesamt Umsatz', `${stats.summary.totalRevenue.toFixed(2)} €`],
                  ['Durchschnitt pro Bestellung', `${stats.summary.avgOrderValue.toFixed(2)} €`],
                  ['Unterschiedliche Gerichte', stats.summary.uniqueDishes],
                  ['', ''],
                  ['Heute', ''],
                  ['Bestellungen', stats.todayStats.orders],
                  ['Umsatz', `${stats.todayStats.revenue.toFixed(2)} €`],
                  ['', ''],
                  ['Top Tisch nach Umsatz', stats.revenueByTable[0]?.table || '-'],
                  ['Top Tisch Umsatz', stats.revenueByTable[0] ? `${stats.revenueByTable[0].revenue.toFixed(2)} €` : '-'],
                  ['', ''],
                  ['7-Tage Durchschnitt', `${stats.last7DaysAvg} Bestellungen/Tag`],
                ];
                const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
                XLSX.utils.book_append_sheet(wb, ws1, 'Übersicht');
                
                // Sheet 2: Bestellungen nach Tag
                const dailyData = [
                  ['Datum', 'Bestellungen', 'Umsatz (€)'],
                  ...stats.orderCountByDay.map(day => [
                    day.date,
                    day.orders,
                    day.revenue
                  ])
                ];
                const ws2 = XLSX.utils.aoa_to_sheet(dailyData);
                XLSX.utils.book_append_sheet(wb, ws2, 'Tagesstatistik');
                
                // Sheet 3: Top Gerichte
                const dishData = [
                  ['Rang', 'Gericht', 'Anzahl Bestellungen'],
                  ...stats.topDishes.map((dish, idx) => [
                    idx + 1,
                    dish.name,
                    dish.count
                  ])
                ];
                const ws3 = XLSX.utils.aoa_to_sheet(dishData);
                XLSX.utils.book_append_sheet(wb, ws3, 'Top Gerichte');
                
                // Sheet 4: Bestellungen nach Uhrzeit
                const hourlyData = [
                  ['Uhrzeit', 'Bestellungen', 'Umsatz (€)'],
                  ...stats.ordersByHour.map(hour => [
                    hour.hour,
                    hour.orders,
                    hour.revenue
                  ])
                ];
                const ws4 = XLSX.utils.aoa_to_sheet(hourlyData);
                XLSX.utils.book_append_sheet(wb, ws4, 'Stündliche Verteilung');

                // Sheet 5: Umsatz nach Tisch
                const tableRevenueData = [
                  ['Rang', 'Tisch', 'Bestellungen', 'Umsatz (€)'],
                  ...stats.revenueByTable.map((table, idx) => [
                    idx + 1,
                    table.table,
                    table.orders,
                    table.revenue
                  ])
                ];
                const ws5 = XLSX.utils.aoa_to_sheet(tableRevenueData);
                XLSX.utils.book_append_sheet(wb, ws5, 'Umsatz nach Tisch');

                const orderListData = [
                  ['Bestell-ID', 'Datum', 'Uhrzeit', 'Tisch', 'Status', 'Positionen', 'Einnahmen (€)', 'Artikel'],
                  ...stats.orderList.map((order) => [
                    order.id,
                    order.date,
                    order.time,
                    order.table,
                    order.status,
                    order.itemCount,
                    order.revenue,
                    order.items.join(', ')
                  ])
                ];
                const ws6 = XLSX.utils.aoa_to_sheet(orderListData);
                XLSX.utils.book_append_sheet(wb, ws6, 'Alle Bestellungen');
                
                // Datei speichern
                XLSX.writeFile(wb, `statistiken-${new Date().toISOString().split('T')[0]}.xlsx`);
              }}
              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg transition-colors font-bold"
            >
              Excel Export
            </button>
            <Link
              href={`/${restaurantId}/admin`}
              className="bg-app-card border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/20 transition-colors font-bold"
            >
              ← Dashboard
            </Link>
          </div>
        </div>

        {/* KPI CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-app-card border border-app-primary/20 rounded-lg p-6 shadow-sm">
            <p className="text-app-muted text-sm font-bold mb-2">GESAMT BESTELLUNGEN</p>
            <p className="text-3xl font-black text-app-primary">{stats.summary.totalOrders}</p>
          </div>

          <div className="bg-app-card border border-green-500/20 rounded-lg p-6 shadow-sm">
            <p className="text-app-muted text-sm font-bold mb-2">GESAMT UMSATZ</p>
            <p className="text-3xl font-black text-green-500">{formatCurrency(stats.summary.totalRevenue)}</p>
          </div>

          <div className="bg-app-card border border-blue-500/20 rounded-lg p-6 shadow-sm">
            <p className="text-app-muted text-sm font-bold mb-2">DURCHSCHNITT PRO BESTELLUNG</p>
            <p className="text-3xl font-black text-blue-500">{formatCurrency(stats.summary.avgOrderValue)}</p>
          </div>

          <div className="bg-app-card border border-purple-500/20 rounded-lg p-6 shadow-sm">
            <p className="text-app-muted text-sm font-bold mb-2">UNTERSCHIEDLICHE GERICHTE</p>
            <p className="text-3xl font-black text-purple-500">{stats.summary.uniqueDishes}</p>
          </div>
        </div>

        {/* HEUTE vs. DURCHSCHNITT */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm">
            <h3 className="text-xl font-bold mb-4">Heutiger Geschäftstag</h3>
            <p className="text-app-muted text-sm mb-4">{stats.todayStats.date}</p>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Bestellungen:</span>
                <span className="font-bold text-lg">{stats.todayStats.orders}</span>
              </div>
              <div className="flex justify-between">
                <span>Umsatz:</span>
                <span className="font-bold text-lg text-green-500">{formatCurrency(stats.todayStats.revenue)}</span>
              </div>
            </div>
          </div>

          <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm">
            <h3 className="text-xl font-bold mb-4">7-Tage Durchschnitt</h3>
            <p className="text-app-muted text-sm mb-4">Durchschnittliche Bestellungen pro Tag</p>
            <div className="text-4xl font-black text-app-primary">{stats.last7DaysAvg} Bestellungen</div>
            <p className="text-app-muted text-sm mt-4">
              {stats.orderCountByDay.slice(-7).length > 0 ? `basierend auf ${stats.orderCountByDay.slice(-7).length} Tagen` : 'Keine Daten verfügbar'}
            </p>
          </div>
        </div>

        <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm mb-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
            <div>
              <h3 className="text-xl font-bold">Bestellliste & Einnahmen</h3>
              <p className="text-app-muted text-sm">Öffne die Liste aller bereits bezahlten Bestellungen auf einer eigenen Seite inklusive Excel-Export.</p>
            </div>
            <Link
              href={`/${restaurantId}/admin/statistics/orders`}
              className="inline-flex items-center justify-center bg-app-primary text-white px-4 py-2 rounded-lg font-bold hover:brightness-110 transition-colors"
            >
              Liste öffnen
            </Link>
          </div>
          <div className="rounded-lg border border-app-muted/15 bg-app-bg/50 px-4 py-6 text-app-muted text-sm flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <span>{stats.orderList.length} bezahlte Bestellungen verfügbar, stornierte Positionen sind bereits herausgefiltert.</span>
            <span className="font-bold text-app-text">Gesamteinnahmen: {formatCurrency(stats.orderList.reduce((sum, order) => sum + order.revenue, 0))}</span>
          </div>
        </div>

        {/* BESTELLUNGEN NACH TAGE - BALKENDIAGRAMM */}
        <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm mb-8">
          <h3 className="text-xl font-bold mb-6">Bestellungen nach Tagen</h3>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={stats.orderCountByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis 
                dataKey="date" 
                stroke="rgba(255,255,255,0.5)"
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px'
                }}
                formatter={(value: any) => value}
                labelFormatter={(label: any) => `${label}`}
              />
              <Legend />
              <Bar dataKey="orders" fill="#3b82f6" name="Bestellungen" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* UMSATZ NACH TAGEN - LINIENDIAGRAMM */}
        <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm mb-8">
          <h3 className="text-xl font-bold mb-6">Umsatzentwicklung nach Tagen</h3>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={stats.orderCountByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis 
                dataKey="date" 
                stroke="rgba(255,255,255,0.5)"
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px'
                }}
                formatter={(value: any) => `${value.toFixed(2).replace('.', ',')} €`}
                labelFormatter={(label: any) => `${label}`}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="revenue" 
                stroke="#10b981" 
                name="Umsatz (€)"
                strokeWidth={2}
                dot={{ fill: '#10b981', r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* BESTELLUNGEN NACH UHRZEIT */}
        <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm mb-8">
          <h3 className="text-xl font-bold mb-6">Zeitliche Verteilung der Bestellungen</h3>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={stats.ordersByHour}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis 
                dataKey="hour" 
                stroke="rgba(255,255,255,0.5)"
                tick={{ fontSize: 12 }}
              />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <Bar dataKey="orders" fill="#f59e0b" name="Bestellungen" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* UMSATZ NACH TISCH */}
        <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm mb-8">
          <h3 className="text-xl font-bold mb-6">Umsatz nach Tisch</h3>
          {stats.revenueByTable[0] && (
            <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
              <p className="text-sm text-app-muted">Umsatzstärkster Tisch</p>
              <p className="text-lg font-black text-green-500">
                {stats.revenueByTable[0].table} · {stats.revenueByTable[0].revenue.toFixed(2).replace('.', ',')} €
              </p>
            </div>
          )}
          {stats.revenueByTable.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={stats.revenueByTable}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis
                  dataKey="table"
                  stroke="rgba(255,255,255,0.5)"
                  tick={{ fontSize: 12 }}
                  angle={-25}
                  textAnchor="end"
                  height={80}
                />
                <YAxis stroke="rgba(255,255,255,0.5)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px'
                  }}
                  formatter={(value: any, name: any) =>
                    name === 'Umsatz (€)'
                      ? [`${Number(value).toFixed(2).replace('.', ',')} €`, name]
                      : [value, name]
                  }
                />
                <Legend />
                <Bar dataKey="revenue" fill="#22c55e" name="Umsatz (€)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-app-muted">Keine Daten verfügbar</p>
          )}
        </div>

        {/* TOP 10 GERICHTE */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm">
            <h3 className="text-xl font-bold mb-6">Top 10 Beliebteste Gerichte</h3>
            <div className="space-y-3">
              {stats.topDishes.map((dish, index) => (
                <div key={index} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="w-8 h-8 rounded-full bg-app-primary/20 flex items-center justify-center text-sm font-bold">
                      {index + 1}
                    </span>
                    <span className="font-bold truncate text-sm md:text-base">{dish.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-app-muted/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-app-primary rounded-full transition-all"
                        style={{
                          width: `${(dish.count / Math.max(...stats.topDishes.map(d => d.count))) * 100}%`
                        }}
                      />
                    </div>
                    <span className="font-bold text-app-primary min-w-12 text-right">{dish.count}x</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PIE CHART - TOP 5 */}
          <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm flex flex-col items-center">
            <h3 className="text-xl font-bold mb-6">Top 5 Verteilung</h3>
            {stats.topDishes.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.topDishes.slice(0, 5)}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label
                    >
                      {stats.topDishes.slice(0, 5).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => `${value}x`} />
                  </PieChart>
                </ResponsiveContainer>

                <div className="mt-4 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {stats.topDishes.slice(0, 5).map((dish, index) => (
                    <div key={`${dish.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-app-muted/5 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-3 w-3 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="truncate">{dish.name}</span>
                      </div>
                      <span className="font-bold text-app-primary">{dish.count}x</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-app-muted">Keine Daten verfügbar</p>
            )}
          </div>
        </div>

        {/* PERFORMANCE INSIGHTS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm">
            <h3 className="text-xl font-bold mb-4">Beste Geschäftstage</h3>
            <div className="space-y-3">
              {[...stats.orderCountByDay]
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5)
                .map((day, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3 bg-app-muted/5 rounded-lg">
                    <div>
                      <div className="font-bold">{day.date}</div>
                      <div className="text-sm text-app-muted">{day.orders} Bestellungen</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-green-500">{day.revenue.toFixed(2).replace('.', ',')} €</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm">
            <h3 className="text-xl font-bold mb-4">Trendanalyse</h3>
            <div className="space-y-4">
              {(() => {
                const recent = stats.orderCountByDay.slice(-7);
                const previous = stats.orderCountByDay.slice(-14, -7);
                const recentAvg = recent.length > 0 ? recent.reduce((sum, d) => sum + d.orders, 0) / recent.length : 0;
                const previousAvg = previous.length > 0 ? previous.reduce((sum, d) => sum + d.orders, 0) / previous.length : 0;
                const trend = recentAvg - previousAvg;
                const trendPercent = previousAvg > 0 ? ((trend / previousAvg) * 100) : 0;
                
                return (
                  <>
                    <div className="p-4 bg-app-muted/5 rounded-lg">
                      <div className="text-sm text-app-muted mb-2">Bestellungstrend (7 Tage)</div>
                      <div className={`text-2xl font-bold ${
                        trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-app-text'
                      }`}>
                        {trend > 0 ? '↗' : trend < 0 ? '↘' : '→'} {trendPercent.toFixed(1)}%
                      </div>
                      <div className="text-sm text-app-muted mt-1">
                        {trend > 0 ? 'Steigend' : trend < 0 ? 'Fallend' : 'Stabil'}
                      </div>
                    </div>
                    <div className="p-4 bg-app-muted/5 rounded-lg">
                      <div className="text-sm text-app-muted mb-2">Durchschnitt letzte 7 Tage</div>
                      <div className="text-2xl font-bold">{recentAvg.toFixed(1)} Bestellungen/Tag</div>
                    </div>
                    <div className="p-4 bg-app-muted/5 rounded-lg">
                      <div className="text-sm text-app-muted mb-2">Spitzenstunde</div>
                      <div className="text-2xl font-bold">
                        {stats.ordersByHour.reduce((max, hour) => hour.orders > max.orders ? hour : max).hour}
                      </div>
                      <div className="text-sm text-app-muted mt-1">
                        {stats.ordersByHour.reduce((max, hour) => hour.orders > max.orders ? hour : max).orders} Bestellungen
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* TABELLE - DETAILLIERTE GERICHTE */}
        <div className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm">
          <h3 className="text-xl font-bold mb-6">Detaillierte Gerichteübersicht</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-muted/20">
                  <th className="text-left py-3 px-4 font-bold">#</th>
                  <th className="text-left py-3 px-4 font-bold">Gericht</th>
                  <th className="text-right py-3 px-4 font-bold">Anzahl</th>
                  <th className="text-right py-3 px-4 font-bold">Anteil</th>
                </tr>
              </thead>
              <tbody>
                {stats.topDishes.map((dish, index) => {
                  const totalCount = stats.topDishes.reduce((sum, d) => sum + d.count, 0);
                  const percentage = ((dish.count / totalCount) * 100).toFixed(1);
                  return (
                    <tr key={index} className="border-b border-app-muted/10 hover:bg-app-muted/5 transition-colors">
                      <td className="py-3 px-4 font-bold">{index + 1}</td>
                      <td className="py-3 px-4">{dish.name}</td>
                      <td className="py-3 px-4 text-right font-bold">{dish.count}</td>
                      <td className="py-3 px-4 text-right">{percentage}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StatisticsPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <StatisticsContent />
    </ProtectedRoute>
  );
}
