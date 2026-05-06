import { assertSupabaseConfigured, supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

type StatisticsOrder = {
  id: string | number;
  created_at: string;
  table_id?: string | number | null;
  status?: string | null;
  items?: string[] | null;
  total_price?: number | null;
};

export async function GET() {
  try {
    assertSupabaseConfigured();
    const ORDER_META_PREFIXES = ['[[shadow]]', '[[station:food]]', '[[station:drink]]'];

    const cleanDishName = (value: string) => {
      let name = value.trim();

      // Falls versehentlich verschachtelte Mengen gespeichert wurden (z.B. "1x 1x Schnitzel")
      while (/^\d+x\s+/i.test(name)) {
        name = name.replace(/^\d+x\s+/i, '').trim();
      }

      return name
        .split(/ \((?:\u{1F4DD}|Notiz:)\s*/u)[0]
        .split(' - ')[0]
        .split(' – ')[0]
        .trim();
    };

    const isTrackableDish = (value: string) => {
      const normalized = value.trim().toUpperCase();
      return normalized !== 'KELLNER GERUFEN';
    };

    const isVisibleOrderItem = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return false;
      if (trimmed.includes('KELLNER')) return false;
      if (ORDER_META_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return false;
      return true;
    };

    // Hole alle Bestellungen (nur bezahlte Bestellungen = completed)
    const { data: allOrders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID)
      .eq('status', 'paid')
      .order('created_at', { ascending: true });

    if (error) throw error;

    const orders = (allOrders || []) as StatisticsOrder[];

    const { data: allVisibleOrders, error: allVisibleOrdersError } = await supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID)
      .eq('status', 'paid')
      .order('created_at', { ascending: false });

    if (allVisibleOrdersError) throw allVisibleOrdersError;

    const orderList = ((allVisibleOrders || []) as StatisticsOrder[])
      .slice()
      .map((order) => {
        const visibleItems = Array.isArray(order.items)
          ? order.items.filter((item: string) => isVisibleOrderItem(item))
          : [];

        return {
        id: order.id,
        date: new Date(order.created_at).toLocaleDateString('de-DE'),
        time: new Date(order.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        table: order.table_id ? String(order.table_id) : 'Unbekannt',
        status: order.status || 'unbekannt',
        itemCount: visibleItems.length,
        items: visibleItems.map((item: string) => cleanDishName(item)).filter(Boolean),
        revenue: parseFloat((order.total_price || 0).toFixed(2)),
        };
      })
      .filter((order) => order.itemCount > 0);

    // --- 1. BESTELLUNGEN PRO TAG ---
    const ordersByDay = new Map<string, { count: number; revenue: number; orders: StatisticsOrder[] }>();
    
    orders.forEach(order => {
      const date = new Date(order.created_at);
      const dateStr = date.toLocaleDateString('de-DE');
      
      if (!ordersByDay.has(dateStr)) {
        ordersByDay.set(dateStr, { count: 0, revenue: 0, orders: [] });
      }
      
      const dayData = ordersByDay.get(dateStr)!;
      dayData.count += 1;
      dayData.revenue += order.total_price || 0;
      dayData.orders.push(order);
    });

    // Konvertiere zu Array und sortiere
    const orderCountByDay = Array.from(ordersByDay.entries()).map(([date, data]) => ({
      date,
      orders: data.count,
      revenue: parseFloat(data.revenue.toFixed(2))
    }));

    // --- 2. MEISTBESTELLTE GERICHTE ---
    const dishFrequency = new Map<string, { count: number; revenue: number }>();
    
    orders.forEach(order => {
      (order.items || []).forEach((item: string) => {
        // Parse "2x Gericht" format
        const match = item.match(/^(\d+)x\s(.+)$/);
        const quantity = match ? parseInt(match[1]) : 1;
        const rawDishName = match ? match[2].trim() : item.trim();
        const dishName = cleanDishName(rawDishName);

        if (!dishName || !isTrackableDish(dishName)) {
          return;
        }

        if (!dishFrequency.has(dishName)) {
          dishFrequency.set(dishName, { count: 0, revenue: 0 });
        }

        const dish = dishFrequency.get(dishName)!;
        dish.count += quantity;
      });
    });

    const topDishes = Array.from(dishFrequency.entries())
      .map(([name, data]) => ({
        name,
        count: data.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // --- 3. TAGES-STATISTIKEN ---
    const today = new Date().toLocaleDateString('de-DE');
    const todayData = ordersByDay.get(today) || { count: 0, revenue: 0, orders: [] };
    
    // Durchschnitt der letzten 7 Tage
    const last7DaysData = orderCountByDay.slice(-7);
    const avgOrdersLast7 = last7DaysData.length > 0 
      ? Math.round(last7DaysData.reduce((sum, d) => sum + d.orders, 0) / last7DaysData.length)
      : 0;

    // --- 4. ZEITLICHE VERTEILUNG (Stunden) ---
    const ordersByHour = new Map<number, { count: number; revenue: number }>();
    
    for (let i = 0; i < 24; i++) {
      ordersByHour.set(i, { count: 0, revenue: 0 });
    }

    orders.forEach(order => {
      const hour = new Date(order.created_at).getHours();
      const hourData = ordersByHour.get(hour)!;
      hourData.count += 1;
      hourData.revenue += order.total_price || 0;
    });

    const ordersByHourArray = Array.from(ordersByHour.entries()).map(([hour, data]) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      orders: data.count,
      revenue: parseFloat(data.revenue.toFixed(2))
    }));

    // --- 5. UMSATZ NACH TISCH ---
    const revenueByTable = new Map<string, { revenue: number; orders: number }>();

    orders.forEach(order => {
      const tableName = order.table_id ? String(order.table_id) : 'Unbekannt';
      if (!revenueByTable.has(tableName)) {
        revenueByTable.set(tableName, { revenue: 0, orders: 0 });
      }

      const tableData = revenueByTable.get(tableName)!;
      tableData.revenue += order.total_price || 0;
      tableData.orders += 1;
    });

    const revenueByTableArray = Array.from(revenueByTable.entries())
      .map(([table, data]) => ({
        table,
        orders: data.orders,
        revenue: parseFloat(data.revenue.toFixed(2))
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // --- 6. GESAMT-STATISTIKEN ---
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total_price || 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return NextResponse.json({
      orderList,
      orderCountByDay,
      topDishes,
      todayStats: {
        date: today,
        orders: todayData.count,
        revenue: todayData.revenue
      },
      last7DaysAvg: avgOrdersLast7,
      ordersByHour: ordersByHourArray,
      revenueByTable: revenueByTableArray,
      summary: {
        totalOrders,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
        uniqueDishes: dishFrequency.size
      }
    });
  } catch (error: unknown) {
    console.error('Statistik-Fehler:', error);
    const message = error instanceof Error ? error.message : 'Unbekannter Statistik-Fehler';

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
