"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { ProtectedRoute } from "@/components/ProtectedRoute";

type Order = {
  id: number;
  table_id: string;
  items: string[];
  status: "new" | "cooking" | "ready" | "done" | "abgeholt" | "pay_split";
  created_at: string;
};

type MenuItemType = "drink" | "starter" | "main" | "dessert" | "food";

type MenuTypeRow = {
  id: number;
  name: string;
  item_type?: MenuItemType;
};

type LunchSpecialConfig = {
  menus?: Array<{
    id: string;
    name: string;
    itemIds: number[];
  }>;
};

// Für Kurs-basierte Gruppierung
type CourseGroup = {
  key: string; // "orderId_courseType"
  orderId: number;
  courseType: MenuItemType;
  tableId: string;
  items: string[];
  status: "new" | "cooking" | "ready" | "abgeholt";
  created_at: string;
};

type CourseStatus = "new" | "cooking" | "ready" | "abgeholt";

const ORDER_META_SHADOW = "[[shadow]]";
const ORDER_META_STATION_FOOD = "[[station:food]]";
const ORDER_META_STATION_DRINK = "[[station:drink]]";
const ORDER_NOTE_MARKERS = ["(Notiz:", "(\u{1F4DD}"];

// Spalten-Konfiguration
const COLUMNS = {
  new: { id: 'new', title: 'NEU EINGEGANGEN', color: 'text-red-400', border: 'border-red-500/20' },
  cooking: { id: 'cooking', title: 'WIRD GEKOCHT', color: 'text-orange-400', border: 'border-orange-500/20' },
  ready: { id: 'ready', title: 'ABHOLBEREIT', color: 'text-green-400', border: 'border-green-500/20' }
};

function KitchenContent() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;
  const restaurantHomeHref = `/${restaurantId}`;
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuTypes, setMenuTypes] = useState<Record<string, MenuItemType>>({});
  const [lunchMenuComponents, setLunchMenuComponents] = useState<Record<string, string[]>>({});
  const [drinksTarget, setDrinksTarget] = useState<"bar" | "kitchen">("bar");
  const router = useRouter();
  const [isBrowser, setIsBrowser] = useState(false);
  const [courseStatus, setCourseStatus] = useState<Record<string, CourseStatus>>({});
  const [currentTime, setCurrentTime] = useState("");
  const pendingCourseStatusRef = useRef<Record<string, CourseStatus>>({});

  const formatCurrentTime = () => new Date().toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  });

  const loadCourseStatusFromSettings = async (applyState = true): Promise<Record<string, CourseStatus>> => {
    const { data } = await supabase.from('settings').select('value').eq('key', 'kitchen_course_status').eq('restaurant_id', restaurantId).single();
    if (!data?.value) {
      const pendingOnly = { ...pendingCourseStatusRef.current };
      if (applyState) setCourseStatus(pendingOnly);
      return pendingOnly;
    }
    try {
      const parsed = JSON.parse(data.value);
      if (parsed && typeof parsed === 'object') {
        const nextStatus = parsed as Record<string, CourseStatus>;
        const withPending = { ...nextStatus, ...pendingCourseStatusRef.current };
        if (applyState) setCourseStatus(withPending);
        return withPending;
      }
    } catch (e) {
      console.error('Failed to parse kitchen_course_status from settings:', e);
    }
    return {};
  };

  useEffect(() => {
    setIsBrowser(true);
    setCurrentTime(formatCurrentTime());

    const clockInterval = window.setInterval(() => {
      setCurrentTime(formatCurrentTime());
    }, 1000);
    
    // Lade courseStatus aus localStorage
    try {
      const saved = localStorage.getItem('kitchen_course_status');
      if (saved) {
        setCourseStatus(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load course status from localStorage:', e);
    }

    loadCourseStatusFromSettings();
    
    const fetchMenuTypes = async () => {
      const { data } = await supabase.from('menu').select('id, name, item_type').eq('restaurant_id', restaurantId);
      if (data) {
        const menuRows = data as MenuTypeRow[];
        let overrides: Record<string, MenuItemType> = {};
        const { data: typeMapData } = await supabase.from('settings').select('value').eq('key', 'menu_item_types').eq('restaurant_id', restaurantId).single();
        if (typeMapData?.value) {
          try {
            const parsed = JSON.parse(typeMapData.value);
            if (parsed && typeof parsed === 'object') {
              overrides = Object.fromEntries(
                Object.entries(parsed).map(([key, val]) => [key, normalizeKitchenType(String(val))])
              ) as Record<string, MenuItemType>;
            }
          } catch (e) {
            console.error('Kitchen Item Type Map Load Error:', e);
          }
        }

        const mapped: Record<string, MenuItemType> = {};
        menuRows.forEach((row) => {
          const fallbackType: MenuItemType = row.item_type === 'drink' ? 'drink' : 'main';
          const resolvedType = overrides[String(row.id)] || fallbackType;
          mapped[row.name.trim().toLowerCase()] = resolvedType;
        });
        setMenuTypes(mapped);

        const { data: lunchData } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'lunch_special')
          .single();

        if (lunchData?.value) {
          try {
            const parsed = JSON.parse(lunchData.value) as LunchSpecialConfig;
            const nextLunchMap: Record<string, string[]> = {};

            (parsed.menus || []).forEach((menu) => {
              const parts = (menu.itemIds || [])
                .map((itemId) => menuRows.find((row) => row.id === itemId)?.name?.trim())
                .filter((name): name is string => Boolean(name));

              if (menu.name?.trim() && parts.length > 0) {
                nextLunchMap[menu.name.trim().toLowerCase()] = parts;
              }
            });

            setLunchMenuComponents(nextLunchMap);
          } catch (e) {
            console.error('Kitchen Lunch Map Load Error:', e);
            setLunchMenuComponents({});
          }
        } else {
          setLunchMenuComponents({});
        }
      }
    };

    const fetchDrinksTarget = async () => {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'drinks_target')
        .eq('restaurant_id', restaurantId)
        .single();
      if (data?.value === 'kitchen' || data?.value === 'bar') {
        setDrinksTarget(data.value);
      }
    };

    const fetchOrders = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: true });
      
      if (data) setOrders(data as any);
    };

    fetchMenuTypes();
    fetchDrinksTarget();
    fetchOrders();

    const channel = supabase
      .channel('kitchen-view')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' }, () => {
        fetchMenuTypes();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.drinks_target,restaurant_id=eq.${restaurantId}` }, () => {
        fetchDrinksTarget();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.kitchen_course_status,restaurant_id=eq.${restaurantId}` }, () => {
        loadCourseStatusFromSettings();
      })
      .subscribe();

    const pollId = setInterval(() => {
      fetchOrders();
      loadCourseStatusFromSettings();
    }, 3000);

    return () => {
      window.clearInterval(clockInterval);
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, []);

  // Speichere courseStatus in localStorage wenn es sich ändert
  // DB-Persist erfolgt nur über explizite Aktionen (Drag/Buttons),
  // um Race-Conditions zwischen Kitchen/Bar zu vermeiden.
  useEffect(() => {
    if (isBrowser && Object.keys(courseStatus).length > 0) {
      try {
        localStorage.setItem('kitchen_course_status', JSON.stringify(courseStatus));
      } catch (e) {
        console.error('Failed to save course status to localStorage:', e);
      }
    }
  }, [courseStatus, isBrowser]);

  const getCourseKeysForOrder = (orderId: number): string[] => {
    const order = kitchenOrders.find((o) => o.id === orderId);
    if (!order) return [];

    const courseTypes = new Set<MenuItemType>();
    order.items.forEach((item) => {
      const itemType = menuTypes[getItemNameKey(item)] || "food";
      const normalizedType = normalizeKitchenType(itemType) as MenuItemType;
      courseTypes.add(normalizedType);
    });

    return Array.from(courseTypes)
      .filter((courseType) => courseType !== "food")
      .map((courseType) => `${orderId}_${courseType}`);
  };

  const toCourseStatus = (value?: string): CourseStatus => {
    if (value === 'new' || value === 'cooking' || value === 'ready' || value === 'abgeholt') return value;
    return 'new';
  };

  const persistCourseStatusToSettings = async (nextCourseMap: Record<string, CourseStatus>) => {
    let currentPersisted: Record<string, CourseStatus> = {};

    const { data: persistedData } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'kitchen_course_status')
      .eq('restaurant_id', restaurantId)
      .single();

    if (persistedData?.value) {
      try {
        const parsed = JSON.parse(persistedData.value);
        if (parsed && typeof parsed === 'object') {
          currentPersisted = parsed as Record<string, CourseStatus>;
        }
      } catch (e) {
        console.error('Failed to parse persisted kitchen_course_status in kitchen action:', e);
      }
    }

    const mergedCourseMap = { ...currentPersisted, ...nextCourseMap };

    const { error } = await supabase
      .from('settings')
      .upsert({ restaurant_id: restaurantId, key: 'kitchen_course_status', value: JSON.stringify(mergedCourseMap) }, { onConflict: 'restaurant_id,key' });

    if (error) {
      const hasUsefulErrorInfo = Boolean(
        (error as any)?.message ||
        (error as any)?.details ||
        (error as any)?.hint ||
        (error as any)?.code
      );

      if (hasUsefulErrorInfo) {
        console.warn('Could not persist kitchen_course_status from kitchen action:', error);
      }
    }

    return mergedCourseMap;
  };

  const updateOrderStatusFromCourseMap = async (
    orderId: number,
    nextCourseMap: Record<string, CourseStatus>
  ) => {
    const order = kitchenOrders.find((o) => o.id === orderId);
    const fallbackStatus = (order?.status || "new") as CourseStatus;
    // Alle Kurs-Keys dieser Bestellung aus der gemergten Map (inkl. Bar-Keys)
    const allMergedKeys = Object.keys(nextCourseMap).filter((key) => key.startsWith(`${orderId}_`));
    const courseKeys = allMergedKeys.length > 0 ? allMergedKeys : getCourseKeysForOrder(orderId);
    if (courseKeys.length === 0) return;

    const hasAnyStoredCourseForOrder = courseKeys.some((key) => Boolean(nextCourseMap[key]));
    const relevantCourses = courseKeys.map((key) => {
      if (nextCourseMap[key]) return nextCourseMap[key];
      if (!hasAnyStoredCourseForOrder) return toCourseStatus(fallbackStatus);
      return 'new';
    });

    let targetStatus: CourseStatus = "new";
    if (relevantCourses.every((s) => s === "abgeholt")) {
      // WICHTIG: Bestellung NICHT automatisch auf "abgeholt" setzen,
      // damit im Waiter nicht die komplette Bestellung als abgeholt erscheint.
      // Das finale "abgeholt" setzt weiterhin der Waiter-Flow.
      targetStatus = "ready";
    } else if (relevantCourses.some((s) => s === "ready")) {
      targetStatus = "ready";
    } else if (relevantCourses.some((s) => s === "cooking")) {
      targetStatus = "cooking";
    } else {
      targetStatus = "new";
    }

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: targetStatus } : o)));
    await supabase
      .from("orders")
      .update({ status: targetStatus })
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId);
  };

  // --- DRAG & DROP LOGIK ---
  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const courseKey = draggableId; // Format: "orderId_courseType"
    const newStatus = destination.droppableId as CourseStatus;

    // Optimistisches UI-Update gegen kurzes Zurückspringen nach dem Drop
    pendingCourseStatusRef.current = { ...pendingCourseStatusRef.current, [courseKey]: newStatus };
    const optimisticCourseMap = { ...courseStatus, [courseKey]: newStatus };
    setCourseStatus(optimisticCourseMap);

    const [orderId] = courseKey.split('_');
    await updateOrderStatusFromCourseMap(parseInt(orderId, 10), optimisticCourseMap);

    const latestCourseStatus = await loadCourseStatusFromSettings(false);
    const nextCourseMap = { ...latestCourseStatus, [courseKey]: newStatus };
    const mergedCourseMap = await persistCourseStatusToSettings(nextCourseMap);
    const { [courseKey]: _removedPending, ...restPending } = pendingCourseStatusRef.current;
    pendingCourseStatusRef.current = restPending;
    setCourseStatus(mergedCourseMap);

    await updateOrderStatusFromCourseMap(parseInt(orderId, 10), mergedCourseMap);
  };

  // --- BUTTON LOGIK ---
  const advanceOrder = async (courseKey: string, currentStatus: string) => {
    const latestCourseStatus = await loadCourseStatusFromSettings();

    let nextStatus: CourseStatus = "cooking";
    if (currentStatus === "cooking") nextStatus = "ready";
    if (currentStatus === "ready") nextStatus = "abgeholt";

    const nextCourseMap = { ...latestCourseStatus, [courseKey]: nextStatus };
    const mergedCourseMap = await persistCourseStatusToSettings(nextCourseMap);
    setCourseStatus(mergedCourseMap);

    const [orderId] = courseKey.split('_');
    await updateOrderStatusFromCourseMap(parseInt(orderId, 10), mergedCourseMap);
    await loadCourseStatusFromSettings();
  };

  const clearAll = async () => {
    if (confirm("Alle Küchen-Bestellungen aus der Ansicht entfernen?")) {
      // Nur aktive Küchen-Status archivieren, NICHT aus der DB löschen
      await supabase
        .from('orders')
        .update({ status: 'abgeholt' })
        .in('status', ['new', 'cooking', 'ready']);
    }
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return "--:--";
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const normalizeKitchenType = (value?: string | null): Exclude<MenuItemType, "food"> => {
    if (value === "drink" || value === "starter" || value === "main" || value === "dessert") return value;
    return "main";
  };

  const isDrinkType = (value?: string | null) => normalizeKitchenType(value) === "drink";

  const getKitchenTypeMeta = (value?: string | null) => {
    const normalized = normalizeKitchenType(value);
    if (normalized === "drink") return { label: "Getränk", className: "bg-cyan-500/15 text-cyan-600" };
    if (normalized === "starter") return { label: "Vorspeise", className: "bg-violet-500/15 text-violet-600" };
    if (normalized === "dessert") return { label: "Nachtisch", className: "bg-pink-500/15 text-pink-600" };
    return { label: "Hauptspeise", className: "bg-emerald-500/15 text-emerald-600" };
  };

  const stripOrderMeta = (value: string) =>
    value
      .replace(/\n?\[\[station:(food|drink)\]\]/g, "")
      .replace(/\n?\[\[shadow\]\]/g, "")
      .trim();

  const getOrderItemStation = (value: string): "food" | "drink" | null => {
    if (value.includes(ORDER_META_STATION_FOOD)) return "food";
    if (value.includes(ORDER_META_STATION_DRINK)) return "drink";
    return null;
  };

  const splitOrderNote = (value: string) => {
    let label = value.trim();
    let note = "";
    const noteMarker = ORDER_NOTE_MARKERS.find((marker) => label.includes(marker));
    if (noteMarker) {
      const noteParts = label.split(noteMarker);
      label = noteParts[0].trim();
      note = noteParts.slice(1).join(noteMarker).replace(/\)\s*$/, '').trim();
    }
    return { label, note };
  };

  const isShadowOrder = (order: Order) =>
    order.items.length > 0 && order.items.every((item) => item.includes(ORDER_META_SHADOW));

  const getItemNameKey = (item: string) => {
    const cleanItem = stripOrderMeta(item);
    const match = cleanItem.match(/^(\d+)x\s(.+)$/);
    const rawName = match ? match[2] : cleanItem;
    let name = splitOrderNote(rawName).label;
    if (name.includes(" - ")) name = name.split(" - ")[0].trim();
    return name.toLowerCase();
  };

  const expandMenuItems = (item: string) => {
    const cleanItem = stripOrderMeta(item);
    const { label: cleanItemWithoutNote, note: inheritedNote } = splitOrderNote(cleanItem);
    const qtyMatch = cleanItemWithoutNote.match(/^(\d+)x\s(.+?)(?:\s-\s|$)/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

    const markerMatch = cleanItemWithoutNote.match(/im\s+men[üu]\s+enthalten\s*:/i);
    if (markerMatch) {
      const markerIndex = markerMatch.index ?? -1;
      const listPart = markerIndex >= 0
        ? cleanItemWithoutNote.slice(markerIndex + markerMatch[0].length)
        : '';

      const entries = listPart
        .split('\n')
        .map(line => line.replace(/^\s*[•\-]\s*/, '').trim())
        .filter((line) => Boolean(line) && !line.startsWith('[['));

      if (entries.length > 0) {
        return entries.map(name => `${qty}x ${name}${inheritedNote ? ` (Notiz: ${inheritedNote})` : ''}`);
      }
    }

    const menuNameKey = getItemNameKey(cleanItemWithoutNote);
    const fallbackEntries = lunchMenuComponents[menuNameKey] || [];
    if (fallbackEntries.length > 0) {
      return fallbackEntries.map(name => `${qty}x ${name}${inheritedNote ? ` (Notiz: ${inheritedNote})` : ''}`);
    }

    return [cleanItem];
  };

  const kitchenOrders = orders
    .filter(order => order.status !== 'pay_split' && !order.items.some(item => item.includes("KELLNER")) && !isShadowOrder(order))
    .map(order => ({
      ...order,
      items: order.items
        .flatMap(item => {
        const station = getOrderItemStation(item);
        if (station === 'drink') return [];
        return expandMenuItems(item);
      })
        .filter(item => {
        const cleanItem = stripOrderMeta(item);
        if (!cleanItem) return false;
        if (item.includes('[[') || cleanItem.includes('[[')) return false;
        if (!cleanItem.match(/^(\d+)x\s(.+)$/)) return false;
        const key = getItemNameKey(item);
        const type = menuTypes[key] || "food";
        if (isDrinkType(type)) return drinksTarget === "kitchen";
        return true;
      })
    }))
    .filter(order => order.items.length > 0);

  // Erstelle Course-Gruppen aus Bestellungen
  const createCourseGroups = (): CourseGroup[] => {
    const groups: CourseGroup[] = [];

    kitchenOrders.forEach(order => {
      const courseMap: Record<MenuItemType, string[]> = {
        starter: [],
        main: [],
        dessert: [],
        drink: [],
        food: []
      };

      // Gruppiere Items nach Kurs-Typ
      order.items.forEach(item => {
        const itemType = menuTypes[getItemNameKey(item)] || "food";
        const normalizedType = normalizeKitchenType(itemType) as MenuItemType;
        courseMap[normalizedType].push(item);
      });

      // Erstelle für jeden Kurs mit Items eine separate Gruppe
      const orderCourseKeys = (["starter", "main", "dessert", "drink"] as MenuItemType[])
        .map((courseType) => `${order.id}_${courseType}`);
      const hasAnyStoredCourseForOrder = orderCourseKeys.some((key) => Boolean(courseStatus[key]));

      (["starter", "main", "dessert", "drink"] as MenuItemType[]).forEach(courseType => {
        if (courseMap[courseType].length > 0) {
          const courseKey = `${order.id}_${courseType}`;
          const courseStatus_: CourseStatus = order.status === 'abgeholt'
            ? 'abgeholt'
            : courseStatus[courseKey]
              ? courseStatus[courseKey]
              : !hasAnyStoredCourseForOrder
                ? toCourseStatus(order.status)
                : 'new';

          groups.push({
            key: courseKey,
            orderId: order.id,
            courseType,
            tableId: order.table_id,
            items: courseMap[courseType],
            status: courseStatus_,
            created_at: order.created_at
          });
        }
      });
    });

    return groups;
  };

  const courseGroups = createCourseGroups();

  return (
    <div className="min-h-screen bg-app-bg p-2 md:p-6 text-app-text font-sans overflow-x-hidden">
      
      {/* HEADER */}
      <div className="mb-4 flex flex-col md:flex-row md:items-center justify-between border-b border-app-muted/20 pb-4 gap-4">
          <h1 className="text-2xl font-bold text-app-text">KÜCHE</h1>
           <div className="flex gap-4">
            <a href={restaurantHomeHref} className="text-sm bg-app-card text-app-text border border-app-muted/30 px-4 py-2 rounded hover:bg-app-muted/20 transition-colors">Home</a>
           <div className="text-sm bg-app-card text-app-text border border-app-muted/30 px-4 py-2 rounded">
            {currentTime || "--:--"}
           </div>
          </div>
      </div>

      {/* DRAG AND DROP BEREICH */}
      {isBrowser && (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-auto md:h-[calc(100vh-140px)]">
            
            {Object.entries(COLUMNS).map(([columnId, colConfig]) => {
              const columnCourseGroups = courseGroups.filter(g => g.status === columnId);

              return (
                <div key={columnId} className="flex flex-col rounded-xl bg-app-card/50 border border-app-muted/20 h-full min-h-0">
                  
                  <h2 className={`p-4 text-xl font-bold ${colConfig.color} border-b ${colConfig.border} bg-app-card/80 rounded-t-xl flex justify-between items-center`}>
                    {colConfig.title}
                    <span className="text-xs bg-app-bg px-2 py-1 rounded-full text-app-muted">{columnCourseGroups.length}</span>
                  </h2>

                  <Droppable droppableId={columnId}>
                    {(provided, snapshot) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className={`flex-1 p-2 overflow-y-auto custom-scrollbar transition-colors ${snapshot.isDraggingOver ? 'bg-app-primary/10' : ''}`}
                      >
                        {columnCourseGroups.map((courseGroup, index) => (
                          <Draggable key={courseGroup.key} draggableId={courseGroup.key} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`mb-1 relative overflow-hidden rounded-lg p-3 shadow-lg transition-all 
                                  ${snapshot.isDragging ? 'bg-app-primary/10 rotate-2 scale-105 z-50' : 'bg-app-card'}
                                  ${columnId === 'cooking' ? 'border-l-4 border-orange-400' : ''}
                                  ${columnId === 'ready' ? 'bg-green-100 border-l-4 border-green-500' : ''}
                                `}
                                style={provided.draggableProps.style}
                              >
                                <div className="mb-1.5 flex justify-between border-b border-app-muted/20 pb-1.5 pointer-events-none">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-app-text">Tisch {decodeURIComponent(courseGroup.tableId)}</span>
                                    <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${getKitchenTypeMeta(courseGroup.courseType).className} w-fit`}>
                                      {getKitchenTypeMeta(courseGroup.courseType).label}
                                    </span>
                                  </div>
                                  <span className="font-mono text-xs font-bold text-app-muted">{formatTime(courseGroup.created_at)}</span>
                                </div>
                                
                                <ul className="space-y-0 mb-3 pointer-events-none">
                                  {courseGroup.items.map((item, i) => {
                                    // Format: "Qty x Name - Description (Notiz: Hinweis)"
                                    let qty = "";
                                    let name = item;
                                    let desc = "";
                                    let note = "";
                                    
                                    // Parse quantity
                                    const qtyMatch = item.match(/^(\d+)x\s(.+)$/);
                                    if (qtyMatch) {
                                      qty = qtyMatch[1];
                                      name = qtyMatch[2];
                                    }
                                    
                                    // Parse note if present
                                    const noteMarker = ORDER_NOTE_MARKERS.find((marker) => name.includes(marker));
                                    if (noteMarker) {
                                      const noteParts = name.split(noteMarker);
                                      name = noteParts[0].trim();
                                      note = noteParts[1].replace(')', '').trim();
                                    }
                                    
                                    // Parse description (everything after " - ")
                                    if (name.includes(" - ")) {
                                      const descParts = name.split(" - ");
                                      name = descParts[0].trim();
                                      desc = descParts.slice(1).join(" - ").trim();
                                    }
                                    
                                    return (
                                      <li key={i} className="text-xs font-medium text-app-text leading-tight">
                                        <div className="text-sm font-semibold leading-tight">
                                          <span>{qty && qty + "x "}{name}</span>
                                        </div>
                                        {desc && <div className="text-[11px] text-app-muted leading-tight">{desc}</div>}
                                        {note && <div className="text-[11px] font-bold text-orange-600 bg-orange-100 px-1 py-0.5 rounded inline-block">Notiz: {note}</div>}
                                      </li>
                                    );
                                  })}
                                </ul>

                                {/* Button für Kurse */}
                                <button 
                                  onClick={(e) => {
                                    if (!snapshot.isDragging) advanceOrder(courseGroup.key, columnId);
                                  }}
                                  className={`w-full py-3 rounded-lg font-bold text-white shadow active:scale-95 transition-transform
                                    ${columnId === 'new' ? 'bg-app-primary hover:bg-app-primary/80' : ''}
                                    ${columnId === 'cooking' ? 'bg-green-600 hover:bg-green-500' : ''}
                                    ${columnId === 'ready' ? 'bg-app-muted hover:bg-app-muted/80 text-xs py-2' : ''}
                                  `}
                                >
                                  {columnId === 'new' && "Zubereitung starten"}
                                  {columnId === 'cooking' && "Fertig melden!"}
                                  {columnId === 'ready' && "Archivieren"}
                                </button>

                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {columnCourseGroups.length === 0 && !snapshot.isDraggingOver && (
                          <div className="h-full flex items-center justify-center text-slate-600 italic opacity-50">Leer</div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}

export default function KitchenPage() {
  return (
    <ProtectedRoute>
      <KitchenContent />
    </ProtectedRoute>
  );
}
