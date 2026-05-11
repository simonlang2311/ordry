"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { ProtectedRoute } from "@/components/ProtectedRoute";

type Order = {
  id: number;
  table_id: string;
  items: string[];
  status: "new" | "cooking" | "ready" | "abgeholt" | "paid" | "pay_split";
  created_at: string;
};

type MenuTypeRow = {
  id: number;
  name: string;
  item_type?: "food" | "drink" | "starter" | "main" | "dessert";
};

type MenuItemType = "food" | "drink" | "starter" | "main" | "dessert";
type CourseStatus = "new" | "cooking" | "ready" | "abgeholt";

const ORDER_META_SHADOW = "[[shadow]]";
const ORDER_META_STATION_FOOD = "[[station:food]]";
const ORDER_META_STATION_DRINK = "[[station:drink]]";
const ORDER_NOTE_MARKERS = ["(Notiz:", "(\u{1F4DD}"];

const COLUMNS = {
  new: { id: "new", title: "BESTELLT", color: "text-red-400", border: "border-red-500/20" },
  ready: { id: "ready", title: "ABHOLBEREIT", color: "text-green-400", border: "border-green-500/20" }
};

function BarContent() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;

  const [orders, setOrders] = useState<Order[]>([]);
  const [menuTypes, setMenuTypes] = useState<Record<string, MenuItemType>>({});
  const [drinksTarget, setDrinksTarget] = useState<"bar" | "kitchen">("bar");
  const [isBrowser, setIsBrowser] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [courseStatus, setCourseStatus] = useState<Record<string, CourseStatus>>({});
  const [currentTime, setCurrentTime] = useState("");
  const pendingCourseStatusRef = useRef<Record<string, CourseStatus>>({});

  const formatCurrentTime = () => new Date().toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  });

  const normalizeKitchenType = (value?: string | null): Exclude<MenuItemType, "food"> => {
    if (value === "drink" || value === "starter" || value === "main" || value === "dessert") return value;
    return "main";
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const toCourseStatus = (value?: string): CourseStatus => {
    if (value === "new" || value === "cooking" || value === "ready" || value === "abgeholt") return value;
    return "new";
  };

  const loadCourseStatusFromSettings = async (applyState = true): Promise<Record<string, CourseStatus>> => {
    const { data } = await supabase.from("settings").select("value").eq("key", "kitchen_course_status").eq('restaurant_id', restaurantId).single();
    if (!data?.value) {
      const pendingOnly = { ...pendingCourseStatusRef.current };
      if (applyState) setCourseStatus(pendingOnly);
      return pendingOnly;
    }
    try {
      const parsed = JSON.parse(data.value);
      if (parsed && typeof parsed === "object") {
        const nextStatus = parsed as Record<string, CourseStatus>;
        const withPending = { ...nextStatus, ...pendingCourseStatusRef.current };
        if (applyState) setCourseStatus(withPending);
        return withPending;
      }
    } catch (e) {
      console.error("Failed to parse kitchen_course_status from settings:", e);
    }
    return {};
  };

  const persistCourseStatusToSettings = async (nextCourseMap: Record<string, CourseStatus>) => {
    let currentPersisted: Record<string, CourseStatus> = {};

    const { data: persistedData } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "kitchen_course_status")
      .eq('restaurant_id', restaurantId)
      .single();

    if (persistedData?.value) {
      try {
        const parsed = JSON.parse(persistedData.value);
        if (parsed && typeof parsed === "object") {
          currentPersisted = parsed as Record<string, CourseStatus>;
        }
      } catch (e) {
        console.error("Failed to parse persisted kitchen_course_status in bar:", e);
      }
    }

    const mergedCourseMap = { ...currentPersisted, ...nextCourseMap };

    const { error } = await supabase
      .from("settings")
      .upsert({ restaurant_id: restaurantId, key: "kitchen_course_status", value: JSON.stringify(mergedCourseMap) }, { onConflict: "restaurant_id,key" });

    if (error) {
      const hasUsefulErrorInfo = Boolean(
        (error as any)?.message ||
        (error as any)?.details ||
        (error as any)?.hint ||
        (error as any)?.code
      );

      if (hasUsefulErrorInfo) {
        console.warn("Could not persist kitchen_course_status to settings:", error);
      }
    }

    return mergedCourseMap;
  };

  useEffect(() => {
    setIsBrowser(true);
    setCurrentTime(formatCurrentTime());
    const updateIsMobile = () => setIsMobile(window.innerWidth < 768);
    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);

    const clockInterval = window.setInterval(() => {
      setCurrentTime(formatCurrentTime());
    }, 1000);

    const fetchMenuTypes = async () => {
      const { data } = await supabase.from("menu").select("id, name, item_type").eq('restaurant_id', restaurantId);
      if (data) {
        let overrides: Record<string, MenuItemType> = {};
        const { data: typeMapData } = await supabase.from("settings").select("value").eq("key", "menu_item_types").eq('restaurant_id', restaurantId).single();
        if (typeMapData?.value) {
          try {
            const parsed = JSON.parse(typeMapData.value);
            if (parsed && typeof parsed === "object") {
              overrides = Object.fromEntries(
                Object.entries(parsed).map(([key, val]) => [key, normalizeKitchenType(String(val))])
              ) as Record<string, MenuItemType>;
            }
          } catch (e) {
            console.error("Bar Item Type Map Load Error:", e);
          }
        }

        const mapped: Record<string, MenuItemType> = {};
        (data as MenuTypeRow[]).forEach((row) => {
          const fallbackType: MenuItemType = row.item_type === "drink" ? "drink" : normalizeKitchenType(row.item_type);
          const resolvedType = overrides[String(row.id)] || fallbackType;
          mapped[row.name.trim().toLowerCase()] = resolvedType;
        });
        setMenuTypes(mapped);
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
        .from("orders")
        .select("*")
        .eq('restaurant_id', restaurantId)
        .order("created_at", { ascending: true });

      if (data) setOrders(data as any);
    };

    fetchMenuTypes();
    fetchDrinksTarget();
    fetchOrders();
    loadCourseStatusFromSettings();

    const channel = supabase
      .channel("bar-view")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () => {
        fetchOrders();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "menu", filter: `restaurant_id=eq.${restaurantId}` }, () => {
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
      window.removeEventListener("resize", updateIsMobile);
      window.clearInterval(clockInterval);
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  const getCourseKeysForOrder = (orderId: number): string[] => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return [];

    const courseTypes = new Set<MenuItemType>();
    order.items.forEach((item) => {
      const station = getOrderItemStation(item);
      if (station === "drink") {
        courseTypes.add("drink");
        return;
      }

      if (station === "food") {
        courseTypes.add("main");
        return;
      }

      const itemType = menuTypes[getItemNameKey(item)] || "food";
      if (itemType === "drink") {
        courseTypes.add("drink");
      } else {
        courseTypes.add(normalizeKitchenType(itemType));
      }
    });

    return Array.from(courseTypes)
      .filter((courseType) => courseType !== "food")
      .map((courseType) => `${orderId}_${courseType}`);
  };

  const updateOrderStatusFromCourseMap = async (
    orderId: number,
    nextCourseMap: Record<string, CourseStatus>
  ) => {
    const order = orders.find((o) => o.id === orderId);
    const fallbackStatus = (order?.status || "new") as CourseStatus;
    // Alle Kurs-Keys dieser Bestellung aus der gemergten Map (inkl. Küchen-Keys)
    const allMergedKeys = Object.keys(nextCourseMap).filter((key) => key.startsWith(`${orderId}_`));
    const courseKeys = allMergedKeys.length > 0 ? allMergedKeys : getCourseKeysForOrder(orderId);
    if (courseKeys.length === 0) return;

    const hasAnyStoredCourseForOrder = courseKeys.some((key) => Boolean(nextCourseMap[key]));
    const relevantCourses = courseKeys.map((key) => {
      if (nextCourseMap[key]) return nextCourseMap[key];
      if (!hasAnyStoredCourseForOrder) return toCourseStatus(fallbackStatus);
      return "new";
    });

    let targetStatus: CourseStatus = "new";
    if (relevantCourses.every((s) => s === "abgeholt")) {
      targetStatus = "ready";
    } else if (relevantCourses.some((s) => s === "ready")) {
      targetStatus = "ready";
    } else if (relevantCourses.some((s) => s === "cooking")) {
      targetStatus = "cooking";
    }

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: targetStatus } : o)));
    await supabase.from("orders").update({ status: targetStatus }).eq("id", orderId).eq('restaurant_id', restaurantId);
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStatus = destination.droppableId as CourseStatus;
    const orderId = parseInt(draggableId);
    const linkedOrderIds = getLinkedDrinkOrderIds(orderId);

    // Optimistisches UI-Update gegen kurzes Zurückspringen nach dem Drop
    const pendingUpdate = { ...pendingCourseStatusRef.current };
    const optimisticCourseMap = { ...courseStatus };
    linkedOrderIds.forEach((linkedOrderId) => {
      pendingUpdate[`${linkedOrderId}_drink`] = newStatus;
      optimisticCourseMap[`${linkedOrderId}_drink`] = newStatus;
    });
    pendingCourseStatusRef.current = pendingUpdate;
    setCourseStatus(optimisticCourseMap);

    const latestCourseStatus = await loadCourseStatusFromSettings(false);
    const nextCourseMap = { ...latestCourseStatus };
    linkedOrderIds.forEach((linkedOrderId) => {
      nextCourseMap[`${linkedOrderId}_drink`] = newStatus;
    });

    const mergedCourseMap = await persistCourseStatusToSettings(nextCourseMap);
    const nextPending = { ...pendingCourseStatusRef.current };
    linkedOrderIds.forEach((linkedOrderId) => {
      delete nextPending[`${linkedOrderId}_drink`];
    });
    pendingCourseStatusRef.current = nextPending;
    setCourseStatus(mergedCourseMap);
    for (const linkedOrderId of linkedOrderIds) {
      await updateOrderStatusFromCourseMap(linkedOrderId, mergedCourseMap);
    }
  };

  const advanceOrder = async (orderId: number, currentStatus: string) => {
    const latestCourseStatus = await loadCourseStatusFromSettings();

    let nextStatus: CourseStatus = "ready";
    if (currentStatus === "ready") nextStatus = "abgeholt";

    const linkedOrderIds = getLinkedDrinkOrderIds(orderId);
    const nextCourseMap = { ...latestCourseStatus };
    linkedOrderIds.forEach((linkedOrderId) => {
      nextCourseMap[`${linkedOrderId}_drink`] = nextStatus;
    });

    const mergedCourseMap = await persistCourseStatusToSettings(nextCourseMap);
    setCourseStatus(mergedCourseMap);
    for (const linkedOrderId of linkedOrderIds) {
      await updateOrderStatusFromCourseMap(linkedOrderId, mergedCourseMap);
    }
    await loadCourseStatusFromSettings();
  };

  const clearAll = async () => {
    if (confirm("Alle Bar-Bestellungen aus der Ansicht entfernen?")) {
      const latestCourseStatus = await loadCourseStatusFromSettings();

      const nextCourseMap = { ...latestCourseStatus };
      barOrders.forEach((order) => {
        nextCourseMap[`${order.id}_drink`] = "abgeholt";
      });

      const mergedCourseMap = await persistCourseStatusToSettings(nextCourseMap);
      setCourseStatus(mergedCourseMap);

      await supabase
        .from("orders")
        .update({ status: "abgeholt" })
        .in("status", ["new", "cooking", "ready"])
        .eq('restaurant_id', restaurantId);

      await loadCourseStatusFromSettings();
    }
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return "--:--";
    return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
      note = noteParts.slice(1).join(noteMarker).replace(/\)\s*$/, "").trim();
    }
    return { label, note };
  };

  const isShadowOrder = (order: Order) =>
    order.items.length > 0 && order.items.every((item) => item.includes(ORDER_META_SHADOW));

  const getItemNameKey = (item: string) => {
    const cleanItem = stripOrderMeta(item);
    const match = cleanItem.match(/^(\d+)x\s(.+)$/);
    const rawName = match ? match[2] : item;
    let name = splitOrderNote(rawName).label;
    if (name.includes(" - ")) name = name.split(" - ")[0].trim();
    return name.toLowerCase();
  };

  const expandMenuItems = (item: string) => {
    const cleanItem = stripOrderMeta(item);
    const { label: cleanItemWithoutNote, note: inheritedNote } = splitOrderNote(cleanItem);
    if (!cleanItemWithoutNote.includes('Im Menü enthalten:')) return [cleanItem];

    const qtyMatch = cleanItemWithoutNote.match(/^(\d+)x\s(.+?)(?:\s-\s|$)/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

    const listPart = cleanItemWithoutNote.split('Im Menü enthalten:')[1] || '';
    const entries = listPart
      .split('\n')
      .map(line => line.replace('•', '').trim())
      .filter(line => Boolean(line) && !line.startsWith('[['));

    if (entries.length === 0) return [cleanItem];

    return entries.map(name => `${qty}x ${name}${inheritedNote ? ` (Notiz: ${inheritedNote})` : ''}`);
  };

  const barOrders = orders
    .filter(order => order.status !== 'pay_split' && !order.items.some(item => item.includes("KELLNER")))
    .map(order => ({
      ...order,
      items: order.items
        .flatMap(item => {
          const station = getOrderItemStation(item);
          if (station && station !== 'drink') return [];
          return expandMenuItems(item);
        })
        .filter(item => {
        const key = getItemNameKey(item);
        const type = menuTypes[key] || "food";
        if (normalizeKitchenType(type) !== "drink") return false;
        return drinksTarget === "bar";
      })
    }))
    .filter(order => order.items.length > 0)
    .map(order => {
      const drinkCourseKey = `${order.id}_drink`;
      const explicitDrinkStatus = courseStatus[drinkCourseKey];
      const hasAnyStoredCourseForOrder = Object.keys(courseStatus).some((key) => key.startsWith(`${order.id}_`));
      const fallbackStatus = toCourseStatus(order.status);
      const effectiveStatus: Order["status"] = order.status === "paid"
        ? "paid"
        : explicitDrinkStatus === "ready"
          ? "ready"
          : explicitDrinkStatus === "abgeholt"
            ? "abgeholt"
            : explicitDrinkStatus === "cooking"
              ? "new"
              : explicitDrinkStatus
                ? explicitDrinkStatus
          : hasAnyStoredCourseForOrder
            ? "new"
            : fallbackStatus;

      return {
        ...order,
        status: effectiveStatus
      };
    });

  const getDrinkCountMapForOrder = (order: Order): Map<string, number> => {
    const counts = new Map<string, number>();

    order.items
      .flatMap((item) => {
        const station = getOrderItemStation(item);
        if (station && station !== "drink") return [];
        return expandMenuItems(item);
      })
      .forEach((item) => {
        const key = getItemNameKey(item);
        const type = menuTypes[key] || "food";
        if (normalizeKitchenType(type) !== "drink") return;

        const qtyMatch = item.match(/^(\d+)x\s(.+)$/);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        counts.set(key, (counts.get(key) || 0) + qty);
      });

    return counts;
  };

  const hasDrinkOverlap = (a: Map<string, number>, b: Map<string, number>) => {
    for (const [name, qty] of a.entries()) {
      if (qty <= 0) continue;
      if ((b.get(name) || 0) > 0) return true;
    }
    return false;
  };

  const getLinkedDrinkOrderIds = (orderId: number): number[] => {
    const targetOrder = orders.find((o) => o.id === orderId);
    if (!targetOrder) return [orderId];

    const targetDrinkMap = getDrinkCountMapForOrder(targetOrder);
    if (targetDrinkMap.size === 0) return [orderId];

    const targetIsShadow = isShadowOrder(targetOrder);
    const targetTime = new Date(targetOrder.created_at).getTime();

    const linkedIds = orders
      .filter((o) => o.id !== targetOrder.id)
      .filter((o) => o.table_id === targetOrder.table_id)
      .filter((o) => isShadowOrder(o) !== targetIsShadow)
      .filter((o) => {
        const otherTime = new Date(o.created_at).getTime();
        if (!Number.isFinite(targetTime) || !Number.isFinite(otherTime)) return true;
        const maxDeltaMs = 10 * 60 * 1000;
        return Math.abs(otherTime - targetTime) <= maxDeltaMs;
      })
      .filter((o) => hasDrinkOverlap(targetDrinkMap, getDrinkCountMapForOrder(o)))
      .map((o) => o.id);

    return [orderId, ...linkedIds];
  };

  return (
    <div className="min-h-screen bg-app-bg p-3 sm:p-4 md:p-6 text-app-text font-sans overflow-x-hidden">
      <div className="sticky top-0 z-20 -mx-3 mb-4 flex items-center justify-between gap-3 border-b border-app-muted/20 bg-app-bg/95 px-3 pb-3 pt-1 backdrop-blur sm:-mx-4 sm:px-4 md:static md:mx-0 md:bg-transparent md:px-0 md:pt-0">
        <h1 className="text-xl md:text-2xl font-bold text-app-text">BAR</h1>
        <div className="flex shrink-0 gap-2">
          <a href={`/${restaurantId}`} className="flex h-10 items-center text-sm bg-app-card text-app-text border border-app-muted/30 px-4 rounded hover:bg-app-muted/20 transition-colors">Home</a>
          <div className="flex h-10 items-center text-sm bg-app-card text-app-text border border-app-muted/30 px-4 rounded">
            {currentTime || "--:--"}
          </div>
        </div>
      </div>

      {isBrowser && (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 gap-3 pb-6 md:grid-cols-2 md:gap-4 md:h-[calc(100vh-140px)] md:pb-0">
            {Object.entries(COLUMNS).map(([columnId, colConfig]) => {
              const columnOrders = barOrders.filter(o => o.status === columnId);

              return (
                <div key={columnId} className="flex h-auto min-h-[220px] flex-col rounded-xl bg-app-card/50 border border-app-muted/20 md:h-full md:min-h-0">
                  <h2 className={`p-3 md:p-4 text-lg md:text-xl font-bold ${colConfig.color} border-b ${colConfig.border} bg-app-card/80 rounded-t-xl flex justify-between items-center`}>
                    {colConfig.title}
                    <span className="text-xs bg-app-bg px-2 py-1 rounded-full text-app-muted">{columnOrders.length}</span>
                  </h2>

                  <Droppable droppableId={columnId}>
                    {(provided, snapshot) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className={`custom-scrollbar min-h-[120px] p-2 overflow-visible transition-colors md:flex-1 md:overflow-y-auto ${snapshot.isDraggingOver ? "bg-app-primary/10" : ""}`}
                      >
                        {columnOrders.map((order, index) => (
                          <Draggable key={order.id} draggableId={String(order.id)} index={index} isDragDisabled={isMobile}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`mb-1 relative overflow-hidden rounded-lg p-3 shadow-lg transition-all 
                                  ${snapshot.isDragging ? "bg-app-primary/10 rotate-2 scale-105 z-50" : "bg-app-card"}
                                  ${columnId === "ready" ? "bg-green-100 border-l-4 border-green-500" : ""}
                                `}
                                style={provided.draggableProps.style}
                              >
                                <div className="mb-1.5 flex justify-between border-b border-app-muted/20 pb-1.5 pointer-events-none">
                                  <span className="text-sm font-bold text-app-text">Tisch {decodeURIComponent(order.table_id)}</span>
                                  <span className="font-mono text-xs font-bold text-app-muted">{formatTime(order.created_at)}</span>
                                </div>

                                <ul className="space-y-0 mb-3 pointer-events-none">
                                  {order.items.map((item, i) => {
                                    let qty = "";
                                    let name = item;
                                    let desc = "";
                                    let note = "";

                                    const qtyMatch = item.match(/^(\d+)x\s(.+)$/);
                                    if (qtyMatch) {
                                      qty = qtyMatch[1];
                                      name = qtyMatch[2];
                                    }

                                    const noteMarker = ORDER_NOTE_MARKERS.find((marker) => name.includes(marker));
                                    if (noteMarker) {
                                      const noteParts = name.split(noteMarker);
                                      name = noteParts[0].trim();
                                      note = noteParts[1].replace(")", "").trim();
                                    }

                                    if (name.includes(" - ")) {
                                      const descParts = name.split(" - ");
                                      name = descParts[0].trim();
                                      desc = descParts.slice(1).join(" - ").trim();
                                    }

                                    return (
                                      <li key={i} className="text-xs font-medium text-app-text leading-tight">
                                        <div className="text-sm font-semibold leading-tight">{qty && qty + "x "}{name}</div>
                                        {desc && <div className="text-[11px] text-app-muted leading-tight">{desc}</div>}
                                        {note && <div className="text-[11px] font-bold text-orange-600 bg-orange-100 px-1 py-0.5 rounded inline-block">Notiz: {note}</div>}
                                      </li>
                                    );
                                  })}
                                </ul>

                                <button
                                  onClick={(e) => {
                                    if (!snapshot.isDragging) advanceOrder(order.id, columnId);
                                  }}
                                  className={`w-full py-3 rounded-lg font-bold text-white shadow active:scale-95 transition-transform
                                    ${columnId === "new" ? "bg-app-primary hover:bg-app-primary/80" : ""}
                                    ${columnId === "ready" ? "bg-app-muted hover:bg-app-muted/80 text-xs py-2" : ""}
                                  `}
                                >
                                  {columnId === "new" ? "Abholbereit" : "Archivieren"}
                                </button>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
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

export default function BarPage() {
  return (
    <ProtectedRoute>
      <BarContent />
    </ProtectedRoute>
  );
}
