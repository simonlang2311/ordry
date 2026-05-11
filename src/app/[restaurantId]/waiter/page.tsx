'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createNewTokenForTable, fetchCurrentTokenForTable, invalidateCustomerTokensForTable } from '@/lib/tokenManager';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DEFAULT_RESTAURANT_FEATURES, RestaurantFeatures, loadRestaurantFeatures } from '@/lib/features';

// --- TYPEN ---
type TableShape = 'round' | 'square' | 'rect';

type Table = {
  id: number;
  label: string;
  x: number;
  y: number;
  shape: TableShape;
  level: string;
  seats: number; // NEU: Kapazität
};

type OrderDetail = {
  id: number;
  items: string[];
  status: string;
  created_at: string;
  total_price?: number;
};

// UPDATE: Date hinzugefügt
type Reservation = {
  id: number;
  guest_name: string;
  date: string; 
  time: string;
  guests_count: number;
};

type LunchSpecialConfig = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  items: number[];
  itemPrices: { [itemId: number]: number };
  menus: { id: string; name: string; description?: string; itemIds: number[]; price: number }[];
};

const ORDER_META_SHADOW = '[[shadow]]';
const ORDER_META_STATION_FOOD = '[[station:food]]';
const ORDER_META_STATION_DRINK = '[[station:drink]]';
const ORDER_NOTE_MARKERS = ['(Notiz:', '(\u{1F4DD}'];

type CourseStatus = 'new' | 'cooking' | 'ready' | 'abgeholt';
type CourseType = 'starter' | 'main' | 'dessert' | 'drink';

const normalizeAllergens = (value?: string[] | string | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (error) {
      console.warn('[Waiter] Allergene konnten nicht als JSON gelesen werden', error);
    }
  }

  return trimmed.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
};

const isLunchTimeActive = (config: LunchSpecialConfig | null): boolean => {
  if (!config || !config.enabled) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMin] = config.startTime.split(':').map(Number);
  const [endHour, endMin] = config.endTime.split(':').map(Number);
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
};

const splitItemNote = (value: string) => {
  const marker = ORDER_NOTE_MARKERS.find((entry) => value.includes(entry));
  if (!marker) return { label: value.trim(), note: '' };

  const [labelPart, notePart] = value.split(marker);
  return {
    label: labelPart.trim(),
    note: notePart.replace(')', '').trim(),
  };
};

function WaiterContent() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;
  const restaurantHomeHref = `/${restaurantId}`;
  const reservationsOverviewHref = `/${restaurantId}/waiter/reservations`;
  
  // --- STATES ---
  const [tables, setTables] = useState<Table[]>([]);
  const [features, setFeatures] = useState<RestaurantFeatures>(DEFAULT_RESTAURANT_FEATURES);
  const [levels, setLevels] = useState<string[]>(['EG']);
  const [currentLevel, setCurrentLevel] = useState<string>('EG');
  const [viewMode, setViewMode] = useState<'hall' | 'list'>('list');

  const [callingTables, setCallingTables] = useState<Set<string>>(new Set());
  const [billCallingTables, setBillCallingTables] = useState<Set<string>>(new Set());
  const [readyFoodTables, setReadyFoodTables] = useState<Set<string>>(new Set());
  const [readyDrinkTables, setReadyDrinkTables] = useState<Set<string>>(new Set());
  const [occupiedTables, setOccupiedTables] = useState<Set<string>>(new Set());
  const [priceList, setPriceList] = useState<{ [key: string]: number }>({});
  const [descriptionMap, setDescriptionMap] = useState<{ [key: string]: string }>({});
  const [allergenMap, setAllergenMap] = useState<{ [key: string]: string[] }>({});
  const [menuTypeMap, setMenuTypeMap] = useState<Record<string, "food" | "drink">>({});
  const [menuCourseTypeMap, setMenuCourseTypeMap] = useState<Record<string, CourseType>>({});
  const [kitchenCourseStatus, setKitchenCourseStatus] = useState<Record<string, CourseStatus>>({});
  const [drinksTarget, setDrinksTarget] = useState<"bar" | "kitchen">('bar');
  
  const [isEditing, setIsEditing] = useState(false);
  
  // Modal States
  const [showNewTableModal, setShowNewTableModal] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  // NEU: State für Kapazität
  const [newTableSeats, setNewTableSeats] = useState(4);

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableToken, setTableToken] = useState<string | null>(null); // aktueller Token für Anzeige
  const [adminToken, setAdminToken] = useState<string | null>(null); // falls vorhanden
  const [activeTab, setActiveTab] = useState<'bill' | 'reservations' | 'stats'>('bill');
  const [tableOrders, setTableOrders] = useState<OrderDetail[]>([]);
  const [shadowTableOrders, setShadowTableOrders] = useState<OrderDetail[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [stats, setStats] = useState({ totalRevenue: 0, orderCount: 0 });
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [expandedBillDescriptions, setExpandedBillDescriptions] = useState<Set<string>>(new Set());
  const [expandedBillAllergens, setExpandedBillAllergens] = useState<Set<string>>(new Set());
  const [payQtyPicker, setPayQtyPicker] = useState<{ orderId: number; itemIndex: number; item: string; itemLabel: string; maxQty: number } | null>(null);
  const [payQtyValue, setPayQtyValue] = useState(1);

  // Reservierung Form (UPDATE: Date Default)
  const [newRes, setNewRes] = useState({ name: "", date: "", time: "", count: 2 });

  // Drag Refs
  const dragItem = useRef<number | null>(null);
  const dragOffset = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
  const dragPos = useRef<{ x: number, y: number } | null>(null);
  const dragRaf = useRef<number | null>(null);
  const dragPendingPos = useRef<{ x: number, y: number } | null>(null);

  // --- INIT ---
  useEffect(() => {
    let isActive = true;

    const fetchFeatures = async () => {
      const nextFeatures = await loadRestaurantFeatures(restaurantId);
      if (isActive) setFeatures(nextFeatures);
    };

    void fetchFeatures();

    return () => {
      isActive = false;
    };
  }, [restaurantId]);

  useEffect(() => {
    if (!features.reservationsEnabled && activeTab === 'reservations') {
      setActiveTab('bill');
    }
  }, [activeTab, features.reservationsEnabled]);

  useEffect(() => {
    fetchPrices();
    fetchDrinksTarget();
    fetchTables();

    const layoutChannel = supabase.channel('layout-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => {
        fetchTables();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: 'key=eq.drinks_target' }, () => {
        fetchDrinksTarget();
      })
      .subscribe();

    return () => { supabase.removeChannel(layoutChannel); };
  }, []);

  useEffect(() => {
    fetchStatus();
    const orderChannel = supabase.channel('order-updates') 
      .on('broadcast', { event: 'call-waiter' }, (payload) => {
        setCallingTables((prev) => new Set(prev).add(String(payload.payload.tableId)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchStatus();
        if (selectedTable) loadTableData(selectedTable); 
      })
      .subscribe();

    const statusPollId = setInterval(() => {
      fetchStatus();
    }, 5000);

    return () => {
      clearInterval(statusPollId);
      supabase.removeChannel(orderChannel);
    };
  }, [selectedTable, drinksTarget]);

  // wenn ein Tisch wieder geschlossen wird, Token-Status löschen
  useEffect(() => {
    if (!selectedTable) setTableToken(null);
    setPayQtyPicker(null);
    setPayQtyValue(1);
  }, [selectedTable]);

  useEffect(() => {
    fetchStatus();
  }, [menuTypeMap]);

  // --- DATEN LADEN ---
  const fetchTables = async () => {
    try {
      const { data, error } = await supabase.from('tables').select('*').eq('restaurant_id', restaurantId).order('id', { ascending: true });
      if (error) {
        console.error('[Waiter] Fehler beim Laden der Tische:', error);
        return;
      }
      if (data) {
        setTables(data);
        const uniqueLevels = Array.from(new Set(data.map((t: Table) => t.level || 'EG')));
        if (uniqueLevels.length > 0) {
            const sortedLevels = uniqueLevels.sort();
            setLevels(sortedLevels);
            // Setze currentLevel auf das erste verfügbare Level, falls es nicht in den Levels ist
            setCurrentLevel(prev => sortedLevels.includes(prev) ? prev : sortedLevels[0]);
        }
      }
    } catch (err) {
      console.error('[Waiter] Exception beim Laden der Tische:', err);
    }
  };

  const fetchPrices = async () => {
    // Normale Menü-Items laden
    const { data } = await supabase.from('menu').select('id, name, price, description, item_type, allergens').eq('restaurant_id', restaurantId);
    if (data) {
      const newPriceList: { [key: string]: number } = {};
      const newDescriptionMap: { [key: string]: string } = {};
      const newAllergenMap: { [key: string]: string[] } = {};
      const newMenuTypeMap: Record<string, "food" | "drink"> = {};
      const newMenuCourseTypeMap: Record<string, CourseType> = {};

      let typeOverrides: Record<string, CourseType> = {};
      const { data: typeMapData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'menu_item_types')
        .single();
      if (typeMapData?.value) {
        try {
          const parsed = JSON.parse(typeMapData.value);
          if (parsed && typeof parsed === 'object') {
            Object.entries(parsed).forEach(([key, val]) => {
              const v = String(val);
              if (v === 'starter' || v === 'main' || v === 'dessert' || v === 'drink') {
                typeOverrides[key] = v;
              }
            });
          }
        } catch (e) {
          console.error('Fehler beim Lesen von menu_item_types:', e);
        }
      }

      data.forEach((item: any) => {
        const cleanName = normalizeKey(item.name);
        const price = typeof item.price === 'string' ? parseFloat(item.price) : (item.price || 0);
        newPriceList[cleanName] = price;
        if (item.description) newDescriptionMap[cleanName] = item.description;
        const allergens = normalizeAllergens(item.allergens);
        if (allergens.length > 0) newAllergenMap[cleanName] = allergens;
        newMenuTypeMap[cleanName] = item.item_type || 'food';

        const fallbackCourseType: CourseType = item.item_type === 'drink' ? 'drink' : 'main';
        newMenuCourseTypeMap[cleanName] = typeOverrides[String(item.id)] || fallbackCourseType;
      });
      
      console.log('[Waiter] PriceList nach Menu geladen:', Object.entries(newPriceList).slice(0, 5));
      
      // Mittagskarte laden (Angebote + Menüs)
      const { data: lunchData } = await supabase.from('settings').select('value').eq('key', 'lunch_special').eq('restaurant_id', restaurantId).single();
      if (lunchData?.value) {
        try {
          const lunchConfig: LunchSpecialConfig = JSON.parse(lunchData.value);
          const lunchActive = isLunchTimeActive(lunchConfig);

          if (Array.isArray(lunchConfig.menus)) {
            lunchConfig.menus.forEach((menu: any) => {
              const price = typeof menu.price === 'string' ? parseFloat(menu.price) : (menu.price || 0);
              newPriceList[normalizeKey(menu.name)] = price;

              const menuAllergens: string[] = Array.from(
                new Set<string>(
                  menu.itemIds
                    .map((itemId: number) => data.find((menuItem: any) => menuItem.id === itemId))
                    .flatMap((menuItem: any) => normalizeAllergens(menuItem?.allergens))
                )
              );

              if (menuAllergens.length > 0) {
                newAllergenMap[normalizeKey(menu.name)] = menuAllergens;
              }
            });
          }

          if (lunchActive) {
            // Angebotspreise für ausgewählte Gerichte
            if (Array.isArray(lunchConfig.items)) {
              lunchConfig.items.forEach((itemId) => {
                const menuItem = data.find((m: any) => m.id === itemId);
                if (!menuItem) return;
                const specialPriceRaw = lunchConfig.itemPrices?.[itemId] ?? lunchConfig.itemPrices?.[String(itemId) as any];
                const specialPrice = typeof specialPriceRaw === 'string' ? parseFloat(specialPriceRaw as any) : specialPriceRaw;
                const fallbackPrice = typeof menuItem.price === 'string' ? parseFloat(menuItem.price) : (menuItem.price || 0);
                newPriceList[normalizeKey(menuItem.name)] = specialPrice !== undefined && !Number.isNaN(specialPrice)
                  ? specialPrice
                  : fallbackPrice;
              });
            }

            console.log('[Waiter] PriceList nach Lunch geladen:', Object.entries(newPriceList).slice(0, 5));
          }
        } catch (e) {
          console.error('Fehler beim Laden der Mittagsmenüs:', e);
        }
      }
      
      console.log('[Waiter] Finale PriceList:', newPriceList);
      setPriceList(newPriceList);
      setDescriptionMap(newDescriptionMap);
      setAllergenMap(newAllergenMap);
      setMenuTypeMap(newMenuTypeMap);
      setMenuCourseTypeMap(newMenuCourseTypeMap);
    }
  };

  const fetchDrinksTarget = async () => {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'drinks_target')
      .single();

    if (data?.value === 'bar' || data?.value === 'kitchen') {
      setDrinksTarget(data.value);
    }
  };

  const stripOrderMeta = (value: string) =>
    value
      .replace(/\n?\[\[station:(food|drink)\]\]/g, '')
      .replace(/\n?\[\[shadow\]\]/g, '')
      .trim();

  const getOrderItemStation = (value: string): 'food' | 'drink' | null => {
    if (value.includes(ORDER_META_STATION_FOOD)) return 'food';
    if (value.includes(ORDER_META_STATION_DRINK)) return 'drink';
    return null;
  };

  const isShadowOrder = (order: OrderDetail) =>
    order.items.length > 0 && order.items.every((item) => item.includes(ORDER_META_SHADOW));

  const expandMenuItems = (item: string) => {
    const cleanItem = stripOrderMeta(item);
    if (!cleanItem.includes('Im Menü enthalten:')) return [cleanItem];

    const qtyMatch = cleanItem.match(/^(\d+)x\s(.+?)(?:\s-\s|$)/);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    const listPart = cleanItem.split('Im Menü enthalten:')[1] || '';
    const entries = listPart
      .split('\n')
      .map(line => line.replace('•', '').trim())
      .filter(line => Boolean(line) && !line.startsWith('[['));

    if (entries.length === 0) return [cleanItem];

    return entries.map(name => `${qty}x ${name}`);
  };

  const getExpandedTypesForItem = (item: string) => {
    const explicitStation = getOrderItemStation(item);
    if (explicitStation) {
      return new Set<'food' | 'drink'>([explicitStation]);
    }

    const expandedItems = expandMenuItems(item);
    const itemTypes = new Set<"food" | "drink">();

    expandedItems.forEach((expandedItem) => {
      const itemType = getMenuItemType(expandedItem);
      if (itemType) itemTypes.add(itemType);
    });

    if (itemTypes.size === 0) itemTypes.add('food');

    return itemTypes;
  };

  const getReadyKindForOrder = (order: OrderDetail): 'food' | 'drink' | 'both' => {
    let hasFood = false;
    let hasDrink = false;

    order.items
      .filter((item) => !stripOrderMeta(item).includes('KELLNER') && !stripOrderMeta(item).includes('RECHNUNG ANGEFORDERT'))
      .forEach((item) => {
        const itemTypes = getExpandedTypesForItem(item);
        if (itemTypes.has('food')) hasFood = true;
        if (itemTypes.has('drink')) hasDrink = true;
      });

    if (hasFood && hasDrink) return 'both';
    if (hasDrink) return 'drink';
    return 'food';
  };

  const getItemQtyAndName = (item: string) => {
    const cleanItem = stripOrderMeta(item);
    const match = cleanItem.match(/^(\d+)x\s(.+)$/);
    const qty = match ? parseInt(match[1], 10) : 1;
    const rawName = match ? match[2].trim() : cleanItem.trim();
    return { qty, normalizedName: normalizeItemName(rawName) };
  };

  const hasDrinkShadowStateForOrder = (order: OrderDetail, targetState: 'ready' | 'abgeholt') => {
    const ownDrinkCounts = new Map<string, number>();
    order.items
      .filter((item) => !stripOrderMeta(item).includes('KELLNER') && !stripOrderMeta(item).includes('RECHNUNG ANGEFORDERT'))
      .forEach((item) => {
        const station = getOrderItemStation(item);
        const expandedItems = expandMenuItems(item);

        expandedItems.forEach((expandedItem) => {
          const { qty, normalizedName } = getItemQtyAndName(expandedItem);
          const inferredType = getMenuItemType(expandedItem) || 'food';
          if (station === 'drink' || inferredType === 'drink') {
            ownDrinkCounts.set(normalizedName, (ownDrinkCounts.get(normalizedName) || 0) + qty);
          }
        });
      });

    if (ownDrinkCounts.size === 0) return false;

    const ownCreatedAt = new Date(order.created_at).getTime();
    const matchingDrinkCounts = new Map<string, number>();
    shadowTableOrders
      .filter((shadowOrder) => {
        if (shadowOrder.status === 'paid') return false;
        const explicitDrinkStatus = kitchenCourseStatus[`${shadowOrder.id}_drink`];
        if (explicitDrinkStatus !== targetState) return false;

        const shadowCreatedAt = new Date(shadowOrder.created_at).getTime();
        if (!Number.isFinite(ownCreatedAt) || !Number.isFinite(shadowCreatedAt)) return true;

        const maxDeltaMs = 10 * 60 * 1000;
        return Math.abs(shadowCreatedAt - ownCreatedAt) <= maxDeltaMs;
      })
      .forEach((shadowOrder) => {
        shadowOrder.items
          .filter((item) => !stripOrderMeta(item).includes('KELLNER') && !stripOrderMeta(item).includes('RECHNUNG ANGEFORDERT'))
          .forEach((item) => {
            const shadowStation = getOrderItemStation(item);
            const expandedItems = expandMenuItems(item);

            expandedItems.forEach((expandedItem) => {
              const { qty, normalizedName } = getItemQtyAndName(expandedItem);
              const inferredType = getMenuItemType(expandedItem) || 'food';
              if (shadowStation === 'drink' || inferredType === 'drink') {
                matchingDrinkCounts.set(normalizedName, (matchingDrinkCounts.get(normalizedName) || 0) + qty);
              }
            });
          });
      });

    for (const [name, qty] of ownDrinkCounts.entries()) {
      if ((matchingDrinkCounts.get(name) || 0) < qty) return false;
    }
    return true;
  };

  const hasDrinkReadyShadowForOrder = (order: OrderDetail) =>
    hasDrinkShadowStateForOrder(order, 'ready');

  const hasDrinkPickedShadowForOrder = (order: OrderDetail) =>
    hasDrinkShadowStateForOrder(order, 'abgeholt');

  const getReadyCourseTypesForOrder = (orderId: number): CourseType[] => {
    const allowed = new Set<CourseType>(['starter', 'main', 'dessert', 'drink']);
    const result = new Set<CourseType>();

    Object.entries(kitchenCourseStatus).forEach(([key, status]) => {
      if (!key.startsWith(`${orderId}_`) || status !== 'ready') return;
      const rawType = key.split('_')[1] as CourseType | undefined;
      if (rawType && allowed.has(rawType)) result.add(rawType);
    });

    return Array.from(result);
  };

  const getExpectedCourseTypesForItems = (items: any[]): Set<CourseType> => {
    const types = new Set<CourseType>();

    (Array.isArray(items) ? items : []).forEach((item: any) => {
      if (typeof item !== 'string' || item.includes('KELLNER') || item.includes('RECHNUNG ANGEFORDERT')) return;

      const station = getOrderItemStation(item);
      if (station === 'drink') {
        types.add('drink');
        return;
      }
      if (station === 'food') {
        types.add(getCourseTypeForDisplayItem(item));
        return;
      }

      const itemTypes = getExpandedTypesForItem(item);
      if (itemTypes.has('drink')) types.add('drink');
      if (itemTypes.has('food')) types.add(getCourseTypeForDisplayItem(item));
    });

    if (types.size === 0) types.add('main');
    return types;
  };

  const hasAnyCourseStateForOrder = (orderId: number): boolean => {
    return Object.keys(kitchenCourseStatus).some((key) => key.startsWith(`${orderId}_`));
  };

  const isOrderFullyPickedUpByCourseStatus = (order: OrderDetail): boolean => {
    const expectedTypes = Array.from(getExpectedCourseTypesForItems(order.items));

    if (expectedTypes.length === 0) return false;

    return expectedTypes.every(
      (courseType) => kitchenCourseStatus[`${order.id}_${courseType}`] === 'abgeholt'
    );
  };

  const getReadyCourseLabelForOrder = (order: OrderDetail): string | null => {
    const readyCourseTypes = getReadyCourseTypesForOrder(order.id);
    if (readyCourseTypes.length === 0) return null;

    if (readyCourseTypes.length > 1) return 'Teilweise abholbereit';

    if (readyCourseTypes[0] === 'starter') return 'Vorspeise bereit';
    if (readyCourseTypes[0] === 'dessert') return 'Nachtisch bereit';
    if (readyCourseTypes[0] === 'main') return 'Hauptspeise bereit';
    if (readyCourseTypes[0] === 'drink') return 'Getränk bereit';
    return 'Teilweise abholbereit';
  };

  const getCourseTypeForDisplayItem = (displayItem: string): CourseType => {
    const cleanItem = stripOrderMeta(displayItem);
    const match = cleanItem.match(/^(\d+)x\s(.+)$/);
    let rawName = (match ? match[2] : cleanItem).trim();
    rawName = splitItemNote(rawName).label;
    if (rawName.includes(' - ')) rawName = rawName.split(' - ')[0].trim();

    const normalizedName = normalizeItemName(rawName);

    const byCourse = getMenuCourseType(rawName);

    if (/(dessert|nachtisch|süßspeise|kuchen|tiramisu|panna cotta|mousse|eis)/i.test(normalizedName)) {
      return 'dessert';
    }

    if (/(vorspeise|starter|salat|suppe|carpaccio|bruschetta|antipasti)/i.test(normalizedName)) {
      return 'starter';
    }

    if (byCourse) return byCourse;

    const byType = getMenuItemType(rawName);
    if (byType === 'drink') return 'drink';

    return 'main';
  };

  const getStrictCourseTypeForDisplayItem = (displayItem: string): CourseType | null => {
    const cleanItem = stripOrderMeta(displayItem);
    const match = cleanItem.match(/^(\d+)x\s(.+)$/);
    let rawName = (match ? match[2] : cleanItem).trim();
    rawName = splitItemNote(rawName).label;
    if (rawName.includes(' - ')) rawName = rawName.split(' - ')[0].trim();

    const normalizedName = normalizeItemName(rawName);
    if (/(dessert|nachtisch|süßspeise|kuchen|tiramisu|panna cotta|mousse|eis)/i.test(normalizedName)) {
      return 'dessert';
    }

    if (/(vorspeise|starter|salat|suppe|carpaccio|bruschetta|antipasti)/i.test(normalizedName)) {
      return 'starter';
    }

    const byCourse = getMenuCourseType(rawName);
    if (byCourse) return byCourse;

    const byType = getMenuItemType(rawName);
    if (byType === 'drink') return 'drink';

    return null;
  };

  const itemMatchesCourseType = (displayItem: string, courseType: CourseType): boolean => {
    const cleanItem = stripOrderMeta(displayItem);
    const match = cleanItem.match(/^(\d+)x\s(.+)$/);
    let rawName = (match ? match[2] : cleanItem).trim();
    rawName = splitItemNote(rawName).label;
    if (rawName.includes(' - ')) rawName = rawName.split(' - ')[0].trim();

    const normalizedName = normalizeItemName(rawName);
    const exactCourse = getMenuCourseType(rawName);
    const exactType = getMenuItemType(rawName);

    const isDessert = /(dessert|nachtisch|süßspeise|kuchen|tiramisu|panna cotta|mousse|eis)/i.test(normalizedName);
    const isStarter = /(vorspeise|starter|salat|suppe|carpaccio|bruschetta|antipasti)/i.test(normalizedName);
    const isDrink = exactType === 'drink';

    if (courseType === 'dessert') return isDessert || exactCourse === 'dessert';
    if (courseType === 'starter') return isStarter || exactCourse === 'starter';
    if (courseType === 'drink') return isDrink || exactCourse === 'drink';

    return !isDessert && !isStarter && !isDrink && exactCourse !== 'dessert' && exactCourse !== 'starter' && exactCourse !== 'drink';
  };

  const resolveCourseTypeForOrderItem = (orderId: number, displayItem: string): CourseType => {
    const strictCourseType = getStrictCourseTypeForDisplayItem(displayItem);
    const inferred = strictCourseType ?? getCourseTypeForDisplayItem(displayItem);
    const inferredKey = `${orderId}_${inferred}`;
    if (kitchenCourseStatus[inferredKey]) return inferred;

    if (inferred === 'drink') return 'drink';

    if (strictCourseType) return strictCourseType;

    const foodTypes: CourseType[] = ['starter', 'main', 'dessert'];
    const presentFoodTypes = foodTypes.filter((type) => Boolean(kitchenCourseStatus[`${orderId}_${type}`]));

    if (presentFoodTypes.length === 1) return presentFoodTypes[0];

    return inferred;
  };

  const isPickedUpCourseItem = (orderId: number, displayItem: string): boolean => {
    const courseType = resolveCourseTypeForOrderItem(orderId, displayItem);
    return kitchenCourseStatus[`${orderId}_${courseType}`] === 'abgeholt';
  };

  const getVisibleCourseTypesForItems = (orderId: number, displayItems: string[]): Set<CourseType> => {
    const courseTypes = new Set<CourseType>();

    displayItems.forEach((displayItem) => {
      const itemStation = getOrderItemStation(displayItem);
      const itemType = getMenuItemType(displayItem);

      if (itemStation === 'drink' || itemType === 'drink') {
        courseTypes.add('drink');
        return;
      }

      const strictCourseType = getStrictCourseTypeForDisplayItem(displayItem);
      const resolvedCourseType = resolveCourseTypeForOrderItem(orderId, displayItem);
      courseTypes.add(strictCourseType ?? resolvedCourseType);
    });

    return courseTypes;
  };
  
  const fetchStatus = async () => {
    let currentKitchenCourseStatus: Record<string, CourseStatus> = kitchenCourseStatus;

    const { data: kitchenCourseStatusData } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'kitchen_course_status')
      .eq('restaurant_id', restaurantId)
      .single();

    if (kitchenCourseStatusData?.value) {
      try {
        const parsed = JSON.parse(kitchenCourseStatusData.value);
        if (parsed && typeof parsed === 'object') {
          currentKitchenCourseStatus = parsed as Record<string, CourseStatus>;
          setKitchenCourseStatus(currentKitchenCourseStatus);
        }
      } catch (e) {
        console.error('Fehler beim Lesen von kitchen_course_status:', e);
      }
    }

    const { data: readyData } = await supabase
      .from('orders')
      .select('id, table_id, items, status')
      .eq('restaurant_id', restaurantId)
      .in('status', ['new', 'cooking', 'ready']);
    if (readyData) {
      const foodTables = new Set<string>();
      const drinkTables = new Set<string>();

      readyData.forEach((order: any) => {
        const tableId = String(order.table_id);
        let hasFood = false;
        let hasDrink = false;

        const orderId = Number(order.id);
        const readyCourseTypes = new Set<string>();
        Object.entries(currentKitchenCourseStatus).forEach(([key, status]) => {
          if (!key.startsWith(`${orderId}_`) || status !== 'ready') return;
          const courseType = key.split('_')[1];
          if (courseType) readyCourseTypes.add(courseType);
        });

        if (readyCourseTypes.size > 0) {
          if (readyCourseTypes.has('starter') || readyCourseTypes.has('main') || readyCourseTypes.has('dessert')) {
            hasFood = true;
          }
          if (readyCourseTypes.has('drink')) {
            hasDrink = true;
          }
        }

        if (hasFood) foodTables.add(tableId);
        if (hasDrink) drinkTables.add(tableId);
      });

      setReadyFoodTables(foodTables);
      setReadyDrinkTables(drinkTables);
    }
    
    const { data: callData } = await supabase
      .from('orders')
      .select('table_id')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'new')
      .contains('items', ['KELLNER GERUFEN']);
    if (callData) setCallingTables(new Set(callData.map((o: any) => String(o.table_id))));

    const { data: billCallData } = await supabase
      .from('orders')
      .select('table_id')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'new')
      .contains('items', ['RECHNUNG ANGEFORDERT']);
    if (billCallData) setBillCallingTables(new Set(billCallData.map((o: any) => String(o.table_id))));

    const { data: openData } = await supabase
      .from('orders')
      .select('table_id, status, items')
      .eq('restaurant_id', restaurantId)
      .neq('status', 'paid');

    if (openData) {
      const trulyOpen = openData.filter((o: any) => {
        if (Array.isArray(o.items) && o.items.length > 0 && o.items.every((item: string) => item.includes(ORDER_META_SHADOW))) return false;
        const items = Array.isArray(o.items) ? o.items : [];
        if (items.length === 0) return false;
        const onlyServiceCall = items.every((it: any) => typeof it === 'string' && (it.includes('KELLNER GERUFEN') || it.includes('RECHNUNG ANGEFORDERT')));
        return !onlyServiceCall;
      });

      setOccupiedTables(new Set(trulyOpen.map((o: any) => String(o.table_id))));
    }
  };

  const loadTableData = async (tableLabel: string) => {
    setIsLoadingData(true);
    const { data: orders, error } = await supabase.from('orders').select('*').eq('restaurant_id', restaurantId).eq('table_id', tableLabel).order('created_at', { ascending: false });
    console.log('LoadTableData für Tisch:', tableLabel);
    console.log('Bestellungen aus DB:', orders);
    console.log('Fehler:', error);
    if (orders) {
      setTableOrders(orders.filter((order: OrderDetail) => !isShadowOrder(order)));
      setShadowTableOrders(orders.filter((order: OrderDetail) => isShadowOrder(order)));
    }

    // UPDATE: Nur zukünftige Reservierungen anzeigen
    const today = new Date().toISOString().split('T')[0];
    const { data: res } = await supabase
      .from('reservations')
      .select('*')
      .eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID)
      .eq('table_id', tableLabel)
      .gte('date', today)
      .order('date', { ascending: true })
      .order('time', { ascending: true });
    if (res) setReservations(res);

    const { data: history } = await supabase.from('orders').select('items').eq('restaurant_id', restaurantId).eq('table_id', tableLabel).eq('status', 'paid');
    if (history) {
      let totalRev = 0;
      history.forEach(o => totalRev += calculateOrderValue(o.items));
      setStats({ totalRevenue: totalRev, orderCount: history.length });
    }
    setIsLoadingData(false);
  };

  const calculateOrderValue = (items: string[]) => {
    let sum = 0;
    if(!items) return 0;
    items.forEach(itemStr => {
       const cleanItem = stripOrderMeta(itemStr);
       if(cleanItem.includes("KELLNER") || cleanItem.includes("RECHNUNG ANGEFORDERT")) return;
       sum += getOrderItemTotal(itemStr);
    });
    return sum;
  };

  const normalizeItemName = (value: string) => {
    let name = stripOrderMeta(value);

    const qtyMatch = name.match(/^(\d+)x\s([\s\S]+)$/);
    if (qtyMatch) {
      name = qtyMatch[2];
    }

    name = splitItemNote(name).label;
    name = name.split(" - ")[0];
    name = name.split(" – ")[0];
    name = name.split("\n")[0];
    name = name.replace(/Im Menü enthalten:[\s\S]*/gi, '');

    return normalizeKey(name);
  };

  const normalizeKey = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');

  const getAllergensForItemName = (value: string): string[] => {
    const normalizedName = normalizeItemName(value);
    const exactAllergens = allergenMap[normalizedName];
    if (exactAllergens) return exactAllergens;

    for (const [key, allergens] of Object.entries(allergenMap)) {
      if (normalizedName.includes(key) || key.includes(normalizedName)) {
        return allergens;
      }
    }

    return [];
  };

  const getMenuItemType = (value: string): 'food' | 'drink' | null => {
    const normalizedName = normalizeItemName(value);
    const exactType = menuTypeMap[normalizedName];
    if (exactType) return exactType;

    for (const [key, itemType] of Object.entries(menuTypeMap)) {
      if (normalizedName.includes(key) || key.includes(normalizedName)) {
        return itemType;
      }
    }

    return null;
  };

  const getMenuCourseType = (value: string): CourseType | undefined => {
    const normalizedName = normalizeItemName(value);
    const exactCourseType = menuCourseTypeMap[normalizedName];
    if (exactCourseType) return exactCourseType;

    for (const [key, courseType] of Object.entries(menuCourseTypeMap)) {
      if (normalizedName.includes(key) || key.includes(normalizedName)) {
        return courseType;
      }
    }

    return undefined;
  };

  const getUnitPriceForItemName = (rawName: string) => {
    let name = normalizeItemName(rawName);

    let price = priceList[name];

    if (!price) {
      for (const [key, val] of Object.entries(priceList)) {
        if (name.includes(key) || key.includes(name)) {
          price = val as number;
          break;
        }
      }
    }

    return price || 0;
  };

  const parseOrderItemString = (item: string) => {
    const cleanItem = stripOrderMeta(item);
    const match = cleanItem.match(/^(\d+)\s*x\s+([\s\S]+)$/i);

    return {
      quantity: match ? parseInt(match[1], 10) : 1,
      label: match ? match[2].trim() : cleanItem.trim(),
      cleanItem,
    };
  };

  const getOrderItemUnitPrice = (item: string) => {
    const { label } = parseOrderItemString(item);
    const baseLabel = splitItemNote(label).label.split(" - ")[0].split(" – ")[0].trim();
    return getUnitPriceForItemName(baseLabel);
  };

  const getOrderItemTotal = (item: string) => {
    const { quantity } = parseOrderItemString(item);
    return quantity * getOrderItemUnitPrice(item);
  };

  const getQtyFromItemString = (item: string) => {
    return parseOrderItemString(item).quantity;
  };

  const openPayQtyPicker = (orderId: number, itemIndex: number, item: string) => {
    const maxQty = getQtyFromItemString(item);
    if (maxQty <= 1) {
      void paySingleItem(orderId, itemIndex, item, 1);
      return;
    }

    const itemLabel = parseOrderItemString(item).label;
    setPayQtyPicker({ orderId, itemIndex, item, itemLabel, maxQty });
    setPayQtyValue(1);
  };

  const confirmPayQtyPicker = async () => {
    if (!payQtyPicker) return;
    const safeQty = Math.max(1, Math.min(payQtyValue, payQtyPicker.maxQty));
    await paySingleItem(payQtyPicker.orderId, payQtyPicker.itemIndex, payQtyPicker.item, safeQty);
    setPayQtyPicker(null);
    setPayQtyValue(1);
  };

  // --- ACTIONS ---

  const addNewLevel = () => {
      const name = prompt("Name der neuen Ebene (z.B. 'Terrasse'):");
      if (name && !levels.includes(name)) {
          setLevels(prev => [...prev, name]);
          setCurrentLevel(name);
      } else if (name) {
          setCurrentLevel(name);
      }
  };

  const renameLevel = async (oldName: string) => {
    const trimmedOldName = oldName.trim();
    const nextName = prompt("Neuer Name der Ebene:", trimmedOldName)?.trim();
    if (!nextName || nextName === trimmedOldName) return;
    if (levels.some(level => level !== trimmedOldName && level.toLowerCase() === nextName.toLowerCase())) {
      alert("Diese Ebene gibt es bereits.");
      return;
    }

    const { error } = await supabase
      .from('tables')
      .update({ level: nextName })
      .eq('restaurant_id', restaurantId)
      .eq('level', trimmedOldName);

    if (error) {
      console.error('[Waiter] Ebene konnte nicht umbenannt werden:', error);
      alert("Ebene konnte nicht umbenannt werden.");
      return;
    }

    setLevels(prev => prev.map(level => level === trimmedOldName ? nextName : level));
    setTables(prev => prev.map(table => (table.level || 'EG') === trimmedOldName ? { ...table, level: nextName } : table));
    setCurrentLevel(prev => prev === trimmedOldName ? nextName : prev);
  };

  const createTable = async (shape: TableShape) => {
    if (tables.length >= features.tableLimit) {
        alert(`Das Tischlimit für dieses Restaurant ist erreicht (${features.tableLimit}).`);
        return;
    }
    if (!newTableName) {
        alert("Bitte gib dem Tisch einen Namen.");
        return;
    }
    setShowNewTableModal(false);
    const nameToUse = newTableName;
    const seatsToUse = newTableSeats; // Wert speichern
    
    setNewTableName("");
    setNewTableSeats(4); // Reset

    const { data, error } = await supabase
      .from('tables')
      // NEU: seats hier mitgeben
      .insert({ label: nameToUse, x: 100, y: 100, shape: shape, level: currentLevel, seats: seatsToUse, restaurant_id: restaurantId })
      .select()
      .single();

    if (error) {
      console.error("Supabase Error:", error);
      alert("Fehler beim Erstellen!");
      return;
    }
    if (data) setTables(prev => [...prev, data]);
  };

  const deleteTable = async (e: React.MouseEvent | null, id: number, label: string) => {
    if (e) e.stopPropagation();
    const { data: openOrders } = await supabase.from('orders').select('id').eq('restaurant_id', restaurantId).eq('table_id', label).neq('status', 'paid');
    if (openOrders && openOrders.length > 0) {
        alert(`Tisch ${label} kann nicht gelöscht werden!\nEs gibt noch offene Bestellungen.`);
        return;
    }
    if (!confirm(`Tisch ${label} wirklich entfernen?`)) return;
    setTables(prev => prev.filter(t => t.id !== id));
    await supabase.from('tables').delete().eq('id', id);
  };

  const syncKitchenCoursesToPickedUpForTable = async (tableLabel: string): Promise<number[]> => {
    const { data: readyOrders } = await supabase
      .from('orders')
      .select('id, items')
      .eq('restaurant_id', restaurantId)
      .eq('table_id', tableLabel)
      .eq('status', 'ready');

    if (!readyOrders || readyOrders.length === 0) return [];

    let currentMap: Record<string, CourseStatus> = {};
    const { data: courseStatusData } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'kitchen_course_status')
      .eq('restaurant_id', restaurantId)
      .single();

    if (courseStatusData?.value) {
      try {
        const parsed = JSON.parse(courseStatusData.value);
        if (parsed && typeof parsed === 'object') {
          currentMap = parsed as Record<string, CourseStatus>;
        }
      } catch (e) {
        console.error('Fehler beim Lesen von kitchen_course_status (sync):', e);
      }
    }

    const nextMap: Record<string, CourseStatus> = { ...currentMap };

    const pickedUpOrderIds: number[] = [];

    const getExpectedCourseTypesForItems = (items: any[]): Set<CourseType> => {
      const types = new Set<CourseType>();

      (Array.isArray(items) ? items : []).forEach((item: any) => {
        if (typeof item !== 'string' || item.includes('KELLNER') || item.includes('RECHNUNG ANGEFORDERT')) return;

        const station = getOrderItemStation(item);
        if (station === 'drink') {
          types.add('drink');
          return;
        }
        if (station === 'food') {
          types.add(getCourseTypeForDisplayItem(item));
          return;
        }

        const itemTypes = getExpandedTypesForItem(item);
        if (itemTypes.has('drink')) types.add('drink');
        if (itemTypes.has('food')) types.add(getCourseTypeForDisplayItem(item));
      });

      if (types.size === 0) types.add('main');
      return types;
    };

    const getInferredReadyTypesForItems = (items: any[]): Set<CourseType> => {
      const types = new Set<CourseType>();

      (Array.isArray(items) ? items : []).forEach((item: any) => {
        if (typeof item !== 'string' || item.includes('KELLNER') || item.includes('RECHNUNG ANGEFORDERT')) return;

        const station = getOrderItemStation(item);
        if (station === 'drink') {
          types.add('drink');
          return;
        }
        if (station === 'food') {
          types.add(getCourseTypeForDisplayItem(item));
          return;
        }

        const itemTypes = getExpandedTypesForItem(item);

        if (drinksTarget === 'bar' && itemTypes.has('drink')) {
          // Bei Bar-Ready ohne explizite Kurskeys nur Getränke als abgeholt markieren.
          types.add('drink');
          return;
        }

        if (itemTypes.has('drink')) types.add('drink');
        if (itemTypes.has('food')) types.add(getCourseTypeForDisplayItem(item));
      });

      if (types.size === 0) types.add('main');
      return types;
    };

    readyOrders.forEach((order: any) => {
      const orderId = Number(order.id);
      const orderKeys = Object.keys(nextMap).filter((key) => key.startsWith(`${orderId}_`));
      const expectedTypes = getExpectedCourseTypesForItems(order.items);

      if (orderKeys.length > 0) {
        orderKeys.forEach((key) => {
          if (nextMap[key] === 'ready') {
            nextMap[key] = 'abgeholt';
          }
        });
      } else {
        const inferredTypes = getInferredReadyTypesForItems(order.items);
        inferredTypes.forEach((courseType) => {
          nextMap[`${orderId}_${courseType}`] = 'abgeholt';
        });
      }

      const isFullyPickedUp = Array.from(expectedTypes).every(
        (courseType) => nextMap[`${orderId}_${courseType}`] === 'abgeholt'
      );
      if (isFullyPickedUp) pickedUpOrderIds.push(orderId);
    });

    setKitchenCourseStatus(nextMap);
    const { error } = await supabase
      .from('settings')
      .upsert(
        { restaurant_id: restaurantId, key: 'kitchen_course_status', value: JSON.stringify(nextMap) },
        { onConflict: 'restaurant_id,key' }
      );

    if (error) {
      console.error('Fehler beim Speichern von kitchen_course_status (sync):', error);
    }

    return pickedUpOrderIds;
  };

  const handleQuickReset = async (tableLabel: string) => {
    if (isEditing) return;
    const newCalls = new Set(callingTables); newCalls.delete(tableLabel); setCallingTables(newCalls);
    const newBillCalls = new Set(billCallingTables); newBillCalls.delete(tableLabel); setBillCallingTables(newBillCalls);
    const newReadyFood = new Set(readyFoodTables); newReadyFood.delete(tableLabel); setReadyFoodTables(newReadyFood);
    const newReadyDrink = new Set(readyDrinkTables); newReadyDrink.delete(tableLabel); setReadyDrinkTables(newReadyDrink);
    const pickedUpReadyOrderIds = await syncKitchenCoursesToPickedUpForTable(tableLabel);
    await supabase.from('orders').update({ status: 'abgeholt' }).eq('restaurant_id', restaurantId).eq('table_id', tableLabel).contains('items', ['KELLNER GERUFEN']);
    await supabase.from('orders').update({ status: 'abgeholt' }).eq('restaurant_id', restaurantId).eq('table_id', tableLabel).contains('items', ['RECHNUNG ANGEFORDERT']);
    if (pickedUpReadyOrderIds.length > 0) {
      await supabase.from('orders').update({ status: 'abgeholt' }).eq('restaurant_id', restaurantId).in('id', pickedUpReadyOrderIds);
    }
    setTimeout(fetchStatus, 500);
  };

  const markReadyAsPickedUp = async (tableLabel: string) => {
    if (isEditing) return;
    const pickedUpReadyOrderIds = await syncKitchenCoursesToPickedUpForTable(tableLabel);
    if (pickedUpReadyOrderIds.length > 0) {
      await supabase.from('orders').update({ status: 'abgeholt' }).eq('restaurant_id', restaurantId).in('id', pickedUpReadyOrderIds);
    }

    const newReadyFood = new Set(readyFoodTables);
    newReadyFood.delete(tableLabel);
    setReadyFoodTables(newReadyFood);

    const newReadyDrink = new Set(readyDrinkTables);
    newReadyDrink.delete(tableLabel);
    setReadyDrinkTables(newReadyDrink);

    if (selectedTable === tableLabel) {
      loadTableData(tableLabel);
    }
    setTimeout(fetchStatus, 300);
  };

  const clearWaiterCallForTable = async (tableLabel: string) => {
    const hasWaiterCall = callingTables.has(tableLabel);
    const hasBillCall = billCallingTables.has(tableLabel);
    if (!hasWaiterCall && !hasBillCall) return;

    if (hasWaiterCall) {
      const newCalls = new Set(callingTables);
      newCalls.delete(tableLabel);
      setCallingTables(newCalls);
    }

    if (hasBillCall) {
      const newBillCalls = new Set(billCallingTables);
      newBillCalls.delete(tableLabel);
      setBillCallingTables(newBillCalls);
    }

    await supabase
      .from('orders')
      .update({ status: 'abgeholt' })
      .eq('restaurant_id', restaurantId)
      .eq('table_id', tableLabel)
      .contains('items', ['KELLNER GERUFEN']);

    await supabase
      .from('orders')
      .update({ status: 'abgeholt' })
      .eq('restaurant_id', restaurantId)
      .eq('table_id', tableLabel)
      .contains('items', ['RECHNUNG ANGEFORDERT']);

    setTimeout(fetchStatus, 300);
  };

  const handleOpenDetails = async (e: React.MouseEvent | null, tableLabel: string) => {
    if (e) e.stopPropagation(); 
    if (isEditing) return;
    if (callingTables.has(tableLabel) || billCallingTables.has(tableLabel)) {
      await clearWaiterCallForTable(tableLabel);
    }
    // UPDATE: Datum beim Öffnen auf Heute setzen
    setNewRes({ name: "", date: new Date().toISOString().split('T')[0], time: "", count: 2 });
    setSelectedTable(tableLabel);
    setActiveTab('bill');
    loadTableData(tableLabel);
    // automatisch aktuellen Token laden
    const tok = await fetchCurrentTokenForTable(tableLabel, supabase, restaurantId);
    setTableToken(tok);
    // admin token available as env var exposed to client
    if (process.env.NEXT_PUBLIC_ADMIN_ACCESS_TOKEN) {
      setAdminToken(process.env.NEXT_PUBLIC_ADMIN_ACCESS_TOKEN);
    }
  };

  const handlePayAndReset = async () => {
    if (!selectedTable) return;
    
    // Markiere alle Bestellungen als "paid"
    await supabase.from('orders').update({ status: 'paid' }).eq('table_id', selectedTable).neq('status', 'paid');
    
    // QR-Code bleibt gültig; nur der Kunden-Token für alte Browser-Links rotiert.
    await invalidateCustomerTokensForTable(selectedTable, supabase, restaurantId);
    
    setSelectedTable(null);
    fetchStatus();
  };

  const cancelOrder = async (orderId: number) => {
    if (!confirm("Bestellung wirklich stornieren? Dies kann nicht rückgängig gemacht werden.")) return;
    await supabase.from('orders').delete().eq('id', orderId);
    if (selectedTable) loadTableData(selectedTable);
    fetchStatus();
  };

  const cancelOrderItem = async (orderId: number, itemIndex: number, itemName: string, requestedQty?: number) => {
    const order = tableOrders.find(o => o.id === orderId);
    if (!order) return;

    const deletedItem = order.items[itemIndex];
    if (!deletedItem) return;

    const originalMatch = deletedItem.match(/^(\d+)x\s(.+)$/);
    const originalQty = originalMatch ? parseInt(originalMatch[1]) : 1;
    const originalName = originalMatch ? originalMatch[2].trim() : deletedItem.trim();

    const displayMatch = itemName.match(/^(\d+)x\s(.+)$/);
    const visibleQty = displayMatch ? parseInt(displayMatch[1]) : 1;
    const maxQtyToDelete = Math.min(originalQty, visibleQty || originalQty);

    const qtyToDelete = requestedQty ? Math.max(1, Math.min(requestedQty, maxQtyToDelete)) : maxQtyToDelete;

    if (!confirm(`${qtyToDelete}x "${originalName}" wirklich stornieren?`)) return;
    
    // Preis des Items berechnen
    const itemNameForPrice = normalizeItemName(originalName);
    let unitPrice = priceList[itemNameForPrice] || 0;
    if (!unitPrice) {
      for (const [key, val] of Object.entries(priceList)) {
        if (itemNameForPrice.includes(key) || key.includes(itemNameForPrice)) {
          unitPrice = val as number;
          break;
        }
      }
    }
    
    // Item in der aktuellen Bestellung reduzieren/entfernen
    const newItems = [...order.items];
    const remainingQty = originalQty - qtyToDelete;

    if (remainingQty <= 0) {
      newItems.splice(itemIndex, 1);
    } else {
      newItems[itemIndex] = `${remainingQty}x ${originalName}`;
    }

    const oldTotal = order.total_price || 0;
    const itemTotalPrice = unitPrice * qtyToDelete;
    const newTotal = Math.max(0, oldTotal - itemTotalPrice);
    
    if (newItems.length === 0) {
      await supabase.from('orders').delete().eq('id', orderId);
    } else {
      await supabase.from('orders').update({ items: newItems, total_price: newTotal }).eq('id', orderId);
    }
    
    // WICHTIG: Wenn aus einer Teil-Rechnung storniert wird, auch aus allen anderen Bestellungen entfernen
    if (order.status === 'pay_split' && selectedTable) {
      let remainingQtyToDelete = qtyToDelete;
      const normalizedOriginalName = normalizeItemName(originalName);
      
      // Durchlaufe alle anderen Bestellungen und entferne das Item
      for (const otherOrder of tableOrders) {
        if (otherOrder.id === orderId || remainingQtyToDelete <= 0) continue;
        if (otherOrder.status === 'paid') continue; // Bezahlte nicht anfassen
        
        let orderChanged = false;
        const updatedItems: string[] = [];
        let priceReduction = 0;
        
        for (const item of otherOrder.items) {
          const itemMatch = item.match(/^(\d+)x\s(.+)$/);
          const currentItemName = itemMatch ? itemMatch[2].trim() : item.trim();
          const currentItemQty = itemMatch ? parseInt(itemMatch[1]) : 1;
          
          if (normalizeItemName(currentItemName) === normalizedOriginalName && remainingQtyToDelete > 0) {
            if (currentItemQty <= remainingQtyToDelete) {
              // Komplettes Item entfernen
              remainingQtyToDelete -= currentItemQty;
              priceReduction += unitPrice * currentItemQty;
              orderChanged = true;
              // Item nicht zu updatedItems hinzufügen = löschen
            } else {
              // Menge reduzieren
              const newQty = currentItemQty - remainingQtyToDelete;
              priceReduction += unitPrice * remainingQtyToDelete;
              remainingQtyToDelete = 0;
              updatedItems.push(`${newQty}x ${currentItemName}`);
              orderChanged = true;
            }
          } else {
            updatedItems.push(item);
          }
        }
        
        if (orderChanged) {
          const otherNewTotal = Math.max(0, (otherOrder.total_price || 0) - priceReduction);
          
          if (updatedItems.length === 0) {
            await supabase.from('orders').delete().eq('id', otherOrder.id);
          } else {
            await supabase.from('orders').update({ items: updatedItems, total_price: otherNewTotal }).eq('id', otherOrder.id);
          }
        }
      }
    }
    
    if (selectedTable) loadTableData(selectedTable);
    fetchStatus();
  };

  const paySingleItem = async (orderId: number, itemIndex: number, displayItem: string, requestedQty?: number) => {
    if (!selectedTable) return;

    const order = tableOrders.find(o => o.id === orderId);
    if (!order) return;

    const displayMatch = displayItem.match(/^(\d+)x\s(.+)$/);
    const payQty = displayMatch ? parseInt(displayMatch[1]) : 1;

    const originalItem = order.items[itemIndex];
    const originalMatch = originalItem.match(/^(\d+)x\s(.+)$/);
    const originalQty = originalMatch ? parseInt(originalMatch[1]) : 1;
    const originalName = originalMatch ? originalMatch[2].trim() : originalItem.trim();

    const maxPayQty = Math.min(originalQty, payQty || originalQty);
    const selectedQty = requestedQty ? Math.max(1, Math.min(requestedQty, maxPayQty)) : maxPayQty;

    if (selectedQty <= 0 || selectedQty > originalQty) return;

    const unitPrice = getUnitPriceForItemName(originalName);
    const itemTotal = unitPrice * selectedQty;

    const newItems = [...order.items];
    const remainingQty = originalQty - selectedQty;

    if (remainingQty <= 0) {
      newItems.splice(itemIndex, 1);
    } else {
      newItems[itemIndex] = `${remainingQty}x ${originalName}`;
    }

    if (newItems.length === 0) {
      await supabase.from('orders').delete().eq('id', orderId);
    } else {
      const newTotal = Math.max(0, (order.total_price || 0) - itemTotal);
      await supabase.from('orders').update({ items: newItems, total_price: newTotal }).eq('id', orderId);
    }

    await supabase.from('orders').insert({
      table_id: selectedTable,
      items: [`${selectedQty}x ${originalName}`],
      total_price: itemTotal,
      status: 'paid'
    });

    loadTableData(selectedTable);
    fetchStatus();
  };

  const handlePaySpecific = async (orderId: number) => {
    const orderToPay = tableOrders.find(o => o.id === orderId);
    if (!orderToPay) return;

    // Wenn eine Teil-Rechnung bezahlt wird, entferne die Items aus den offenen Bestellungen
    if (orderToPay.status === 'pay_split' && selectedTable) {
      for (const itemStr of orderToPay.items) {
        const match = itemStr.match(/^(\d+)x\s(.+)$/);
        const qtyToRemove = match ? parseInt(match[1]) : 1;
        const rawName = match ? match[2].trim() : itemStr.trim();
        let remainingQtyToRemove = qtyToRemove;

        for (const otherOrder of tableOrders) {
          if (otherOrder.id === orderId) continue;
          if (otherOrder.status === 'paid' || otherOrder.status === 'pay_split') continue;
          if (remainingQtyToRemove <= 0) break;

          let orderChanged = false;
          const updatedItems: string[] = [];
          let priceReduction = 0;

          for (const item of otherOrder.items) {
            if (remainingQtyToRemove <= 0) {
              updatedItems.push(item);
              continue;
            }

            const itemMatch = item.match(/^(\d+)x\s(.+)$/);
            const itemQty = itemMatch ? parseInt(itemMatch[1]) : 1;
            const itemName = itemMatch ? itemMatch[2].trim() : item.trim();

            if (normalizeItemName(itemName) !== normalizeItemName(rawName)) {
              updatedItems.push(item);
              continue;
            }

            const deduct = Math.min(itemQty, remainingQtyToRemove);
            const newQty = itemQty - deduct;
            remainingQtyToRemove -= deduct;
            orderChanged = true;

            const unitPrice = getUnitPriceForItemName(itemName);
            priceReduction += unitPrice * deduct;

            if (newQty > 0) {
              updatedItems.push(`${newQty}x ${itemName}`);
            }
          }

          if (orderChanged) {
            const otherNewTotal = Math.max(0, (otherOrder.total_price || 0) - priceReduction);
            if (updatedItems.length === 0) {
              await supabase.from('orders').delete().eq('id', otherOrder.id);
            } else {
              await supabase.from('orders').update({ items: updatedItems, total_price: otherNewTotal }).eq('id', otherOrder.id);
            }
          }
        }
      }
    }

    // Markiere Bestellung als "paid"
    await supabase.from('orders').update({ status: 'paid' }).eq('id', orderId);
    
    // Prüfe ob alle Bestellungen des Tisches bezahlt sind
    if (selectedTable) {
      const { data: unpaidOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('table_id', selectedTable)
        .neq('status', 'paid');
      
      // Wenn alle bezahlt sind, rotiere den Kunden-Token für alte Browser-Links.
      if (!unpaidOrders || unpaidOrders.length === 0) {
        await invalidateCustomerTokensForTable(selectedTable, supabase, restaurantId);
      }
      
      loadTableData(selectedTable);
    }
    fetchStatus();
  };

  const addReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!selectedTable || !newRes.name || !newRes.date) return;
    
    // Prüfe, ob das Datum nicht in der Vergangenheit liegt
    const today = new Date().toISOString().split('T')[0];
    if (newRes.date < today) {
      alert("Reservierungen können nicht in der Vergangenheit erstellt werden!");
      return;
    }
    
    // Prüfe auf zeitliche Konflikte (2-Stunden-Fenster)
    if (newRes.time) {
      const { data: existingRes } = await supabase
        .from('reservations')
        .select('time')
        .eq('table_id', selectedTable)
        .eq('date', newRes.date);

      if (existingRes && existingRes.length > 0) {
        const [hours, minutes] = newRes.time.split(':').map(Number);
        const bookingStart = hours * 60 + minutes;
        const bookingEnd = bookingStart + 120; // 2 Stunden = 120 Minuten

        const hasConflict = existingRes.some((res: any) => {
          const [resHours, resMinutes] = res.time.split(':').map(Number);
          const resStart = resHours * 60 + resMinutes;
          const resEnd = resStart + 120;
          return resStart < bookingEnd && resEnd > bookingStart;
        });

        if (hasConflict) {
          alert("Tisch ist in diesem Zeitfenster bereits reserviert!");
          return;
        }
      }
    }

    // UPDATE: Insert mit Datum
    await supabase.from('reservations').insert({ 
        restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID,
        table_id: selectedTable, 
        guest_name: newRes.name, 
        date: newRes.date,
        time: newRes.time, 
        guests_count: newRes.count 
    });
    setNewRes({ ...newRes, name: "", time: "" }); // Datum behalten für schnelle Eingabe
    loadTableData(selectedTable);
  };
  const deleteReservation = async (id: number) => {
    await supabase.from('reservations').delete().eq('id', id);
    if(selectedTable) loadTableData(selectedTable);
  };
  const openGuestView = () => {
    if (!selectedTable || !tableToken) return;
    const url = `/${encodeURIComponent(restaurantId)}/qr/${encodeURIComponent(selectedTable)}?qr=${encodeURIComponent(tableToken)}`;
    window.open(url, '_blank');
  };

  // --- HELPER FUNCTIONS FÜR KALENDER ANSICHT ---
  const groupReservationsByDate = () => {
    const grouped: { [key: string]: Reservation[] } = {};
    reservations.forEach(res => {
      const dateKey = res.date || "Ohne Datum";
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(res);
    });
    return grouped;
  };

  const formatDateLabel = (dateStr: string) => {
    if (dateStr === "Ohne Datum") return dateStr;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0,0,0,0);
    date.setHours(0,0,0,0);
    
    if (date.getTime() === today.getTime()) return "Heute";
    
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (date.getTime() === tomorrow.getTime()) return "Morgen";

    return date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  };


  // --- DRAG LOGIC ---
  const handlePointerDown = (e: React.PointerEvent, table: Table) => {
    if (!isEditing) return; 
    e.preventDefault();
    dragItem.current = table.id;
    dragPos.current = { x: table.x, y: table.y };
    dragOffset.current = { x: e.clientX - table.x, y: e.clientY - table.y };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerup);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!dragItem.current) return;
    const newX = e.clientX - dragOffset.current.x;
    const newY = e.clientY - dragOffset.current.y;
    dragPos.current = { x: newX, y: newY };
    dragPendingPos.current = { x: newX, y: newY };

    if (dragRaf.current !== null) return;

    dragRaf.current = window.requestAnimationFrame(() => {
      dragRaf.current = null;
      if (!dragItem.current || !dragPendingPos.current) return;

      const { x, y } = dragPendingPos.current;
      setTables(prev => prev.map(t => t.id === dragItem.current ? { ...t, x, y } : t));
    });
  };

  const handlePointerup = async () => {
    if (dragRaf.current !== null) {
      window.cancelAnimationFrame(dragRaf.current);
      dragRaf.current = null;
    }

    if (dragItem.current && dragPendingPos.current) {
      const { x, y } = dragPendingPos.current;
      setTables(prev => prev.map(t => t.id === dragItem.current ? { ...t, x, y } : t));
    }

    if (dragItem.current && dragPos.current) {
        const { id } = { id: dragItem.current };
        const { x, y } = dragPos.current;
        await supabase.from('tables').update({ x, y }).eq('id', id);
    }
    dragItem.current = null;
    dragPos.current = null;
    dragPendingPos.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerup);
  };

  const getShapeStyle = (shape: string) => {
    switch (shape) {
        case 'square': return 'w-32 h-32 rounded-sm';
        case 'rect': return 'w-48 h-32 rounded-sm';
        default: return 'w-32 h-32 rounded-full';
    }
  };

  const getLevelStatus = (lvl: string) => {
    const tablesOnLevel = tables.filter(t => (t.level || 'EG') === lvl);
    const hasCall = tablesOnLevel.some(t => callingTables.has(t.label) || billCallingTables.has(t.label));
    const hasFoodReady = tablesOnLevel.some(t => readyFoodTables.has(t.label));
    const hasDrinkReady = tablesOnLevel.some(t => readyDrinkTables.has(t.label));
    const hasReady = hasFoodReady || hasDrinkReady;
    
    if (hasCall && hasReady) return 'both';
    if (hasCall) return 'call';
    if (hasReady) return 'ready';
    return null;
  };

  const getTableVisualStatus = (tableLabel: string) => {
    const isCalling = callingTables.has(tableLabel);
    const isBillCalling = billCallingTables.has(tableLabel);
    const isFoodReady = readyFoodTables.has(tableLabel);
    const isDrinkReady = readyDrinkTables.has(tableLabel);
    const isOccupied = occupiedTables.has(tableLabel);

    let circleBg = '#1e293b';
    let circleBorder = '#334155';
    let statusText: string | null = null;
    let animationClass = '';

    if ((isCalling || isBillCalling) && isFoodReady && isDrinkReady) {
      circleBg = 'linear-gradient(135deg, #dc2626 0%, #dc2626 34%, #16a34a 34%, #16a34a 67%, #0ea5e9 67%, #0ea5e9 100%)';
      circleBorder = '#fff';
      statusText = `${isBillCalling ? 'Rechnung' : 'Ruf'} + Alles`;
      animationClass = 'animate-pulse';
    } else if (isCalling || isBillCalling) {
      if (isFoodReady) {
        circleBg = 'linear-gradient(135deg, #dc2626 50%, #16a34a 50%)';
        circleBorder = '#fff';
        statusText = `${isBillCalling ? 'Rechnung' : 'Ruf'} + Essen`;
      } else if (isDrinkReady) {
        circleBg = 'linear-gradient(135deg, #dc2626 50%, #0ea5e9 50%)';
        circleBorder = '#fff';
        statusText = `${isBillCalling ? 'Rechnung' : 'Ruf'} + Getränk`;
      } else {
        circleBg = '#dc2626';
        circleBorder = '#fca5a5';
        statusText = isBillCalling ? 'Rechnung' : 'Ruf!';
      }
      animationClass = 'animate-pulse';
    } else if (isFoodReady && isDrinkReady) {
      circleBg = 'linear-gradient(135deg, #16a34a 50%, #0ea5e9 50%)';
      circleBorder = '#bae6fd';
      statusText = 'Essen + Getränk';
    } else if (isFoodReady) {
      circleBg = '#16a34a';
      circleBorder = '#86efac';
      statusText = 'ESSEN!';
    } else if (isDrinkReady) {
      circleBg = '#0ea5e9';
      circleBorder = '#7dd3fc';
      statusText = 'GETRÄNK!';
    }

    return { isCalling, isBillCalling, isFoodReady, isDrinkReady, isOccupied, circleBg, circleBorder, statusText, animationClass };
  };

  const visibleTables = tables.filter(t => (t.level || 'EG') === currentLevel);
  const tableLimitText = features.tableLimit === 1 ? "1 freigeschaltet" : `${features.tableLimit} freigeschaltet`;
  const topControlClass = "flex h-10 w-[9.5rem] items-center justify-center gap-1.5 rounded-lg px-3 text-center text-xs font-bold leading-tight shadow-lg transition-all md:h-11 md:w-[16rem] md:whitespace-nowrap md:text-sm";

  const getBlockedItems = () => {
    const blocked: Record<string, number> = {};
    tableOrders.forEach(order => {
        // Nur Teil-Rechnungen (pay_split) blockieren Items, nicht komplett bezahlte Bestellungen
        if (order.status === 'pay_split') {
            order.items.forEach(itemStr => {
              const match = itemStr.match(/^(\d+)x\s([\s\S]+)$/);
              if(match) {
                  const count = parseInt(match[1]);
                  const name = normalizeItemName(match[2]);
                  blocked[name] = (blocked[name] || 0) + count;
              }
          });
        }
    });
    return blocked;
  };

  const getVisibleOpenItemsByOrder = () => {
    const remainingBlockedItems = { ...getBlockedItems() };
    const visibleItemsByOrder: Record<number, Array<{ displayItem: string; originalIndex: number }>> = {};

    [...tableOrders]
      .filter((order) => order.status !== 'pay_split' && order.status !== 'paid')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .forEach((order) => {
        const visibleItems: Array<{ displayItem: string; originalIndex: number }> = [];

        order.items.forEach((itemStr, idx) => {
          const cleanItem = stripOrderMeta(itemStr);
          if (cleanItem.includes('KELLNER') || cleanItem.includes('RECHNUNG ANGEFORDERT')) return;

          const { quantity, label } = parseOrderItemString(itemStr);
          const normalizedName = normalizeItemName(label);
          let visibleQty = quantity;

          if (remainingBlockedItems[normalizedName] > 0) {
            const deduct = Math.min(visibleQty, remainingBlockedItems[normalizedName]);
            visibleQty -= deduct;
            remainingBlockedItems[normalizedName] -= deduct;
          }

          if (visibleQty <= 0) return;

          const hasExplicitQuantity = /^(\d+)\s*x\s+/i.test(cleanItem);
          visibleItems.push({
            displayItem: hasExplicitQuantity ? `${visibleQty}x ${label}` : label,
            originalIndex: idx,
          });
        });

        visibleItemsByOrder[order.id] = visibleItems;
      });

    return visibleItemsByOrder;
  };

  const calculateTrueOpenTotal = () => {
    const visibleItemsByOrder = getVisibleOpenItemsByOrder();
    const remainingPositionsValue = Object.values(visibleItemsByOrder).reduce(
      (sum, items) => sum + items.reduce((itemSum, item) => itemSum + getOrderItemTotal(item.displayItem), 0),
      0
    );

    const currentSplitRequestsValue = tableOrders
      .filter(o => o.status === 'pay_split')
      .reduce((sum, order) => sum + (order.total_price || calculateOrderValue(order.items)), 0);

    return remainingPositionsValue + currentSplitRequestsValue;
  };

  const getPrepVisualForOrderItem = (order: OrderDetail, item: string) => {
    const expectedTypes = Array.from(getExpectedCourseTypesForItems([item]));
    const foodTypes: CourseType[] = ['starter', 'main', 'dessert'];
    const expectedFoodTypes = expectedTypes.filter((type) => foodTypes.includes(type));
    const hasDrinkExpected = expectedTypes.includes('drink');

    const foodStates = expectedFoodTypes
      .map((courseType) => kitchenCourseStatus[`${order.id}_${courseType}`])
      .filter((status): status is CourseStatus => Boolean(status));
    const drinkState = hasDrinkExpected ? kitchenCourseStatus[`${order.id}_drink`] : undefined;
    const allKnownStates = [...foodStates, ...(drinkState ? [drinkState] : [])];

    if (allKnownStates.length === 0) {
      return {
        kind: 'new',
        label: 'Bestellt',
        className: 'bg-blue-100 text-blue-600',
        itemClassName: 'bg-slate-50 hover:bg-red-50',
      };
    }

    const hasFoodReady = foodStates.some((status) => status === 'ready');
    const hasDrinkReady = drinkState === 'ready';
    const hasFoodPicked = expectedFoodTypes.length > 0 && expectedFoodTypes.every((courseType) => kitchenCourseStatus[`${order.id}_${courseType}`] === 'abgeholt');
    const hasDrinkPicked = hasDrinkExpected && drinkState === 'abgeholt';
    const allPickedUp = expectedTypes.length > 0 && expectedTypes.every((courseType) => kitchenCourseStatus[`${order.id}_${courseType}`] === 'abgeholt');
    const hasCooking = allKnownStates.some((status) => status === 'cooking');
    const hasPickedPartial = (hasFoodPicked || hasDrinkPicked) && !allPickedUp;

    if (allPickedUp) {
      return {
        kind: 'picked_both',
        label: hasDrinkExpected && expectedFoodTypes.length > 0 ? 'Essen und Trinken abgeholt' : hasDrinkExpected ? 'Getränk abgeholt' : 'Essen abgeholt',
        className: 'border border-slate-200 bg-slate-50 text-slate-400',
        itemClassName: 'border border-dashed border-slate-200 bg-slate-50',
      };
    }

    if (hasFoodReady || hasDrinkReady) {
      return {
        kind: hasFoodReady && hasDrinkReady ? 'ready_both' : hasDrinkReady ? 'ready_drink' : 'ready_food',
        label: hasFoodReady && hasDrinkReady ? 'Essen und Trinken bereit' : hasDrinkReady ? 'Getränk bereit' : 'Essen bereit',
        className: 'bg-emerald-100 text-emerald-700',
        itemClassName: 'bg-emerald-50 ring-1 ring-emerald-200',
      };
    }

    if (hasCooking) {
      return {
        kind: 'cooking',
        label: 'In Zubereitung',
        className: 'bg-orange-100 text-orange-700',
        itemClassName: 'bg-orange-50 ring-1 ring-orange-200',
      };
    }

    if (hasPickedPartial) {
      return {
        kind: 'picked_partial',
        label: 'Teilweise abgeholt',
        className: 'bg-amber-50 text-amber-700 border border-amber-200',
        itemClassName: 'bg-amber-50 ring-1 ring-amber-200',
      };
    }

    return {
      kind: 'new',
      label: 'Bestellt',
      className: 'bg-blue-100 text-blue-600',
      itemClassName: 'bg-slate-50 hover:bg-red-50',
    };
  };

  const getSplitOrderStatusMap = () => {
    const sourceStatePool: Record<string, Array<ReturnType<typeof getPrepVisualForOrderItem>>> = {};

    tableOrders
      .filter((order) => order.status !== 'pay_split' && order.status !== 'paid')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .forEach((order) => {
        order.items.forEach((itemStr) => {
          const cleanItem = stripOrderMeta(itemStr);
          if (cleanItem.includes('KELLNER') || cleanItem.includes('RECHNUNG ANGEFORDERT')) return;

          const { quantity, label } = parseOrderItemString(itemStr);
          const normalizedKey = normalizeItemName(label);
          const prepVisual = getPrepVisualForOrderItem(order, itemStr);

          if (!sourceStatePool[normalizedKey]) sourceStatePool[normalizedKey] = [];

          for (let i = 0; i < quantity; i++) {
            sourceStatePool[normalizedKey].push(prepVisual);
          }
        });
      });

    const buildPrepVisual = (visuals: Array<ReturnType<typeof getPrepVisualForOrderItem>>) => {
      const kinds = visuals.map((visual) => visual.kind);
      const allPickedUp = kinds.length > 0 && kinds.every((kind) => kind === 'picked_both');
      if (allPickedUp) {
        return {
          label: 'Abgeholt',
          className: 'border border-slate-200 bg-slate-50 text-slate-400',
          itemClassName: 'border border-dashed border-slate-200 bg-slate-50',
        };
      }
      const readyVisual = visuals.find((visual) => String(visual.kind).startsWith('ready_'));
      if (readyVisual) return readyVisual;

      const cookingVisual = visuals.find((visual) => visual.kind === 'cooking');
      if (cookingVisual) return cookingVisual;

      const pickedPartialVisual = visuals.find((visual) => visual.kind === 'picked_partial');
      if (pickedPartialVisual) return pickedPartialVisual;

      return {
        label: 'Bestellt',
        className: 'bg-blue-100 text-blue-600',
        itemClassName: 'bg-slate-50 hover:bg-red-50',
      };
    };

    const statusMap: Record<number, { label: string; className: string; itemStates: Record<number, { label: string; className: string; itemClassName: string }> }> = {};

    tableOrders
      .filter((order) => order.status === 'pay_split')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .forEach((order) => {
        const assignedStates: Array<ReturnType<typeof getPrepVisualForOrderItem>> = [];
        const itemStates: Record<number, { label: string; className: string; itemClassName: string }> = {};

        order.items.forEach((itemStr, itemIndex) => {
          const { quantity, label } = parseOrderItemString(itemStr);
          const normalizedKey = normalizeItemName(label);
          const itemAssignedStates: Array<ReturnType<typeof getPrepVisualForOrderItem>> = [];

          for (let i = 0; i < quantity; i++) {
            const nextState = sourceStatePool[normalizedKey]?.shift();
            const safeState = nextState || {
              kind: 'new',
              label: 'Bestellt',
              className: 'bg-blue-100 text-blue-600',
              itemClassName: 'bg-slate-50 hover:bg-red-50',
            };
            assignedStates.push(safeState);
            itemAssignedStates.push(safeState);
          }

          itemStates[itemIndex] = buildPrepVisual(itemAssignedStates);
        });

        statusMap[order.id] = {
          ...buildPrepVisual(assignedStates),
          itemStates,
        };
      });

    return statusMap;
  };

  const splitOrderStatusMap = getSplitOrderStatusMap();

  if (!restaurantId) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Fehler: Restaurant-ID nicht gefunden</div>;
  }

  return (
    <div className={`min-h-screen font-sans overflow-hidden relative transition-colors duration-500 
      ${isEditing ? 'bg-app-card' : 'bg-app-bg'} text-app-text`}>
      
      <style jsx global>{`
        @keyframes dropIn {
          0% { transform: translateY(-100px) scale(0.5); opacity: 0; }
          60% { transform: translateY(10px) scale(1.05); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        .animate-drop { animation: dropIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        
        /* Mobile Viewport Optimierungen für Tisch-Layout */
        @media (max-width: 640px) {
          .table-layout-wrapper {
            transform: scale(0.45);
            transform-origin: top left;
          }
        }
        @media (min-width: 641px) and (max-width: 768px) {
          .table-layout-wrapper {
            transform: scale(0.55);
            transform-origin: top left;
          }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .table-layout-wrapper {
            transform: scale(0.75);
            transform-origin: top left;
          }
        }
        @media (min-width: 1025px) {
          .table-layout-wrapper {
            transform: scale(1);
            transform-origin: top left;
          }
        }

        .waiter-scroll-area,
        .waiter-level-tabs {
          -webkit-overflow-scrolling: touch;
        }

        .waiter-scroll-area {
          overscroll-behavior-y: contain;
        }

        .waiter-scroll-area-hall {
          touch-action: pan-x pan-y;
          overscroll-behavior: contain;
        }

        .waiter-scroll-area-list {
          touch-action: pan-y;
        }
      `}</style>

      {/* HEADER & CONTROLS */}
      <div className="fixed top-0 left-0 w-full bg-app-bg/90 backdrop-blur-md z-40 border-b border-app-muted/20 shadow-lg flex flex-col">
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">{currentLevel}</h1>
            <div className="flex flex-wrap items-center gap-2">
            <div className={`${topControlClass} hidden border border-app-muted/20 bg-app-card text-app-muted md:flex`}>
                <span>Tische:</span>
                <span className="text-app-text">{tables.length}</span>
                <span>erstellt / {tableLimitText}</span>
            </div>
            <a href={restaurantHomeHref} className={`${topControlClass} bg-app-card text-app-text hover:bg-app-muted/20`}>Home</a>
            <a href={reservationsOverviewHref} className={`${topControlClass} bg-app-card text-app-text hover:bg-app-muted/20`}>Reservierungen</a>
            {isEditing && (
                <button
                  onClick={() => setShowNewTableModal(true)}
                  disabled={tables.length >= features.tableLimit}
                  className={`${topControlClass} hidden bg-green-600 text-white hover:bg-green-500 disabled:bg-app-muted/30 disabled:text-app-muted disabled:cursor-not-allowed animate-in fade-in md:flex`}
                >
                Neuer Tisch
                </button>
            )}
            <button onClick={() => setIsEditing(!isEditing)} className={`${topControlClass} hidden md:flex ${isEditing ? "bg-app-accent text-white" : "bg-app-card text-app-text"}`}>
                {isEditing ? "Fertig" : "Layout / Tische erstellen"}
            </button>
            </div>
        </div>

        <div className="px-4 pb-2">
          <div className="inline-flex bg-app-card/70 rounded-xl p-1 border border-app-muted/30">
            <button
              onClick={() => setViewMode('list')}
              className={`h-8 w-20 rounded-lg text-xs font-bold transition-colors md:h-9 md:w-24 md:text-sm ${viewMode === 'list' ? 'bg-app-primary text-white' : 'text-app-muted hover:text-app-text'}`}
            >
              Liste
            </button>
            <button
              onClick={() => setViewMode('hall')}
              className={`h-8 w-20 rounded-lg text-xs font-bold transition-colors md:h-9 md:w-24 md:text-sm ${viewMode === 'hall' ? 'bg-app-primary text-white' : 'text-app-muted hover:text-app-text'}`}
            >
              Saal
            </button>
          </div>
        </div>

        <div className="waiter-level-tabs flex px-4 gap-1 overflow-x-auto border-b border-app-muted/20">
            {levels.map(lvl => {
                const status = getLevelStatus(lvl);
                let tabClass = "px-6 py-3 text-sm font-bold rounded-t-xl transition-all flex items-center gap-2 relative ";
                
                if (currentLevel === lvl) {
                    // Aktiver Tab
                    if (status === 'call' || status === 'both') {
                        tabClass += "bg-red-600 text-white animate-pulse shadow-lg shadow-red-600/50 ";
                    } else if (status === 'ready') {
                        tabClass += "bg-green-600 text-white animate-pulse shadow-lg shadow-green-600/50 ";
                    } else {
                        tabClass += "bg-blue-600 text-white shadow-lg shadow-blue-600/50 ";
                    }
                } else {
                    // Inaktiver Tab
                    if (status === 'call') {
                        tabClass += "bg-red-500/40 border-b-2 border-red-500 text-red-200 animate-pulse hover:bg-red-500/60 ";
                    } else if (status === 'ready') {
                        tabClass += "bg-green-500/40 border-b-2 border-green-500 text-green-200 animate-pulse hover:bg-green-500/60 ";
                    } else if (status === 'both') {
                        tabClass += "bg-gradient-to-r from-red-500/40 to-green-500/40 border-b-2 border-yellow-500 text-white animate-pulse hover:from-red-500/60 hover:to-green-500/60 ";
                    } else {
                        tabClass += "bg-app-card/30 border-b-2 border-app-muted/50 text-app-muted hover:bg-app-card/50 hover:text-app-text ";
                    }
                }
                
                return (
                    <div key={lvl} className="relative flex items-center">
                      <button onClick={() => setCurrentLevel(lvl)} className={tabClass}>
                          {lvl}
                      </button>
                      {isEditing && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            renameLevel(lvl);
                          }}
                          className="ml-1 h-9 w-9 rounded-t-lg bg-app-card/60 text-xs font-black text-app-muted transition-colors hover:bg-app-card hover:text-app-text"
                          aria-label={`Ebene ${lvl} umbenennen`}
                          title="Ebene umbenennen"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                )
            })}
            {isEditing && (
                <button onClick={addNewLevel} className="px-3 py-2 text-sm font-bold text-app-accent hover:text-app-primary hover:bg-app-card/50 rounded-t-lg transition-colors">
                    + Ebene
                </button>
            )}
        </div>
      </div>

      {isEditing && (
          <div className="absolute inset-0 z-0 pointer-events-none opacity-20" 
               style={{ 
                   backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', 
                   backgroundSize: '40px 40px'
               }}>
          </div>
      )}

      {/* TISCHE BEREICH */}
      {viewMode === 'hall' ? (
        <div className="waiter-scroll-area waiter-scroll-area-hall w-full mt-56 h-[calc(100dvh-14rem)] px-2 pb-2 pt-7 md:mt-36 md:h-[calc(100dvh-9rem)] md:px-4 md:pb-4 md:pt-6 overflow-auto bg-app-bg">
          <div className="relative min-w-[1600px] min-h-[1200px] pb-24 table-layout-wrapper origin-top-left bg-app-bg"
               style={{ 
                 width: '1600px',
                 height: '1200px'
               }}>
          {visibleTables.map((table) => {
            const { isOccupied, circleBg, circleBorder, statusText, animationClass } = getTableVisualStatus(table.label);

            return (
              <div 
                key={table.id} 
                style={{ position: 'absolute', left: table.x, top: table.y, touchAction: isEditing ? 'none' : 'auto' }} 
                className={`flex flex-col items-center z-10 ${isEditing ? 'cursor-move' : 'animate-drop'}`} 
                onPointerDown={(e) => handlePointerDown(e, table)}
              >
                  <div 
                    role={!isEditing ? 'button' : undefined}
                    tabIndex={!isEditing ? 0 : undefined}
                    onClick={!isEditing ? () => handleOpenDetails(null, table.label) : undefined}
                    onKeyDown={!isEditing ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void handleOpenDetails(null, table.label);
                      }
                    } : undefined}
                    style={{ background: circleBg, borderColor: circleBorder }} 
                    className={`${getShapeStyle(table.shape || 'round')} flex flex-col justify-center items-center shadow-2xl border-4 select-none relative group ${isEditing ? 'transition-none ring-4 ring-yellow-500/50 scale-95 opacity-90' : 'transition-transform cursor-pointer active:scale-95 hover:scale-105'} ${animationClass} ${isOccupied ? 'ring-4 ring-green-400' : ''}`}
                  >
                    <div className="text-3xl font-black drop-shadow-lg px-2 text-center break-words max-w-full text-white" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.6)' }}>{table.label}</div>
                    {statusText && <div className="mt-1 text-sm font-bold bg-black/40 px-2 rounded backdrop-blur-sm text-white">{statusText}</div>}
                    {isEditing && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTable(e, table.id, table.label);
                        }}
                        className="absolute -top-2 -right-2 bg-red-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold shadow-md hover:scale-110 transition-transform z-20 border-2 border-app-bg"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {!isEditing && (
                      <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetails(e, table.label);
                          }}
                          className="mt-3 bg-app-card text-app-text border border-app-muted/30 font-bold px-4 py-1.5 rounded-full text-sm shadow-lg hover:bg-app-primary hover:border-app-primary hover:text-white transition-colors flex items-center gap-2 active:scale-95"
                      >
                          Details
                      </button>
                  )}
              </div>
            );
          })}
          </div>
        </div>
      ) : (
        <div className="waiter-scroll-area waiter-scroll-area-list w-full mt-56 h-[calc(100dvh-14rem)] p-3 pt-5 md:mt-36 md:h-[calc(100dvh-9rem)] md:p-4 overflow-auto bg-app-bg overscroll-y-contain">
          <div className="max-w-5xl mx-auto pt-3 md:pt-4 space-y-2 md:space-y-3 pb-24">
            {visibleTables
              .slice()
              .sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }))
              .map((table) => {
                const { isCalling, isBillCalling, isFoodReady, isDrinkReady, isOccupied, animationClass } = getTableVisualStatus(table.label);
                const cardHighlightClass = (() => {
                  if (isCalling && isFoodReady && isDrinkReady) {
                    return 'border-red-500 ring-2 ring-red-500/40 bg-gradient-to-r from-red-50 via-green-50 to-sky-50 shadow-lg shadow-red-200/40';
                  }
                  if (isCalling) {
                    return 'border-red-500 ring-2 ring-red-500/40 bg-red-50 shadow-lg shadow-red-200/40';
                  }
                  if (isFoodReady && isDrinkReady) {
                    return 'border-sky-300 ring-2 ring-sky-200/70 bg-gradient-to-r from-green-50 to-sky-50 shadow-lg shadow-sky-200/40';
                  }
                  if (isFoodReady) {
                    return 'border-green-400 ring-2 ring-green-200/70 bg-green-50 shadow-lg shadow-green-200/40';
                  }
                  if (isDrinkReady) {
                    return 'border-sky-400 ring-2 ring-sky-200/70 bg-sky-50 shadow-lg shadow-sky-200/40';
                  }
                  if (isOccupied) {
                    return 'border-green-500/60';
                  }
                  return 'border-app-muted/30';
                })();
                return (
                  <div
                    key={table.id}
                    role={!isEditing ? 'button' : undefined}
                    tabIndex={!isEditing ? 0 : undefined}
                    onClick={!isEditing ? () => handleOpenDetails(null, table.label) : undefined}
                    onKeyDown={!isEditing ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void handleOpenDetails(null, table.label);
                      }
                    } : undefined}
                    className={`bg-app-card border rounded-xl p-3 md:p-4 shadow-sm transition-all ${!isEditing ? 'cursor-pointer' : ''} ${cardHighlightClass} ${animationClass}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-lg md:text-xl font-black text-app-text">Tisch {table.label}</div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {isCalling && <span className="text-[10px] md:text-xs font-bold bg-red-500/20 text-red-400 px-2 py-1 rounded-full">Ruf</span>}
                        {isBillCalling && <span className="text-[10px] md:text-xs font-bold bg-red-500/20 text-red-400 px-2 py-1 rounded-full">Rechnung</span>}
                        {isFoodReady && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markReadyAsPickedUp(table.label);
                            }}
                            className="text-[10px] md:text-xs font-bold bg-green-500/20 text-green-400 px-2 py-1 rounded-full hover:bg-green-500/30"
                            title="Auf Abgeholt setzen"
                          >
                            Essen bereit
                          </button>
                        )}
                        {isDrinkReady && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markReadyAsPickedUp(table.label);
                            }}
                            className="text-[10px] md:text-xs font-bold bg-sky-500/20 text-sky-400 px-2 py-1 rounded-full hover:bg-sky-500/30"
                            title="Auf Abgeholt setzen"
                          >
                            Getränk bereit
                          </button>
                        )}
                        {isOccupied && <span className="text-[10px] md:text-xs font-bold bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full">Offen</span>}
                        {!isCalling && !isFoodReady && !isDrinkReady && !isOccupied && <span className="text-[10px] md:text-xs font-bold bg-slate-500/20 text-slate-400 px-2 py-1 rounded-full">Frei</span>}
                      </div>
                    </div>

                    <div className="mt-3 flex gap-2">
                      {!isEditing ? (
                        <div className="w-full h-10 md:h-[42px]" aria-hidden="true" />
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTable(null, table.id, table.label);
                          }}
                          className="w-full bg-red-600 hover:bg-red-500 text-white font-bold px-3 py-2 rounded-lg text-sm"
                        >
                          Tisch löschen
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* MODALS */}
      {showNewTableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
           <div className="bg-app-card text-app-text p-6 rounded-2xl shadow-2xl max-w-sm w-full border border-app-muted/20">
              <h3 className="text-xl font-bold mb-1">Neuer Tisch</h3>
              <p className="text-slate-400 text-sm mb-4">Ebene: <span className="text-blue-400 font-bold">{currentLevel}</span></p>
              
              {/* UPDATE: GRID MIT KAPAZITÄT FELD */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                 <div>
                    <label className="text-xs text-slate-400 uppercase font-bold mb-1 block">Name / Nr.</label>
                    <input autoFocus type="text" value={newTableName} onChange={(e) => setNewTableName(e.target.value)} placeholder="z.B. 12" className="w-full bg-app-bg border border-app-muted/30 rounded-lg p-3 text-lg font-bold text-app-text focus:ring-2 focus:ring-app-primary outline-none" />
                 </div>
                 <div>
                    <label className="text-xs text-slate-400 uppercase font-bold mb-1 block">Plätze</label>
                    <input type="number" min="1" value={newTableSeats} onChange={(e) => setNewTableSeats(parseInt(e.target.value) || 0)} className="w-full bg-app-bg border border-app-muted/30 rounded-lg p-3 text-lg font-bold text-app-text focus:ring-2 focus:ring-app-primary outline-none" />
                 </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                 <button onClick={() => createTable('round')} className="aspect-square bg-slate-700 hover:bg-green-600 rounded-xl flex flex-col items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 border border-slate-600 hover:border-green-400 group"><div className="w-8 h-8 rounded-full bg-slate-400 group-hover:bg-white transition-colors"></div><span className="text-xs font-bold">Rund</span></button>
                 <button onClick={() => createTable('square')} className="aspect-square bg-slate-700 hover:bg-green-600 rounded-xl flex flex-col items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 border border-slate-600 hover:border-green-400 group"><div className="w-8 h-8 rounded-md bg-slate-400 group-hover:bg-white transition-colors"></div><span className="text-xs font-bold">Eckig</span></button>
                 <button onClick={() => createTable('rect')} className="aspect-square bg-slate-700 hover:bg-green-600 rounded-xl flex flex-col items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 border border-slate-600 hover:border-green-400 group"><div className="w-10 h-6 rounded-md bg-slate-400 group-hover:bg-white transition-colors"></div><span className="text-xs font-bold">Lang</span></button>
              </div>
              <button onClick={() => setShowNewTableModal(false)} className="mt-6 w-full py-2 text-slate-400 font-bold hover:text-white">Abbrechen</button>
           </div>
        </div>
      )}
      {selectedTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-1 md:p-2 animate-in fade-in duration-200" onClick={() => setSelectedTable(null)}>
          <div className="bg-app-card text-app-text w-[99vw] md:w-[98vw] max-w-none rounded-xl md:rounded-2xl shadow-2xl flex flex-col h-[96dvh] md:h-[94dvh] overflow-hidden border border-app-muted/20" onClick={e => e.stopPropagation()}>
            <div className="bg-app-bg p-2 md:p-4 border-b border-app-muted/20 flex flex-col gap-1 md:gap-2 shrink-0">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 md:gap-4"><h2 className="text-lg md:text-3xl font-black text-app-text">Tisch {selectedTable}</h2><button onClick={openGuestView} className="text-[10px] md:text-xs font-bold text-white bg-app-primary px-2 md:px-3 py-0.5 md:py-1 rounded-full hover:brightness-110 transition-colors">Bestellungen aufnehmen ↗</button></div>
                  <button onClick={() => setSelectedTable(null)} className="bg-app-card hover:bg-app-muted/20 border border-app-muted/30 rounded-full p-1.5 md:p-2 w-8 h-8 md:w-10 md:h-10 font-bold text-sm md:text-base text-app-text">✕</button>
                </div>
                {tableToken && (
                  <div className="hidden md:block text-sm text-app-muted space-y-1">
                    <div>
                      QR‑Scan‑Link:&nbsp;
                      <code className="bg-app-card border border-app-muted/20 px-1 py-0.5 rounded break-all text-app-text">/{restaurantId}/qr/{selectedTable}?qr=...</code>
                      &nbsp;(<button onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/${encodeURIComponent(restaurantId)}/qr/${encodeURIComponent(selectedTable)}?qr=${encodeURIComponent(tableToken)}`);
                      }} className="underline">kopieren</button>)
                    </div>
                    <div>
                      Aktueller QR‑Prüflink:&nbsp;
                      <code className="bg-app-card border border-app-muted/20 px-1 py-0.5 rounded break-all text-app-text">/{restaurantId}/qr/{selectedTable}?qr=...</code>
                      &nbsp;(<button onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/${encodeURIComponent(restaurantId)}/qr/${encodeURIComponent(selectedTable)}?qr=${encodeURIComponent(tableToken)}`);
                      }} className="underline">kopieren</button>)
                    </div>
                    {adminToken && (
                      <div>
                        Admin‑Zugriff:&nbsp;
                        <code className="bg-app-card border border-app-muted/20 px-1 py-0.5 rounded break-all text-app-text">/{restaurantId}/table/{selectedTable}?admintoken={adminToken}</code>
                        &nbsp;(<button onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/${encodeURIComponent(restaurantId)}/table/${encodeURIComponent(selectedTable)}?admintoken=${adminToken}`);
                        }} className="underline">kopieren</button>)
                      </div>
                    )}
                  </div>
                )}
            </div>
            <div className="flex border-b border-app-muted/20 bg-app-bg/70">
                <button onClick={() => setActiveTab('bill')} className={`flex-1 py-2 md:py-3 text-xs md:text-sm font-bold uppercase transition-colors ${activeTab === 'bill' ? 'text-app-primary border-b-2 border-app-primary bg-app-card' : 'text-app-muted hover:text-app-text'}`}>Kasse</button>
                {features.reservationsEnabled && (
                  <button onClick={() => setActiveTab('reservations')} className={`flex-1 py-2 md:py-3 text-xs md:text-sm font-bold uppercase transition-colors ${activeTab === 'reservations' ? 'text-app-primary border-b-2 border-app-primary bg-app-card' : 'text-app-muted hover:text-app-text'}`}>Res.</button>
                )}
                <button onClick={() => setActiveTab('stats')} className={`flex-1 py-2 md:py-3 text-xs md:text-sm font-bold uppercase transition-colors ${activeTab === 'stats' ? 'text-app-primary border-b-2 border-app-primary bg-app-card' : 'text-app-muted hover:text-app-text'}`}>Stats</button>
            </div>
            <div className="p-2 md:p-6 overflow-y-auto grow custom-scrollbar bg-app-card min-h-[300px]">
                {isLoadingData ? <div className="text-center py-10 text-app-muted">Lade Daten...</div> : (
                    <>
                        {activeTab === 'bill' && (
                            <div className="flex flex-col h-full">
                                <div className="grow space-y-4 mb-4">
                                    {(() => {
                                        const billRequests = tableOrders.filter(o => o.status === 'pay_split');
                                        if (billRequests.length > 0) {
                                            return (
                                                <div className="bg-app-primary/10 border border-app-primary/20 rounded-xl overflow-hidden mb-4 md:mb-6">
                                                  <div className="bg-app-primary/15 px-2 md:px-4 py-1.5 md:py-2 border-b border-app-primary/20 text-xs md:text-sm font-bold text-app-primary flex justify-between items-center">
                                                        <span>RECHNUNGEN</span>
                                                    <span className="text-[10px] md:text-xs bg-app-card text-app-text px-1.5 md:px-2 py-0.5 rounded-full border border-app-muted/20">{billRequests.length}</span>
                                                    </div>
                                                    <div className="p-1.5 md:p-2 space-y-1.5 md:space-y-2">
                                                        {billRequests.map(order => {
                                                          const requestTotal = order.total_price || calculateOrderValue(order.items);
                                                            const splitStatus = splitOrderStatusMap[order.id] || { label: 'Bestellt', className: 'bg-blue-100 text-blue-600' };
                                                            return (
                                                                <div key={order.id} className="bg-app-card p-2 md:p-3 rounded-lg shadow-sm border border-app-muted/20">
                                                                    <div className="flex justify-between items-start mb-1.5 md:mb-2">
                                                                        <div className="space-y-1">
                                                                          <div className="text-xs md:text-sm font-bold text-app-text">TR #{order.id}</div>
                                                                          <div className={`inline-flex text-[10px] md:text-xs font-bold uppercase px-2 md:px-3 py-1 md:py-1.5 rounded-full tracking-wide shadow-sm whitespace-nowrap ${splitStatus.className}`}>
                                                                            {splitStatus.label}
                                                                          </div>
                                                                        </div>
                                                                        <div className="font-black text-sm md:text-lg text-app-primary">{requestTotal.toFixed(2)} €</div>
                                                                    </div>
                                                                      <ul className="text-xs md:text-sm text-app-text space-y-0.5 md:space-y-1">
                                                                        {order.items.map((it, idx) => {
                                                                            // Format: "Qty x Name - Description (Notiz: Hinweis)"
                                                                            const { cleanItem, quantity, label } = parseOrderItemString(it);
                                                                            let qty = "";
                                                                            let name = label;
                                                                            let note = "";
                                                                            let desc = "";
                                                                            const priceSourceName = label;
                                                                            qty = quantity > 1 ? String(quantity) : "";
                                                                            const qtyNumber = quantity;
                                                                            
                                                                            // Parse note if present
                                                                            const parsedNote = splitItemNote(name);
                                                                            name = parsedNote.label;
                                                                            note = parsedNote.note;
                                                                            
                                                                            // Beschreibung nur auf Wunsch anzeigen
                                                                            const descSeparator = name.includes(" - ") ? " - " : (name.includes(" – ") ? " – " : null);
                                                                            if (descSeparator) {
                                                                              const descParts = name.split(descSeparator);
                                                                              name = descParts[0].trim();
                                                                              desc = descParts.slice(1).join(descSeparator).trim();
                                                                            }

                                                                            if (!desc) {
                                                                              const lookup = descriptionMap[normalizeKey(name)];
                                                                              if (lookup) desc = lookup;
                                                                            }

                                                                            const descKey = `${order.id}-${idx}`;
                                                                            const isDescOpen = expandedBillDescriptions.has(descKey);
                                                                            const allergens = getAllergensForItemName(name);
                                                                            const allergenKey = `${order.id}-${idx}-allergens`;
                                                                            const isAllergenOpen = expandedBillAllergens.has(allergenKey);
                                                                            const unitPrice = getUnitPriceForItemName(priceSourceName);
                                                                            const itemTotal = unitPrice * qtyNumber;
                                                                            const splitItemStatus = splitStatus.itemStates?.[idx] || { label: 'Bestellt', className: 'bg-blue-100 text-blue-600', itemClassName: 'bg-slate-50 hover:bg-red-50' };
                                                                            const isSplitItemReady = splitItemStatus.label.toLowerCase().includes('bereit');
                                                                            
                                                                            return (
                                                                              <li
                                                                                key={idx}
                                                                                role={isSplitItemReady && selectedTable ? 'button' : undefined}
                                                                                tabIndex={isSplitItemReady && selectedTable ? 0 : undefined}
                                                                                onClick={isSplitItemReady && selectedTable ? () => markReadyAsPickedUp(selectedTable) : undefined}
                                                                                onKeyDown={isSplitItemReady && selectedTable ? (e) => {
                                                                                  if (e.key === 'Enter' || e.key === ' ') {
                                                                                    e.preventDefault();
                                                                                    void markReadyAsPickedUp(selectedTable);
                                                                                  }
                                                                                } : undefined}
                                                                                className={`${splitItemStatus.itemClassName} px-1.5 md:px-2 py-1.5 md:py-2 rounded transition-colors ${isSplitItemReady ? 'cursor-pointer hover:bg-emerald-100' : ''}`}
                                                                              >
                                                                                <div className="flex justify-between items-start gap-1.5 md:gap-2">
                                                                                  <div className="flex-1 min-w-0">
                                                                                    <div className="font-semibold text-slate-800 whitespace-normal break-normal">{qty && qty + "x "}{name}</div>
                                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                                      <div className={`text-[10px] md:text-xs font-bold uppercase px-2 py-0.5 rounded-full tracking-wide ${splitItemStatus.className}`}>
                                                                                        {splitItemStatus.label}
                                                                                      </div>
                                                                                      {note && <div className="text-[10px] md:text-xs font-bold text-orange-600 bg-orange-100 px-1 md:px-1.5 rounded inline-block mt-0.5 md:mt-1">Notiz: {note}</div>}
                                                                                        {desc && (
                                                                                        <button
                                                                                          onClick={() => {
                                                                                            setExpandedBillDescriptions(prev => {
                                                                                              const next = new Set(prev);
                                                                                              if (next.has(descKey)) next.delete(descKey); else next.add(descKey);
                                                                                              return next;
                                                                                            });
                                                                                          }}
                                                                                          className="text-[10px] md:text-xs font-bold text-blue-600 bg-blue-100 px-1 md:px-1.5 rounded inline-block mt-0.5 md:mt-1 hover:bg-blue-200"
                                                                                        >
                                                                                          {isDescOpen ? 'Beschreibung ▲' : 'Beschreibung ▼'}
                                                                                        </button>
                                                                                      )}
                                                                                      {allergens.length > 0 && (
                                                                                        <button
                                                                                          onClick={() => {
                                                                                            setExpandedBillAllergens(prev => {
                                                                                              const next = new Set(prev);
                                                                                              if (next.has(allergenKey)) next.delete(allergenKey); else next.add(allergenKey);
                                                                                              return next;
                                                                                            });
                                                                                          }}
                                                                                          className="text-[10px] md:text-xs font-bold text-violet-700 bg-violet-100 px-1 md:px-1.5 rounded inline-block mt-0.5 md:mt-1 hover:bg-violet-200"
                                                                                        >
                                                                                          {isAllergenOpen ? 'Allergene ▲' : 'Allergene ▼'}
                                                                                        </button>
                                                                                      )}
                                                                                    </div>
                                                                                    {isDescOpen && desc && (
                                                                                      <div className="text-[10px] md:text-xs text-slate-600 mt-0.5 whitespace-normal break-normal">{desc}</div>
                                                                                    )}
                                                                                    {isAllergenOpen && allergens.length > 0 && (
                                                                                      <div className="text-[10px] md:text-xs text-slate-600 mt-0.5 whitespace-normal break-normal">
                                                                                        <span className="font-bold text-violet-700">Allergene:</span> {allergens.join(', ')}
                                                                                      </div>
                                                                                    )}
                                                                                  </div>
                                                                                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                                                                    <div className="text-right leading-tight">
                                                                                      <div className="font-bold text-[10px] md:text-xs text-slate-900 whitespace-nowrap">{itemTotal.toFixed(2)}€</div>
                                                                                      {qtyNumber > 1 && (
                                                                                        <div className="text-[9px] md:text-[10px] text-slate-500 whitespace-nowrap">{unitPrice.toFixed(2)}€ / Stk</div>
                                                                                      )}
                                                                                    </div>
                                                                                    <button onClick={(e) => { e.stopPropagation(); cancelOrderItem(order.id, idx, it); }} className="bg-red-500 text-white px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs font-bold hover:bg-red-600">✕</button>
                                                                                  </div>
                                                                                </div>
                                                                              </li>
                                                                            );
                                                                        })}
                                                                    </ul>
                                                                    <button onClick={() => handlePaySpecific(order.id)} className="w-full mt-1.5 md:mt-2 bg-blue-600 text-white px-3 md:px-4 py-1.5 md:py-2 rounded text-[10px] md:text-xs font-bold hover:bg-blue-700 shadow">Kassieren</button>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )
                                        }
                                        return null;
                                    })()}

                                    <div>
                                        <h3 className="text-[10px] md:text-xs font-bold text-app-muted uppercase mb-1.5 md:mb-2 tracking-wide">Offene Positionen</h3>
                                        {(() => {
                                            console.log('tableOrders:', tableOrders);
                                            console.log('tableOrders.length:', tableOrders.length);
                                            const visibleItemsByOrder = getVisibleOpenItemsByOrder();
                                            console.log('visibleItemsByOrder:', visibleItemsByOrder);
                                            
                                            // WICHTIG: Bestellungen in chronologischer Reihenfolge verarbeiten (älteste zuerst)
                                            // damit alte Bestellungen die blockierten Items "verbrauchen" und neue sichtbar bleiben
                                            const ordersToProcess = [...tableOrders]
                                              .filter(o => o.status !== 'pay_split' && o.status !== 'paid')
                                              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

                                            const getDisplayPriority = (status: string) => {
                                              if (status === 'abgeholt') return 1;
                                              return 0;
                                            };
                                            
                                            const regularOrders = ordersToProcess.map(order => {
                                                console.log('Order:', order.id, 'Status:', order.status, 'Items:', order.items);
                                              const visibleItems = visibleItemsByOrder[order.id] || [];
                                                console.log('visibleItems für Order', order.id, ':', visibleItems);
                                                if (visibleItems.length === 0) return null;
                                                const isOrderFullyPickedUp = isOrderFullyPickedUpByCourseStatus(order);
                                                const isOrderPickedUpByStatus = order.status === 'abgeholt';
                                                const visibleCourseTypes = getVisibleCourseTypesForItems(
                                                  order.id,
                                                  visibleItems.map((item) => item.displayItem)
                                                );
                                                const ownReadyCourseTypes = getReadyCourseTypesForOrder(order.id);
                                                const ownPickedUpCourseTypes = Object.entries(kitchenCourseStatus)
                                                  .filter(([key, status]) => key.startsWith(`${order.id}_`) && status === 'abgeholt')
                                                  .map(([key]) => key.split('_')[1] as CourseType);
                                                const hiddenDrinkState: 'none' | 'ready' | 'abgeholt' = (() => {
                                                  if (visibleCourseTypes.has('drink')) return 'none';
                                                  if (ownPickedUpCourseTypes.includes('drink') || hasDrinkPickedShadowForOrder(order)) return 'abgeholt';
                                                  if (ownReadyCourseTypes.includes('drink') || hasDrinkReadyShadowForOrder(order)) return 'ready';
                                                  return 'none';
                                                })();
                                                const sortedVisibleItems = [...visibleItems].sort((a, b) => {
                                                  const aPickedUp = isPickedUpCourseItem(order.id, a.displayItem);
                                                  const bPickedUp = isPickedUpCourseItem(order.id, b.displayItem);
                                                  if (aPickedUp !== bPickedUp) return aPickedUp ? 1 : -1;
                                                  return a.originalIndex - b.originalIndex;
                                                });
                                                const hasVisibleDrinkItem = sortedVisibleItems.some(({ displayItem }) => {
                                                  const itemStation = getOrderItemStation(displayItem);
                                                  return itemStation === 'drink' || getMenuItemType(displayItem) === 'drink';
                                                });
                                                const shadowDrinkReadyCarrierIndex = hiddenDrinkState !== 'none' && !hasVisibleDrinkItem
                                                  ? sortedVisibleItems.findIndex(({ displayItem }) => {
                                                      const normalizedItemName = normalizeItemName(parseOrderItemString(displayItem).label);
                                                      return stripOrderMeta(displayItem).includes('Im Menü enthalten:')
                                                        || normalizedItemName.includes('menu')
                                                        || normalizedItemName.includes('menü');
                                                    })
                                                  : -1;
                                                const readyCourseTypeSet = new Set<CourseType>(
                                                  !isOrderFullyPickedUp
                                                    ? [
                                                        ...ownReadyCourseTypes.filter((courseType) => visibleCourseTypes.has(courseType)),
                                                        ...(hiddenDrinkState === 'ready' ? ['drink' as CourseType] : []),
                                                      ]
                                                    : []
                                                );
                                                const pickedUpCourseTypeSet = new Set<CourseType>(
                                                  [
                                                    ...ownPickedUpCourseTypes.filter((type) => (type === 'starter' || type === 'main' || type === 'dessert' || type === 'drink') && visibleCourseTypes.has(type)),
                                                    ...(hiddenDrinkState === 'abgeholt' ? ['drink' as CourseType] : []),
                                                  ]
                                                );
                                                const hasCourseReadyInfo = readyCourseTypeSet.size > 0;
                                                const readyCourseLabel = hasCourseReadyInfo
                                                  ? getReadyCourseLabelForOrder(order)
                                                  : null;

                                                const hasFoodCourseReady = ['starter', 'main', 'dessert'].some((courseType) =>
                                                  readyCourseTypeSet.has(courseType as CourseType)
                                                );
                                                const hasDrinkCourseReady = readyCourseTypeSet.has('drink');

                                                const effectiveReadyKind: 'food' | 'drink' | 'both' | null =
                                                  hasCourseReadyInfo
                                                    ? (hasFoodCourseReady && hasDrinkCourseReady
                                                      ? 'both'
                                                      : hasDrinkCourseReady
                                                        ? 'drink'
                                                        : hasFoodCourseReady
                                                          ? 'food'
                                                          : null)
                                                    : null;

                                                const normalizedReadyKind = isOrderFullyPickedUp ? null : effectiveReadyKind;
                                                const isDrinkReadyOnlyForDisplay = normalizedReadyKind === 'drink' && drinksTarget === 'bar';
                                                const readyStateLabel = normalizedReadyKind === 'both'
                                                  ? 'Essen & Getränk bereit'
                                                  : normalizedReadyKind === 'drink'
                                                    ? 'Getränk abholbereit'
                                                    : readyCourseLabel || 'Essen bereit';

                                                const hasReadyState = normalizedReadyKind !== null;
                                                const hasCookingFoodCourse = Object.entries(kitchenCourseStatus).some(([key, status]) => {
                                                  if (!key.startsWith(`${order.id}_`) || status !== 'cooking') return false;
                                                  const courseType = key.split('_')[1] as CourseType;
                                                  return (courseType === 'starter' || courseType === 'main' || courseType === 'dessert') && visibleCourseTypes.has(courseType);
                                                });
                                                const statusClass = isOrderFullyPickedUp || isOrderPickedUpByStatus
                                                  ? 'border border-slate-200 bg-slate-50 text-slate-400'
                                                  : 'bg-blue-100 text-blue-600';

                                                const statusLabel = isOrderFullyPickedUp || isOrderPickedUpByStatus
                                                  ? 'Abgeholt'
                                                  : 'Bestellt';
                                                const statusPriority = isOrderFullyPickedUp || isOrderPickedUpByStatus ? 1 : 0;

                                                const itemEntries = sortedVisibleItems.map((itemObj, i) => {
                                                  const item = itemObj.displayItem;
                                                  const itemIndex = itemObj.originalIndex;
                                                  const { quantity: qty, label: rawName } = parseOrderItemString(item);
                                                  const itemName = normalizeItemName(rawName);
                                                  const unitPrice = getUnitPriceForItemName(rawName);
                                                  const price = unitPrice * qty;

                                                  let displayName = rawName;
                                                  let desc = "";
                                                  let note = "";

                                                  const parsedNote = splitItemNote(displayName);
                                                  displayName = parsedNote.label;
                                                  note = parsedNote.note;

                                                  const descSeparator = displayName.includes(" - ") ? " - " : (displayName.includes(" – ") ? " – " : null);
                                                  if (descSeparator) {
                                                    const descParts = displayName.split(descSeparator);
                                                    displayName = descParts[0].trim();
                                                    desc = descParts.slice(1).join(descSeparator).trim();
                                                  }

                                                  if (!desc) {
                                                    const lookup = descriptionMap[normalizeKey(displayName)];
                                                    if (lookup) desc = lookup;
                                                  }

                                                  const qtyLabel = qty > 1 ? `${qty}x ` : "";
                                                  const descKey = `open-${order.id}-${itemIndex}`;
                                                  const isDescOpen = expandedBillDescriptions.has(descKey);
                                                  const allergens = getAllergensForItemName(displayName);
                                                  const allergenKey = `open-${order.id}-${itemIndex}-allergens`;
                                                  const isAllergenOpen = expandedBillAllergens.has(allergenKey);
                                                  const isMenuLikeItem =
                                                    stripOrderMeta(item).includes('Im Menü enthalten:')
                                                    || itemName.includes('menu')
                                                    || itemName.includes('menü');
                                                  const itemStation = getOrderItemStation(item);
                                                  const isDirectDrinkItem = getMenuItemType(item) === 'drink' || itemStation === 'drink';
                                                  const isShadowDrinkCarrier = shadowDrinkReadyCarrierIndex === i;
                                                  const resolvedCourseType = resolveCourseTypeForOrderItem(order.id, item);
                                                  const foodCourseTypes: CourseType[] = ['starter', 'main', 'dessert'];
                                                  const itemReadyKind: 'food' | 'drink' | 'both' | null = hasReadyState ? (() => {
                                                    if (hasCourseReadyInfo) {
                                                      const hasDrinkReady = readyCourseTypeSet.has('drink')
                                                        && (isDirectDrinkItem || isMenuLikeItem);
                                                      const hasFoodReady = foodCourseTypes.some((courseType) =>
                                                        readyCourseTypeSet.has(courseType)
                                                        && (resolvedCourseType === courseType || itemMatchesCourseType(item, courseType))
                                                      );

                                                      if (hasFoodReady && hasDrinkReady) return 'both';
                                                      if (hasDrinkReady) return 'drink';
                                                      if (hasFoodReady) return 'food';
                                                      return null;
                                                    }

                                                    const hasDrinkReady = (normalizedReadyKind === 'drink' || normalizedReadyKind === 'both')
                                                      && (isDirectDrinkItem || isMenuLikeItem);
                                                    const hasFoodReady = normalizedReadyKind === 'food'
                                                      ? (isMenuLikeItem || !isDirectDrinkItem)
                                                      : normalizedReadyKind === 'both'
                                                        ? isMenuLikeItem
                                                        : false;

                                                    if (hasFoodReady && hasDrinkReady) return 'both';
                                                    if (hasDrinkReady) return 'drink';
                                                    if (hasFoodReady) return 'food';
                                                    return null;
                                                  })() : null;
                                                  const itemPickedKind: 'food' | 'drink' | 'both' | null = (() => {
                                                    const hasDrinkPicked = pickedUpCourseTypeSet.has('drink')
                                                      && (isDirectDrinkItem || isMenuLikeItem);
                                                    const hasFoodPicked = foodCourseTypes.some((courseType) =>
                                                      pickedUpCourseTypeSet.has(courseType)
                                                      && (resolvedCourseType === courseType || itemMatchesCourseType(item, courseType))
                                                    );

                                                    if (hasFoodPicked && hasDrinkPicked) return 'both';
                                                    if (hasDrinkPicked) return 'drink';
                                                    if (hasFoodPicked) return 'food';
                                                    return null;
                                                  })();
                                                  const effectiveItemReadyKind: 'food' | 'drink' | 'both' | null = (() => {
                                                    if (hiddenDrinkState === 'abgeholt' && isShadowDrinkCarrier) return itemReadyKind;
                                                    if (!isShadowDrinkCarrier) return itemReadyKind;
                                                    if (itemReadyKind === 'food') return 'both';
                                                    if (itemReadyKind === null) return 'drink';
                                                    return itemReadyKind;
                                                  })();
                                                  const effectiveItemPickedKind: 'food' | 'drink' | 'both' | null = (() => {
                                                    if (!isShadowDrinkCarrier || hiddenDrinkState !== 'abgeholt') return itemPickedKind;
                                                    if (itemPickedKind === 'food') return 'both';
                                                    if (itemPickedKind === null) return 'drink';
                                                    return itemPickedKind;
                                                  })();
                                                  const readyKindAfterPickedUp: 'food' | 'drink' | 'both' | null = (() => {
                                                    if (!effectiveItemReadyKind || !effectiveItemPickedKind) return effectiveItemReadyKind;
                                                    if (effectiveItemPickedKind === 'both') return null;
                                                    if (effectiveItemReadyKind === effectiveItemPickedKind) return null;
                                                    if (effectiveItemReadyKind === 'both' && effectiveItemPickedKind === 'drink') return 'food';
                                                    if (effectiveItemReadyKind === 'both' && effectiveItemPickedKind === 'food') return 'drink';
                                                    return effectiveItemReadyKind;
                                                  })();
                                                  const isReadyHighlighted = readyKindAfterPickedUp !== null;
                                                  const readyItemLabel = readyKindAfterPickedUp === 'both'
                                                    ? 'Essen und Trinken bereit'
                                                    : readyKindAfterPickedUp === 'drink'
                                                      ? 'Getränk bereit'
                                                      : 'Essen bereit';
                                                  const isFullyPickedUpItem = effectiveItemPickedKind === 'both' || (!isMenuLikeItem && effectiveItemPickedKind !== null);
                                                  const partialPickedUpItemLabel = isMenuLikeItem && effectiveItemPickedKind !== null && effectiveItemPickedKind !== 'both'
                                                    ? effectiveItemPickedKind === 'drink'
                                                      ? 'Getränk abgeholt, Essen offen'
                                                      : 'Essen abgeholt, Getränk offen'
                                                    : null;
                                                  const isPickedUpHighlighted = isFullyPickedUpItem && !isReadyHighlighted;
                                                  const pickedUpItemLabel = effectiveItemPickedKind === 'both'
                                                    ? 'Essen und Trinken abgeholt'
                                                    : effectiveItemPickedKind === 'drink'
                                                      ? 'Getränk abgeholt'
                                                      : 'Essen abgeholt';
                                                  const isLunchMenu = itemName.includes('menü') || itemName.includes('menu');

                                                  return {
                                                    itemIndex,
                                                    isPickedUpHighlighted,
                                                    content: (
                                                      <div
                                                        key={`${order.id}-${itemIndex}-${i}`}
                                                        role={isReadyHighlighted && selectedTable ? 'button' : undefined}
                                                        tabIndex={isReadyHighlighted && selectedTable ? 0 : undefined}
                                                        onClick={isReadyHighlighted && selectedTable ? () => markReadyAsPickedUp(selectedTable) : undefined}
                                                        onKeyDown={isReadyHighlighted && selectedTable ? (e) => {
                                                          if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            void markReadyAsPickedUp(selectedTable);
                                                          }
                                                        } : undefined}
                                                        className={`rounded-md px-2 py-2 transition-colors md:px-3 md:py-2.5 ${isPickedUpHighlighted ? 'border border-dashed border-slate-200 bg-slate-50' : isReadyHighlighted ? 'cursor-pointer bg-emerald-50 ring-1 ring-emerald-200 hover:bg-emerald-100' : 'bg-slate-50 hover:bg-red-50'}`}
                                                      >
                                                        <div className="hidden items-center justify-between gap-3 md:flex">
                                                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                                            <span className={`text-sm truncate ${isPickedUpHighlighted ? 'font-normal text-slate-400' : 'font-medium text-slate-800'}`}>{qtyLabel}{displayName}</span>
                                                            {isPickedUpHighlighted && (
                                                              <span className="text-[10px] border border-slate-200 bg-slate-50 text-slate-400 px-2 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0">
                                                                {pickedUpItemLabel}
                                                              </span>
                                                            )}
                                                            {!isPickedUpHighlighted && !isReadyHighlighted && partialPickedUpItemLabel && (
                                                              <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0 border border-amber-200">
                                                                {partialPickedUpItemLabel}
                                                              </span>
                                                            )}
                                                            {isReadyHighlighted && (
                                                              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0">
                                                                {readyItemLabel}
                                                              </span>
                                                            )}
                                                            {isLunchMenu && (
                                                              <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0">
                                                                Mittagsmenü
                                                              </span>
                                                            )}
                                                            {desc && (
                                                              <button
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  setExpandedBillDescriptions(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(descKey)) next.delete(descKey); else next.add(descKey);
                                                                    return next;
                                                                  });
                                                                }}
                                                                className="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 hover:bg-blue-200"
                                                              >
                                                                {isDescOpen ? 'Beschreibung ▲' : 'Beschreibung ▼'}
                                                              </button>
                                                            )}
                                                            {allergens.length > 0 && (
                                                              <button
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  setExpandedBillAllergens(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(allergenKey)) next.delete(allergenKey); else next.add(allergenKey);
                                                                    return next;
                                                                  });
                                                                }}
                                                                className="text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 hover:bg-violet-200"
                                                              >
                                                                {isAllergenOpen ? 'Allergene ▲' : 'Allergene ▼'}
                                                              </button>
                                                            )}
                                                          </div>
                                                          <div className="flex items-center gap-2 flex-shrink-0">
                                                            <div className="flex flex-col items-end leading-tight">
                                                              <span className={`text-sm whitespace-nowrap ${isPickedUpHighlighted ? 'font-semibold text-slate-400' : 'font-bold text-slate-900'}`}>{price.toFixed(2)}€</span>
                                                              {qty > 1 && (
                                                                <span className="text-[10px] text-slate-500 whitespace-nowrap">{unitPrice.toFixed(2)}€ pro Stück</span>
                                                              )}
                                                            </div>
                                                            <button onClick={(e) => { e.stopPropagation(); openPayQtyPicker(order.id, itemIndex, item); }} className="px-2.5 py-1.5 rounded text-xs font-bold shadow whitespace-nowrap bg-green-600 text-white hover:bg-green-700">✓</button>
                                                            <button onClick={(e) => { e.stopPropagation(); cancelOrderItem(order.id, itemIndex, item); }} className="px-2.5 py-1.5 rounded text-xs font-bold shadow whitespace-nowrap bg-red-600 text-white hover:bg-red-700">✕</button>
                                                          </div>
                                                        </div>
                                                        {isDescOpen && desc && (
                                                          <div className="hidden md:block text-[10px] text-slate-600 mt-2 pl-1">{desc}</div>
                                                        )}
                                                        {isAllergenOpen && allergens.length > 0 && (
                                                          <div className="hidden md:block text-[10px] text-slate-600 mt-2 pl-1">
                                                            <span className="font-bold text-violet-700">Allergene:</span> {allergens.join(', ')}
                                                          </div>
                                                        )}
                                                        {note && (
                                                          <div className="hidden md:inline-block text-[10px] font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded mt-2">Notiz: {note}</div>
                                                        )}
                                                        <div className="space-y-2 md:hidden">
                                                          <div className="flex justify-between items-start gap-2">
                                                            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                                                              <span className={`text-xs whitespace-normal break-normal ${isPickedUpHighlighted ? 'font-normal text-slate-400' : 'font-medium text-slate-800'}`}>{qtyLabel}{displayName}</span>
                                                              {isPickedUpHighlighted && (
                                                                <span className="text-[9px] border border-slate-200 bg-slate-50 text-slate-400 px-1 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0">
                                                                  {pickedUpItemLabel}
                                                                </span>
                                                              )}
                                                              {isReadyHighlighted && (
                                                                <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0">
                                                                  {readyItemLabel}
                                                                </span>
                                                              )}
                                                              {!isPickedUpHighlighted && !isReadyHighlighted && partialPickedUpItemLabel && (
                                                                <span className="text-[9px] bg-amber-50 text-amber-700 px-1 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0 border border-amber-200">
                                                                  {partialPickedUpItemLabel}
                                                                </span>
                                                              )}
                                                              {isLunchMenu && (
                                                                <span className="text-[9px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0">
                                                                  Menü
                                                                </span>
                                                              )}
                                                              {desc && (
                                                                <button
                                                                  onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setExpandedBillDescriptions(prev => {
                                                                      const next = new Set(prev);
                                                                      if (next.has(descKey)) next.delete(descKey); else next.add(descKey);
                                                                      return next;
                                                                    });
                                                                  }}
                                                                  className="text-[9px] font-bold text-blue-600 bg-blue-100 px-1 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                                                                >
                                                                  {isDescOpen ? 'i ▲' : 'i ▼'}
                                                                </button>
                                                              )}
                                                              {allergens.length > 0 && (
                                                                <button
                                                                  onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setExpandedBillAllergens(prev => {
                                                                      const next = new Set(prev);
                                                                      if (next.has(allergenKey)) next.delete(allergenKey); else next.add(allergenKey);
                                                                      return next;
                                                                    });
                                                                  }}
                                                                  className="text-[9px] font-bold text-violet-700 bg-violet-100 px-1 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                                                                >
                                                                  {isAllergenOpen ? 'A ▲' : 'A ▼'}
                                                                </button>
                                                              )}
                                                            </div>
                                                            <div className="flex flex-col items-end leading-tight flex-shrink-0">
                                                              <span className={`text-xs whitespace-nowrap ${isPickedUpHighlighted ? 'font-semibold text-slate-400' : 'font-bold text-slate-900'}`}>{price.toFixed(2)}€</span>
                                                              {qty > 1 && (
                                                                <span className="text-[9px] text-slate-500 whitespace-nowrap">{unitPrice.toFixed(2)}€ pro Stück</span>
                                                              )}
                                                            </div>
                                                          </div>
                                                          {isDescOpen && desc && (
                                                            <div className="text-[9px] text-slate-600 whitespace-normal break-normal">{desc}</div>
                                                          )}
                                                          {isAllergenOpen && allergens.length > 0 && (
                                                            <div className="text-[9px] text-slate-600 whitespace-normal break-normal">
                                                              <span className="font-bold text-violet-700">Allergene:</span> {allergens.join(', ')}
                                                            </div>
                                                          )}
                                                          {note && (
                                                            <div className="text-[9px] font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded inline-block">Notiz: {note}</div>
                                                          )}
                                                          <div className="grid grid-cols-2 gap-2">
                                                            <button onClick={(e) => { e.stopPropagation(); openPayQtyPicker(order.id, itemIndex, item); }} className="py-1.5 rounded text-[10px] font-bold shadow bg-green-600 text-white hover:bg-green-700">Abkassieren</button>
                                                            <button onClick={(e) => { e.stopPropagation(); cancelOrderItem(order.id, itemIndex, item); }} className="py-1.5 rounded text-[10px] font-bold shadow bg-red-600 text-white hover:bg-red-700">Stornieren</button>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    ),
                                                  };
                                                });
                                                const activeItemEntries = itemEntries.filter((entry) => !entry.isPickedUpHighlighted);
                                                const pickedItemEntries = itemEntries.filter((entry) => entry.isPickedUpHighlighted);
                                                const orderSortPriority = activeItemEntries.length === 0 && pickedItemEntries.length > 0 ? 1 : 0;

                                                return {
                                                  key: order.id,
                                                  sortPriority: orderSortPriority,
                                                  statusKey: `${statusLabel}__${statusClass}`,
                                                  statusLabel,
                                                  statusClass,
                                                  statusPriority,
                                                  hasActiveItems: activeItemEntries.length > 0,
                                                  hasPickedItems: pickedItemEntries.length > 0,
                                                  createdAt: new Date(order.created_at).getTime(),
                                                  activeContent: activeItemEntries.length > 0 ? (
                                                    <div key={`${order.id}-active`} className="space-y-2">
                                                      {activeItemEntries.map((entry) => entry.content)}
                                                    </div>
                                                  ) : null,
                                                  pickedContent: pickedItemEntries.length > 0 ? (
                                                    <div key={`${order.id}-picked`} className="space-y-2">
                                                      {pickedItemEntries.map((entry) => entry.content)}
                                                    </div>
                                                  ) : null,
                                                };
                                            });
                                            const sortedOrders = regularOrders
                                              .filter((o): o is NonNullable<typeof o> => o !== null)
                                              .sort((a, b) => {
                                                if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
                                                return a.createdAt - b.createdAt;
                                              });
                                            if (sortedOrders.length === 0) return <div className="text-center text-app-muted italic py-4 border-2 border-dashed border-app-muted/20 rounded-xl">Alles erledigt oder auf Rechnung.</div>;
                                            const activeOrders = sortedOrders.filter((o) => o.hasActiveItems);
                                            const pickedUpOrders = sortedOrders.filter((o) => o.hasPickedItems);
                                            const activeStatusGroups = activeOrders.reduce(
                                              (groups: Array<{ key: string; label: string; className: string; priority: number; orders: typeof activeOrders }>, order) => {
                                                const existingGroup = groups.find((group) => group.key === order.statusKey);
                                                if (existingGroup) {
                                                  existingGroup.orders.push(order);
                                                } else {
                                                  groups.push({
                                                    key: order.statusKey,
                                                    label: order.statusLabel,
                                                    className: order.statusClass,
                                                    priority: order.statusPriority,
                                                    orders: [order],
                                                  });
                                                }
                                                return groups;
                                              },
                                              []
                                            ).sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));

                                            return (
                                              <>
                                                {activeStatusGroups.map((group, groupIndex) => (
                                                  <div key={group.key} className={groupIndex === 0 ? 'space-y-2' : 'mt-3 space-y-2'}>
                                                    <div className={`text-[10px] md:text-xs font-bold uppercase px-2 md:px-3 py-1 md:py-1.5 rounded-full tracking-wide shadow-sm whitespace-nowrap inline-flex ${group.className}`}>
                                                      {group.label}
                                                    </div>
                                                    {group.orders.map((o) => <div key={`${o.key}-active`}>{o.activeContent}</div>)}
                                                  </div>
                                                ))}
                                                {pickedUpOrders.length > 0 && (
                                                  <div className="mt-3 space-y-2">
                                                    <div className="text-[10px] md:text-xs font-bold uppercase px-2 md:px-3 py-1 md:py-1.5 rounded-full tracking-wide shadow-sm whitespace-nowrap border border-slate-200 bg-slate-50 text-slate-400 inline-flex">
                                                      Abgeholt
                                                    </div>
                                                    {pickedUpOrders.map((o) => <div key={`${o.key}-picked`}>{o.pickedContent}</div>)}
                                                  </div>
                                                )}
                                              </>
                                            );
                                        })()}
                                    </div>
                                </div>
                                <div className="bg-app-bg -mx-2 md:-mx-6 -mb-2 md:-mb-6 p-2 md:p-6 border-t border-app-muted/20">
                                    <div className="flex justify-between items-end mb-2 md:mb-4">
                                    <span className="text-sm md:text-2xl font-bold text-app-muted">Gesamt:</span>
                                    <span className="text-xl md:text-5xl font-black text-app-text">{calculateTrueOpenTotal().toFixed(2).replace('.', ',')} €</span>
                                    </div>
                                  <button onClick={handlePayAndReset} className="w-full bg-app-accent hover:brightness-110 text-white font-bold py-2 md:py-5 rounded-lg md:rounded-xl shadow-lg active:scale-[0.98] text-sm md:text-xl">Bezahlen & Frei</button>
                                </div>
                            </div>
                        )}
                        
                        {/* UPDATE: RESERVIERUNGEN ALS AGENDA */}
                        {features.reservationsEnabled && activeTab === 'reservations' && (
                          <div className="min-h-full flex flex-col">
                                {/* LISTE DER RESERVIERUNGEN */}
                                <div>
                                    <h3 className="font-bold text-slate-800 mb-4 text-lg border-b border-slate-200 pb-2">Kommende Buchungen</h3>
                                    {reservations.length === 0 ? <p className="text-slate-400 text-sm italic py-4">Keine Reservierungen gefunden.</p> : (
                                        <div className="space-y-6">
                                            {Object.entries(groupReservationsByDate()).map(([dateStr, resItems]) => (
                                                <div key={dateStr} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                    <div className="flex items-center gap-3 mb-3">
                                                       <span className="bg-[#275D7B] text-white px-3 py-1 rounded-md font-bold text-sm uppercase tracking-wide">
                                                          {formatDateLabel(dateStr)}
                                                       </span>
                                                       <div className="h-[1px] bg-slate-200 flex-1"></div>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-2">
                                                        {resItems.map(res => (
                                                            <div key={res.id} className="bg-slate-50 border border-slate-200 hover:border-blue-300 p-4 rounded-xl flex justify-between items-center transition-all shadow-sm">
                                                                <div>
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                       <span className="text-xl font-black text-slate-700">{res.time}</span>
                                                                       <span className="text-xs font-bold text-slate-400 uppercase">Uhr</span>
                                                                    </div>
                                                                    <div className="font-bold text-slate-800 text-lg">{res.guest_name}</div>
                                                                    <div className="text-xs text-slate-500 font-medium bg-white px-2 py-1 rounded border border-slate-100 w-fit mt-1">
                                                                       {res.guests_count} Personen
                                                                    </div>
                                                                </div>
                                                                <button onClick={() => deleteReservation(res.id)} className="bg-white hover:bg-red-50 text-slate-300 hover:text-red-500 p-3 rounded-lg border border-slate-100 hover:border-red-200 transition-colors">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {/* FORMULAR */}
                                <form onSubmit={addReservation} className="mt-auto pt-8 md:pt-10 bg-blue-50 p-4 rounded-xl border border-blue-100">
                                    <h3 className="font-bold text-blue-800 mb-3 text-sm">Neue Reservierung</h3>
                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                        <input required type="text" placeholder="Name" className="p-2 rounded border border-blue-200 text-sm text-black" value={newRes.name} onChange={e => setNewRes({...newRes, name: e.target.value})} />
                                        
                                        {/* UPDATE: DATE INPUT */}
                                        <input required type="date" className="p-2 rounded border border-blue-200 text-sm text-black" value={newRes.date} onChange={e => setNewRes({...newRes, date: e.target.value})} />
                                        
                                        <input required type="time" step={900} className="p-2 rounded border border-blue-200 text-sm text-black" value={newRes.time} onChange={e => setNewRes({...newRes, time: e.target.value})} />
                                        <input required type="number" min="1" placeholder="Pers." className="p-2 rounded border border-blue-200 text-sm text-black" value={newRes.count} onChange={e => setNewRes({...newRes, count: parseInt(e.target.value)})} />
                                    </div>
                                    <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg text-sm hover:bg-blue-700">Speichern</button>
                                </form>
                            </div>
                        )}

                        {activeTab === 'stats' && (<div className="text-center space-y-8 py-4"><div className="bg-slate-50 p-6 rounded-2xl border border-slate-100"><div className="text-sm text-slate-500 font-bold uppercase mb-1">Gesamtumsatz (Paid)</div><div className="text-4xl font-black text-slate-800">{stats.totalRevenue.toFixed(2).replace('.', ',')} €</div></div><div className="grid grid-cols-2 gap-4"><div className="bg-slate-50 p-4 rounded-xl border border-slate-100"><div className="text-xs text-slate-500 font-bold uppercase mb-1">Abgerechnet</div><div className="text-2xl font-black text-slate-800">{stats.orderCount} x</div></div><div className="bg-slate-50 p-4 rounded-xl border border-slate-100"><div className="text-xs text-slate-500 font-bold uppercase mb-1">Ø Bon</div><div className="text-2xl font-black text-slate-800">{stats.orderCount > 0 ? (stats.totalRevenue / stats.orderCount).toFixed(2).replace('.', ',') : "0,00"} €</div></div></div></div>)}
                    </>
                )}
            </div>
          </div>
        </div>
      )}
      {payQtyPicker && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setPayQtyPicker(null)}>
          <div className="bg-white text-slate-900 w-full max-w-sm rounded-2xl shadow-2xl p-4 md:p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-800 mb-1">Abkassieren</h3>
            <p className="text-xs text-slate-500 mb-3 truncate">{payQtyPicker.itemLabel}</p>

            <div className="flex items-center justify-center gap-3 bg-slate-50 border border-slate-200 rounded-xl py-3 mb-4">
              <button
                onClick={() => setPayQtyValue(prev => Math.max(1, prev - 1))}
                className="w-10 h-10 rounded-lg bg-white border border-slate-300 text-slate-700 text-xl font-black hover:bg-slate-100"
              >
                -
              </button>
              <div className="text-center min-w-[84px]">
                <div className="text-2xl font-black text-slate-900">{payQtyValue}x</div>
                <div className="text-[11px] text-slate-500">von {payQtyPicker.maxQty}x</div>
              </div>
              <button
                onClick={() => setPayQtyValue(prev => Math.min(payQtyPicker.maxQty, prev + 1))}
                className="w-10 h-10 rounded-lg bg-white border border-slate-300 text-slate-700 text-xl font-black hover:bg-slate-100"
              >
                +
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPayQtyPicker(null)}
                className="py-2 rounded-lg bg-slate-200 text-slate-700 font-bold hover:bg-slate-300"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmPayQtyPicker}
                className="py-2 rounded-lg text-white font-bold bg-green-600 hover:bg-green-700"
              >
                Abkassieren
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WaiterPage() {
  return (
    <ProtectedRoute>
      <WaiterContent />
    </ProtectedRoute>
  );
}
