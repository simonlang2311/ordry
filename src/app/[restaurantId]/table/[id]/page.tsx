"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Logo } from '@/components/Branding';
import { DEFAULT_RESTAURANT_FEATURES, RestaurantFeatures, loadRestaurantFeatures } from "@/lib/features";
import { 
  validateAndRedirectToken,
  createNewTokenForTable,
  saveToken,
  clearToken,
  getToken
} from "@/lib/tokenManager";
import { usePersonalAuth } from "@/lib/usePersonalAuth";

const stripEmojiFromText = (value: string) => value
  .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F]/gu, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

// --- 1. DATENSTRUKTUR ---
type Product = {
  id: number;
  name: string;
  price: number;
  desc?: string; // DB: description
  isSpecial?: boolean;
  category?: string;
  vatRate?: number;
  allergens?: string[];
};

type MenuRow = {
  id: number;
  name: string;
  price: number;
  description?: string | null;
  category?: string | null;
  item_type?: "food" | "drink" | null;
  vat_rate?: number | null;
  allergens?: string[] | string | null;
};

type CartItem = Product & {
  quantity: number;
  note?: string;
};

type Order = {
  id: number;
  table_id: string;
  items: string[];
  status: string;
  created_at: string;
  total_price?: number;
  session_id?: string | null;
};

type Category = {
  id: string;
  name: string;
  items: Product[];
};

type LunchSpecialConfig = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  items: number[];
  itemPrices: { [itemId: number]: number };
  menus: LunchMenu[];
};

type LunchMenu = {
  id: string;
  name: string;
  description: string;
  itemIds: number[];
  price: number;
};

const ORDER_NOTE_MARKERS = ["(Notiz:", "(\u{1F4DD}"];
const MENU_ITEMS_LABEL = "Im Menü enthalten:";

const splitItemNote = (value: string) => {
  const marker = ORDER_NOTE_MARKERS.find((entry) => value.includes(entry));
  if (!marker) return { label: value.trim(), note: "" };

  const [labelPart, notePart] = value.split(marker);
  return {
    label: labelPart.trim(),
    note: notePart.replace(")", "").trim(),
  };
};

const getBaseItemName = (value: string) => {
  const parsed = splitItemNote(value);
  return parsed.label.split(" - ")[0].trim();
};

// --- HELPER: Prüfe ob Mittagszeit aktiv ist ---
const checkLunchTime = (config: LunchSpecialConfig | null): boolean => {
  if (!config || !config.enabled) {
    console.log('[LunchSpecial] Nicht aktiviert oder keine Config');
    return false;
  }
  
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes(); // Minuten seit Mitternacht
  
  const [startHour, startMin] = config.startTime.split(':').map(Number);
  const [endHour, endMin] = config.endTime.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  const isActive = currentTime >= startMinutes && currentTime < endMinutes;
  
  console.log('[LunchSpecial] Zeit-Check:', {
    currentTime: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`,
    startTime: config.startTime,
    endTime: config.endTime,
    isActive,
    currentMinutes: currentTime,
    startMinutes,
    endMinutes
  });
  
  return isActive;
};

const normalizeAllergens = (value?: string[] | string | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch (e) {
        console.warn("[Allergens] JSON parse failed, fallback to split", e);
      }
    }
    return trimmed
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const AllergensToggle = ({ allergens, enabled = true }: { allergens?: string[]; enabled?: boolean }) => {
  const list = allergens ?? [];

  if (!enabled || list.length === 0) return null;

  return (
    <div className="mt-2">
      <details className="group" onClick={(e) => e.stopPropagation()}>
        <summary
          onClick={(e) => e.stopPropagation()}
          className="list-none inline-flex cursor-pointer items-center gap-2 rounded-md border border-app-muted/30 bg-app-bg px-2 py-1 text-[10px] font-bold text-app-muted hover:bg-app-muted/10"
        >
          <span className="select-none">Allergene</span>
          <span className="text-[9px] text-app-muted transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="mt-2 rounded-lg border border-app-muted/20 bg-app-bg/60 p-2 text-[11px] text-app-text">
          <ul className="list-disc space-y-0.5 pl-4">
            {list.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
};

export default function TablePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = usePersonalAuth();
  const tableId = params?.id ? decodeURIComponent(Array.isArray(params.id) ? params.id[0] : params.id) : 'Unbekannt';
  const restaurantId = params?.restaurantId ? decodeURIComponent(Array.isArray(params.restaurantId) ? params.restaurantId[0] : params.restaurantId) : 'Unbekannt';
  const tokenFromUrl = searchParams.get('token') ?? searchParams.get('admintoken');

  // --- STATE ---
  const [currentMenu, setCurrentMenu] = useState<Category[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const categoryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tableExists, setTableExists] = useState<boolean | null>(null);
   const categoryHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showUpsell, setShowUpsell] = useState(false);
  const [showCartDetails, setShowCartDetails] = useState(false);
  const [showOrderHistory, setShowOrderHistory] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [tempNote, setTempNote] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [restaurantLink, setRestaurantLink] = useState<string>("");

  // Split Logic
  const [isSplittingMode, setIsSplittingMode] = useState(false);
  const [activeSplitOrder, setActiveSplitOrder] = useState<Order | null>(null);
  const [splitSelection, setSplitSelection] = useState<string[]>([]);
  const [myOrderHistory, setMyOrderHistory] = useState<Order[]>([]);

  // Tracking
  const [lastAddedItemName, setLastAddedItemName] = useState<string>("");
  const [lastAddedItemId, setLastAddedItemId] = useState<number | string>("");
  const [currentUpsellItems, setCurrentUpsellItems] = useState<Product[]>([]);
  const [selectedUpsellQuantities, setSelectedUpsellQuantities] = useState<Record<string, number>>({});

  // Mittagskarte
  const [lunchSpecial, setLunchSpecial] = useState<LunchSpecialConfig | null>(null);
  const [isLunchTimeActive, setIsLunchTimeActive] = useState(false);
  const [allergensEnabled, setAllergensEnabled] = useState(true);
  const [allergensDisabledNotice, setAllergensDisabledNotice] = useState("");
  const [upsellProductIds, setUpsellProductIds] = useState<number[]>([]);
  const [features, setFeatures] = useState<RestaurantFeatures>(DEFAULT_RESTAURANT_FEATURES);

  // Token Management
  const [tokenState, setTokenState] = useState<{
    isValid: boolean;
    currentToken: string | null;
    isInitialized: boolean;
    accessDenied?: boolean;
    shouldRedirect?: boolean;
    redirectToken?: string | null;
  }>({
    isValid: true,
    currentToken: null,
    isInitialized: false
  });

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

  // --- TOKEN VALIDIERUNG UND TISCH CHECK ---
  useEffect(() => {
    // immediately allow page to proceed – actual validation does not gate the render
    setTableExists(true);

    const validateAccess = async () => {
      if (!tableId || tableId === "Unbekannt") {
        console.log('[TablePage] Invalid tableId:', tableId);
        setTableExists(false);
        return;
      }

      console.log('[TablePage] Validating token for table:', tableId, 'tokenFromUrl:', tokenFromUrl);

      try {
        const result = await validateAndRedirectToken(tableId, tokenFromUrl, supabase, restaurantId);
        console.log('[TablePage] Token validation result:', result);

        if (result.shouldRedirect && result.validToken) {
          console.log('[TablePage] Redirecting with new token:', result.validToken);
          router.push(`/table/${encodeURIComponent(tableId)}?token=${encodeURIComponent(result.validToken)}`);
          return;
        }

        setTokenState({
          isValid: result.isValid,
          currentToken: result.validToken,
          isInitialized: true,
          accessDenied: !result.isValid,
          shouldRedirect: result.shouldRedirect,
          redirectToken: result.validToken
        });
      } catch (err) {
        console.error('[TablePage] Error validating token:', err);
        setTokenState({
          isValid: true,
          currentToken: null,
          isInitialized: true
        });
      }
    };

    const timeoutId = setTimeout(() => {
      console.warn('[TablePage] token validation timed out');
      setTokenState({ isValid: true, currentToken: null, isInitialized: true });
    }, 3000);

    validateAccess().finally(() => clearTimeout(timeoutId));
  }, [tableId, tokenFromUrl]);

  // --- 1. DATEN LADEN (NUR NOCH DATENBANK) ---
  useEffect(() => {
    if (tableExists !== true) {
      return;
    }

    const fetchMenuData = async () => {
      setLoadingMenu(true);
      console.log('[TablePage] Starte Menü-Laden...');
      
      try {
        // Add a timeout to prevent hanging on Supabase queries
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Menu loading timeout')), 5000);
        });

        // A) Kategorien laden (aus settings)
        let categoriesList: { id: string, label: string }[] = [];
        const catDataPromise = supabase.from('settings').select('value').eq('key', 'menu_categories').eq('restaurant_id', restaurantId).single();
        const { data: catData } = await Promise.race([catDataPromise, timeoutPromise as any]);
        console.log('[TablePage] Kategorien geladen:', catData);
        
        if (catData?.value) {
            try {
                const parsed = JSON.parse(catData.value);
                if (Array.isArray(parsed)) {
                  categoriesList = parsed.map((category: { id: string; label: string }) => ({
                    ...category,
                    label: stripEmojiFromText(category.label || category.id),
                  }));
                }
            } catch(e) { console.error("Kategorie-JSON Fehler", e); }
        }

        // Z) Restaurant-Link laden
        const linkDataPromise = supabase.from('settings').select('value').eq('key', 'restaurant_link').eq('restaurant_id', restaurantId).single();
        const { data: linkData } = await Promise.race([linkDataPromise, timeoutPromise as any]);
        if (linkData?.value) {
          setRestaurantLink(linkData.value);
          console.log('[TablePage] Restaurant-Link geladen:', linkData.value);
        }

        const allergensEnabledPromise = supabase.from('settings').select('value').eq('key', 'allergens_enabled').eq('restaurant_id', restaurantId).single();
        const allergensDisabledNoticePromise = supabase.from('settings').select('value').eq('key', 'allergens_disabled_notice').eq('restaurant_id', restaurantId).single();
        const { data: allergensEnabledData } = await Promise.race([allergensEnabledPromise, timeoutPromise as any]);
        const { data: allergensDisabledNoticeData } = await Promise.race([allergensDisabledNoticePromise, timeoutPromise as any]);
        setAllergensEnabled(allergensEnabledData?.value !== 'false');
        setAllergensDisabledNotice(allergensDisabledNoticeData?.value || '');

        const upsellProductsPromise = supabase.from('settings').select('value').eq('key', 'upsell_products').eq('restaurant_id', restaurantId).single();
        const { data: upsellProductsData } = await Promise.race([upsellProductsPromise, timeoutPromise as any]);
        if (upsellProductsData?.value) {
          try {
            const parsedUpsellIds = JSON.parse(upsellProductsData.value);
            setUpsellProductIds(
              Array.isArray(parsedUpsellIds)
                ? parsedUpsellIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
                : []
            );
          } catch (error) {
            console.error('[TablePage] Upsell-Produkte konnten nicht geladen werden:', error);
            setUpsellProductIds([]);
          }
        } else {
          setUpsellProductIds([]);
        }

        // B) Gerichte laden (aus menu Tabelle)
        const menuDataPromise = supabase.from('menu').select('*').eq('restaurant_id', restaurantId);
        const { data: menuData, error } = await Promise.race([menuDataPromise, timeoutPromise as any]);
        console.log('[TablePage] Menü-Daten geladen:', menuData?.length || 0, 'Items');
        if (error) {
          console.error('[TablePage] Fehler beim Laden:', error);
          throw error;
        }

        // C) Mittagskarte laden
        const lunchDataPromise = supabase.from('settings').select('value').eq('key', 'lunch_special').eq('restaurant_id', restaurantId).single();
        const { data: lunchData } = await Promise.race([lunchDataPromise, timeoutPromise as any]);
        let lunchConfig: LunchSpecialConfig | null = null;
        if (lunchData?.value) {
          try {
            const parsed = JSON.parse(lunchData.value);
            // Sicherstellen, dass alle Felder existieren
            lunchConfig = {
              enabled: parsed.enabled || false,
              startTime: parsed.startTime || "11:00",
              endTime: parsed.endTime || "14:30",
              items: parsed.items || [],
              itemPrices: parsed.itemPrices || {},
              menus: parsed.menus || []
            };
            console.log('[TablePage] Mittagskarte Config geladen:', lunchConfig);
            setLunchSpecial(lunchConfig);
            if (lunchConfig) {
              const isActive = checkLunchTime(lunchConfig);
              console.log('[TablePage] Mittagskarte aktiv?', isActive);
              setIsLunchTimeActive(isActive);
            }
          } catch(e) {
            console.error("Lunch Special Load Error:", e);
          }
        } else {
          console.log('[TablePage] Keine Mittagskarte Config gefunden');
        }

        // D) Zusammenbauen
        const builtMenu: Category[] = [];

        // Mittagskarte als erste Kategorie hinzufügen, wenn aktiviert UND in der Zeit
        console.log('[TablePage] Prüfe Mittagskarte:', { 
          hasConfig: !!lunchConfig, 
          enabled: lunchConfig?.enabled,
          items: lunchConfig?.items?.length || 0,
          menus: lunchConfig?.menus?.length || 0
        });

        if (lunchConfig && lunchConfig.enabled && (lunchConfig.items.length > 0 || lunchConfig.menus.length > 0)) {
          const isLunchActive = checkLunchTime(lunchConfig);
          const showLunchItems = isLunchActive && lunchConfig.items.length > 0;
          const showLunchMenus = lunchConfig.menus.length > 0;
          console.log('[TablePage] Zeitprüfung:', {
            itemsCount: lunchConfig.items.length,
            menusCount: lunchConfig.menus.length,
            isInTimeRange: isLunchActive,
            currentTime: new Date().toLocaleTimeString('de-DE'),
            startTime: lunchConfig.startTime,
            endTime: lunchConfig.endTime
          });
          // Einzelne Gerichte mit speziellen Preisen
          const lunchItems = showLunchItems ? (menuData || [])
            .filter((item: MenuRow) => lunchConfig!.items.includes(item.id))
            .map((item: MenuRow) => {
              const specialPrice = lunchConfig!.itemPrices[item.id];
              const vatRate = item.vat_rate ?? (item.item_type === "drink" ? 19 : 7);
              return {
                id: item.id,
                name: item.name,
                price: specialPrice !== undefined ? specialPrice : item.price,
                desc: item.description,
                category: 'lunch-special',
                isSpecial: true,
                vatRate,
                allergens: normalizeAllergens(item.allergens)
              };
            }) : [];

          // Menüs als eigene "Produkte" hinzufügen
          const menuItems: Product[] = showLunchMenus ? lunchConfig.menus.map(menu => {
            // Finde die Gerichte für dieses Menü
            const menuItemNames = menu.itemIds
              .map(itemId => {
                const item = menuData?.find((m: MenuRow) => m.id === itemId);
                return item ? item.name : null;
              })
              .filter(name => name !== null);

            const menuAllergens = Array.from(
              new Set(
                menu.itemIds
                  .map((itemId) => menuData?.find((m: MenuRow) => m.id === itemId))
                  .flatMap((item) => normalizeAllergens(item?.allergens))
              )
            );
            
            // Erstelle Beschreibung mit klarer Trennung
            let fullDesc = '';
            if (menu.description) {
              fullDesc = menu.description + '\n\n';
            }
            if (menuItemNames.length > 0) {
              fullDesc += `${MENU_ITEMS_LABEL}\n• ${menuItemNames.join('\n• ')}`;
            }
            
            return {
              id: `menu_${menu.id}` as any,
              name: menu.name,
              price: menu.price,
              desc: fullDesc,
              category: 'lunch-special',
              isSpecial: true,
              vatRate: 7,
              allergens: menuAllergens
            };
          }) : [];

          const allLunchItems = [...menuItems, ...lunchItems];

          console.log('[TablePage] Mittagskarte Items gefunden:', allLunchItems.length);

          if (allLunchItems.length > 0) {
            builtMenu.push({
              id: 'lunch-special',
              name: isLunchActive ? 'Mittagskarte' : 'Tagesangebote',
              items: allLunchItems
            });
          }
          if (!isLunchActive && allLunchItems.length === 0) {
          console.log('[TablePage] Mittagskarte ist aktiviert, aber außerhalb der Zeiten');
        }
        }
        // Normale Kategorien hinzufügen
        const activeLunchItemIds = new Set<number>(
          lunchConfig && lunchConfig.enabled && checkLunchTime(lunchConfig)
            ? lunchConfig.items
            : []
        );

        categoriesList.forEach(cat => {
            const items = (menuData || [])
              .filter((item: MenuRow) => item.category && item.category.trim().toLowerCase() === cat.id.trim().toLowerCase())
              // Angebots-Items nur in der Mittagskarte anzeigen (keine Duplikate in normalen Kategorien)
              .filter((item: MenuRow) => !activeLunchItemIds.has(item.id))
              .map((item: MenuRow) => ({
                id: item.id,
                name: item.name,
                price: item.price,
                desc: item.description,
                category: item.category,
                isSpecial: false,
                vatRate: item.vat_rate ?? (item.item_type === "drink" ? 19 : 7),
                allergens: normalizeAllergens(item.allergens)
              }));

            if (items.length > 0) {
              builtMenu.push({
                  id: cat.id,
                  name: cat.label,
                  items: items
              });
            }
        });

        setCurrentMenu(builtMenu);
        console.log('[TablePage] Menü gebaut:', builtMenu.length, 'Kategorien');
        if (builtMenu.length > 0) setActiveCategory(builtMenu[0].name);

      } catch (err: any) {
        console.error("Fehler beim Laden der Karte:", err.message);
      } finally {
        setLoadingMenu(false);
      }
    };

    fetchMenuData();

    // Live-Updates für Theme und Speisekarte
    const channel = supabase.channel(`table-menu-updates-${restaurantId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const nextSetting = payload.new as { key?: string; value?: string };
          const previousSetting = payload.old as { key?: string };
          const settingKey = nextSetting?.key || previousSetting?.key;
          if (settingKey === 'theme' && nextSetting?.value) {
            document.body.setAttribute('data-theme', nextSetting.value);
          }
          if (
            settingKey === 'menu_categories' ||
            settingKey === 'lunch_special' ||
            settingKey === 'allergens_enabled' ||
            settingKey === 'allergens_disabled_notice' ||
            settingKey === 'upsell_products'
          ) {
            void fetchMenuData();
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'menu', filter: `restaurant_id=eq.${restaurantId}` },
        () => { void fetchMenuData(); })
        .subscribe();
        
    return () => { supabase.removeChannel(channel); };
  }, [tableExists, restaurantId]);

  // --- TIMER: Prüfe Mittagszeit jede Minute ---
  useEffect(() => {
    if (!lunchSpecial) return;

    const checkInterval = setInterval(() => {
      const isActive = checkLunchTime(lunchSpecial);
      if (isActive !== isLunchTimeActive) {
        setIsLunchTimeActive(isActive);
        // Menü neu laden, wenn sich Status ändert
        window.location.reload();
      }
    }, 60000); // Jede Minute prüfen

    return () => clearInterval(checkInterval);
  }, [lunchSpecial, isLunchTimeActive]);

  // --- ORDERS LADEN ---
  const fetchOrders = async () => {
    if(!tableId) return;
    const { data } = await supabase.from('orders').select('*').eq('restaurant_id', restaurantId).eq('table_id', tableId).neq('status', 'done').neq('status', 'paid').order('created_at', { ascending: false });
    if (data) setMyOrderHistory(data);
  };

  useEffect(() => {
    if(!tableId || tableExists !== true) return;
    fetchOrders();
    const channel = supabase.channel('table-updates').on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `table_id=eq.${tableId},restaurant_id=eq.${restaurantId}` }, () => fetchOrders()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tableId, tableExists, restaurantId]);
  
  // --- PREIS-HELFER ---
  const normalizeName = (value: string) =>
    value
      .split(/ \((?:\u{1F4DD}|Notiz:)\s*/u)[0]
      .split(" - ")[0]
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');

  const getProductPriceByName = (productName: string): number => {
    // Normalisierung für den Abgleich mit DB-Namen wie "Corona (0,3l)"
    const cleanName = normalizeName(productName);
    
    for (const cat of currentMenu) {
      const found = cat.items.find(item => normalizeName(item.name) === cleanName);
      if (found) return found.price;
    }
    for (const cat of currentMenu) {
      const found = cat.items.find(item => {
        const itemName = normalizeName(item.name);
        return itemName.includes(cleanName) || cleanName.includes(itemName);
      });
      if (found) return found.price;
    }
    const lunchMenu = lunchSpecial?.menus?.find(menu => normalizeName(menu.name) === cleanName);
    if (lunchMenu) return lunchMenu.price;
    const lunchMenuFuzzy = lunchSpecial?.menus?.find(menu => {
      const menuName = normalizeName(menu.name);
      return menuName.includes(cleanName) || cleanName.includes(menuName);
    });
    if (lunchMenuFuzzy) return lunchMenuFuzzy.price;
    return 0; 
  };

  const getItemPrice = (itemStr: string) => {
    if (itemStr.includes("KELLNER")) return 0;
    // Verbessertes Regex, um Namen mit Klammern wie "Corona (0,3l)" korrekt zu erfassen
    const match = itemStr.match(/^(\d+)x\s(.+)$/);
    if (match) {
        const qty = parseInt(match[1]);
      const namePart = splitItemNote(match[2]).label.split(" - ")[0].trim();
        return qty * getProductPriceByName(namePart);
    }
    return getProductPriceByName(itemStr);
  };

  // --- INTELLIGENTE VORSCHLÄGE ---
  const getDynamicUpsells = (justAddedProductId?: number | string) => {
    const configuredProducts = currentMenu
      .flatMap((category) => category.items)
      .filter((item) => typeof item.id === 'number' && upsellProductIds.includes(item.id));

    const withoutCurrentProduct = configuredProducts.filter((item) => item.id !== justAddedProductId);
    const eligibleProducts = withoutCurrentProduct.length >= 2 ? withoutCurrentProduct : configuredProducts;

    return [...eligibleProducts]
      .sort(() => 0.5 - Math.random())
      .slice(0, 2);
  };


  // --- LOGIK: BESTELLEN & CART ---
  const addProductToCart = (product: Product, quantity = 1) => {
    setCart((prev) => {
      const existing = prev.find((p) => p.id === product.id);
      return existing
        ? prev.map((p) => p.id === product.id ? { ...p, quantity: p.quantity + quantity } : p)
        : [...prev, { ...product, quantity }];
    });
  };

  const addToCart = (product: Product) => {
    addProductToCart(product);
    setTempNote(""); setShowNoteInput(true); setLastAddedItemName(product.name); setLastAddedItemId(product.id);
    setSelectedUpsellQuantities({});
    
    const suggestions = features.upsellingEnabled ? getDynamicUpsells(product.id) : [];
    setCurrentUpsellItems(suggestions);

    setShowUpsell(true);
  };

  const cancelLastAddedItem = () => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === lastAddedItemId);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        return prev.filter((item) => item.id !== lastAddedItemId);
      }
      return prev.map((item) => item.id === lastAddedItemId ? { ...item, quantity: item.quantity - 1 } : item);
    });
    setTempNote("");
    setShowNoteInput(false);
    setCurrentUpsellItems([]);
    setSelectedUpsellQuantities({});
    setLastAddedItemId("");
    setLastAddedItemName("");
    setShowUpsell(false);
  };

  const closeUpsellModal = () => {
    setSelectedUpsellQuantities({});
    setShowUpsell(false);
  };

  const incrementUpsellSelection = (productId: number | string) => {
    setSelectedUpsellQuantities((prev) => ({
      ...prev,
      [String(productId)]: (prev[String(productId)] || 0) + 1,
    }));
  };

  const decrementUpsellSelection = (productId: number | string) => {
    setSelectedUpsellQuantities((prev) => {
      const key = String(productId);
      const nextQuantity = Math.max((prev[key] || 0) - 1, 0);
      if (nextQuantity === 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: nextQuantity,
      };
    });
  };

  const addSelectedUpsellsToCart = () => {
    currentUpsellItems.forEach((item) => {
      const quantity = selectedUpsellQuantities[String(item.id)] || 0;
      if (quantity > 0) {
        addProductToCart(item, quantity);
      }
    });
    closeUpsellModal();
  };

  const updateQuantity = (id: number | string, delta: number) => setCart((prev) => prev.map((item) => item.id === id ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item));
  const removeProduct = (id: number | string) => setCart((prev) => prev.filter((i) => i.id !== id));
  const saveNoteToItem = () => { if (tempNote.trim()) setCart((prev) => prev.map(i => i.id === lastAddedItemId ? { ...i, note: tempNote } : i)); setShowNoteInput(false); };
  const handleUpsellNoteChange = (value: string) => {
    setTempNote(value);
    setCart((prev) => prev.map((item) => item.id === lastAddedItemId ? { ...item, note: value } : item));
  };

  const placeOrder = async () => {
    const itemsList = cart.map(item => {
      let text = `${item.quantity}x ${item.name}`;
      if (item.desc) text += ` - ${item.desc}`;
      if (item.note) text += ` (Notiz: ${item.note})`;
      return text;
    });

    const { data, error } = await supabase.from('orders').insert({
      restaurant_id: restaurantId,
      table_id: tableId,
      items: itemsList,
      status: 'new',
      total_price: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    }).select('id').single();

    if (error) { alert("Fehler: " + error.message); return; }

    // Wenn dies die erste Bestellung nach "Paid" ist, erstelle neuen Token
    if (data && !tokenState.currentToken) {
      // Erste Bestellung überhaupt - erstelle Token
      console.log('[TablePage] Erste Bestellung - erstelle neuen Token');
      const newToken = await createNewTokenForTable(tableId, supabase, restaurantId);
      setTokenState({
        isValid: true,
        currentToken: newToken,
        isInitialized: true
      });
    }

    setShowCartDetails(false); setShowUpsell(false); setShowSuccess(true); setCart([]);
    fetchOrders();
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const callWaiter = async () => {
    await supabase.from('orders').insert({ restaurant_id: restaurantId, table_id: tableId, items: ["KELLNER GERUFEN"], status: 'new' });
    alert("Kellner wurde gerufen!"); fetchOrders();
  };

  // --- SPLIT LOGIC ---
  const getGroupedOpenItems = () => {
    const rechnungenOrders = myOrderHistory.filter(o => o.status === 'pay_split');
    const blockedCounter: Record<string, number> = {};
    rechnungenOrders.forEach(o => o.items.forEach(itemStr => {
      const match = itemStr.match(/^(\d+)x\s(.+)/);
      const name = normalizeName(match ? match[2] : itemStr);
      const qty = match ? parseInt(match[1]) : 1;
      blockedCounter[name] = (blockedCounter[name] || 0) + qty;
    }));

    const availableItems: { name: string, originalName: string, price: number, availableIds: string[] }[] = [];
    const openOrders = myOrderHistory.filter(o => o.status !== 'pay_split' && !o.items.some(i => i.includes("KELLNER")));

    openOrders.forEach(order => {
      order.items.forEach((itemStr, itemIndex) => {
        const match = itemStr.match(/^(\d+)x\s(.+)/);
        const qty = match ? parseInt(match[1]) : 1;
        const rawName = match ? match[2].trim() : itemStr.trim();
        const name = normalizeName(rawName);
        const singlePrice = getProductPriceByName(name);

        for (let i = 0; i < qty; i++) {
          if (blockedCounter[name] > 0) { blockedCounter[name]--; } else {
            const uniqueId = `${order.id}-${itemIndex}-${i}`;
            let group = availableItems.find(g => g.name === name);
            if (!group) { group = { name, originalName: rawName, price: singlePrice, availableIds: [] }; availableItems.push(group); }
            group.availableIds.push(uniqueId);
          }
        }
      });
    });
    return availableItems;
  };

  const increaseSplitItem = (name: string, availableIds: string[]) => {
    const nextId = availableIds.find(id => !splitSelection.includes(id));
    if (nextId) setSplitSelection(prev => [...prev, nextId]);
  };
  const decreaseSplitItem = (name: string, availableIds: string[]) => {
    const selectedIds = availableIds.filter(id => splitSelection.includes(id));
    if (selectedIds.length > 0) {
      const idToRemove = selectedIds[selectedIds.length - 1];
      setSplitSelection(prev => prev.filter(id => id !== idToRemove));
    }
  };

  const saveRechnung = async () => {
    let shareTotal = 0;
    const itemsToAdd: string[] = [];
    const groupedItems = getGroupedOpenItems();
    groupedItems.forEach(group => {
      const selectedCount = group.availableIds.filter(id => splitSelection.includes(id)).length;
      for (let i = 0; i < selectedCount; i++) {
        shareTotal += group.price;
        const itemLabel = group.originalName.trim();
        const { label: labelWithoutNote, note } = splitItemNote(itemLabel);

        const descSeparator = labelWithoutNote.includes(" - ") ? " - " : (labelWithoutNote.includes(" – ") ? " – " : null);
        const labelParts = descSeparator ? labelWithoutNote.split(descSeparator) : [labelWithoutNote];
        const baseName = labelParts[0].trim();
        let desc = descSeparator ? labelParts.slice(1).join(descSeparator).trim() : "";

        if (!desc) {
          const allItems = currentMenu.flatMap(c => c.items);
          const matched = allItems.find(p => normalizeName(p.name) === normalizeName(baseName));
          if (matched?.desc) desc = matched.desc;
        }

        const finalLabel = `${baseName}${desc ? ` - ${desc}` : ""}${note ? ` (Notiz: ${note})` : ""}`;
        itemsToAdd.push(`1x ${finalLabel}`);
      }
    });

    if (itemsToAdd.length === 0) return alert("Bitte wähle Artikel aus.");

    if (activeSplitOrder) {
      const newItems = [...activeSplitOrder.items, ...itemsToAdd];
      const newTotal = (activeSplitOrder.total_price || 0) + shareTotal;
      await supabase.from('orders').update({ items: newItems, total_price: newTotal }).eq('id', activeSplitOrder.id);
    } else {
      await supabase.from('orders').insert({ restaurant_id: restaurantId, table_id: tableId, items: itemsToAdd, total_price: shareTotal, status: 'pay_split' });
    }
    resetSplit(); fetchOrders();
  };

  const removeItemFromRechnung = async (rechnung: Order, itemIndex: number) => {
    const newItems = [...rechnung.items];
    const itemPrice = getItemPrice(newItems[itemIndex]);
    newItems.splice(itemIndex, 1);
    if (newItems.length === 0) { await supabase.from('orders').delete().eq('id', rechnung.id); } 
    else { await supabase.from('orders').update({ items: newItems, total_price: (rechnung.total_price || 0) - itemPrice }).eq('id', rechnung.id); }
    fetchOrders();
  };

  const deleteRechnung = async (orderId: number) => {
    if(!confirm("Rechnung löschen?")) return;
    await supabase.from('orders').delete().eq('id', orderId); fetchOrders();
  };
  const resetSplit = () => { setActiveSplitOrder(null); setSplitSelection([]); setIsSplittingMode(false); };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  
  const currentCategoryObj = currentMenu.find(cat => cat.name === activeCategory) || currentMenu[0];
  const currentProducts = currentCategoryObj ? currentCategoryObj.items : [];

  useEffect(() => {
    if (!activeCategory) return;
    const activeButton = categoryButtonRefs.current[activeCategory];
    if (activeButton) {
      activeButton.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [activeCategory, currentMenu.length]);

  useEffect(() => {
    const handleScroll = () => {
      const headerOffset = 180;
      const viewportHeight = window.innerHeight;
      
      let bestCategory = null;
      let bestVisibleRatio = 0;
      
      currentMenu.forEach((category) => {
        const ref = categoryHeaderRefs.current[category.name];
        if (!ref) return;
        
        const rect = ref.getBoundingClientRect();
        
        // Berechne wie viel von der Kategorie im Viewport sichtbar ist
        const visibleTop = Math.max(headerOffset, rect.top);
        const visibleBottom = Math.min(viewportHeight, rect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        
        // Ratio: Wie viel vom Viewport wird von dieser Kategorie gefüllt
        const visibleRatio = visibleHeight / viewportHeight;
        
        // Schwellenwert basierend auf Anzahl der Items
        const itemCount = category.items.length;
        const threshold = itemCount <= 3 ? 0.3 : 0.5;
        
        // Wähle die Kategorie mit dem höchsten sichtbaren Anteil, wenn Schwellenwert erreicht
        if (visibleRatio >= threshold && visibleRatio > bestVisibleRatio) {
          bestVisibleRatio = visibleRatio;
          bestCategory = category.name;
        }
      });
      
      // Fallback: Wenn keine Kategorie den Schwellenwert erreicht, nimm die mit dem höchsten Anteil
      if (!bestCategory) {
        let maxRatio = 0;
        currentMenu.forEach((category) => {
          const ref = categoryHeaderRefs.current[category.name];
          if (!ref) return;
          
          const rect = ref.getBoundingClientRect();
          const visibleTop = Math.max(headerOffset, rect.top);
          const visibleBottom = Math.min(viewportHeight, rect.bottom);
          const visibleHeight = Math.max(0, visibleBottom - visibleTop);
          const visibleRatio = visibleHeight / viewportHeight;
          
          if (visibleRatio > maxRatio) {
            maxRatio = visibleRatio;
            bestCategory = category.name;
          }
        });
      }
      
      if (bestCategory && bestCategory !== activeCategory) {
        setActiveCategory(bestCategory);
      }
    };
    
    handleScroll(); // Initial call
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [currentMenu.length, activeCategory]);

  const rechnungenOrders = myOrderHistory.filter(o => o.status === 'pay_split');
  const rechnungenTotal = rechnungenOrders.reduce((sum: number, order: Order) => sum + (order.total_price || 0), 0);
  const groupedItemsForSplit = getGroupedOpenItems();
  const rawTableTotal = groupedItemsForSplit.reduce((sum: number, group) => sum + (group.price * group.availableIds.length), rechnungenTotal);

  if (tableExists === null) return <div className="min-h-screen flex items-center justify-center bg-app-bg text-app-primary font-bold">Prüfe Tisch...</div>;
  if (tableExists === false) return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg text-app-text p-6 text-center">
      <div className="max-w-md rounded-2xl border border-app-muted/20 bg-app-card p-6 shadow-lg">
        <h1 className="text-xl font-bold text-app-text">Ups, diesen Tisch gibt's gar nicht.</h1>
        <p className="mt-2 text-sm text-app-muted">Bitte prüfe die URL oder frage beim Service nach der richtigen Tischnummer.</p>
      </div>
    </div>
  );
  
  // Token-Validierung
  if (!tokenState.isInitialized) {
    return <div className="min-h-screen flex items-center justify-center bg-app-bg text-app-primary font-bold">Validiere Zugriff...</div>;
  }
  
  // Access Denied - Token ungültig
  if (tokenState.accessDenied) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg text-app-text p-6">
        <div className="max-w-md rounded-2xl border-2 border-red-500/40 bg-app-card p-8 shadow-2xl text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-3">Zugriff verweigert</h1>
          <p className="text-sm text-app-muted mb-6 leading-relaxed">
            Dieser Link ist nicht gültig oder abgelaufen – er verweist auf weg.
          </p>
          <p className="text-xs text-app-muted">Falls das Problem weiterhin besteht, kontaktieren Sie bitte den Service.</p>
        </div>
      </div>
    );
  }
  
  
  if (loadingMenu) return <div className="min-h-screen flex items-center justify-center bg-app-bg text-app-primary font-bold">Lade Speisekarte...</div>;
  
  return (
    <div className="min-h-screen w-full bg-app-bg text-app-text pb-32 font-sans relative transition-colors duration-300">
      
      <div className="bg-app-card shadow-sm sticky top-0 z-20 border-b border-app-primary/20">
        <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Logo Row */}
          <div className="flex items-center gap-2 md:flex-shrink-0">
            <Logo 
              width={120} 
              height={40} 
              priority 
              onClick={() => {
                if (restaurantLink) {
                  window.open(restaurantLink, '_blank', 'noopener,noreferrer');
                }
              }}
              style={restaurantLink ? { cursor: 'pointer' } : undefined}
            />
            {/* Mobile Table Number - Shows below logos on small screens */}
            <div className="md:hidden ml-auto">
              <div className="rounded-full bg-app-primary px-3 py-1 text-xs font-bold text-white shadow-md whitespace-nowrap">Tisch {tableId}</div>
            </div>
          </div>
          
          {/* Desktop Table Number - Centered on larger screens */}
          <div className="hidden md:flex items-center gap-2">
            <div className="rounded-full bg-app-primary px-4 py-1.5 text-sm font-bold text-white shadow-md whitespace-nowrap">Tisch {tableId}</div>
          </div>
          
          {/* Buttons */}
          <div className="flex items-center gap-2 md:flex-shrink-0">
            <button onClick={callWaiter} className="flex-1 md:flex-none bg-app-card text-app-primary border border-app-primary px-3 md:px-4 py-2 rounded-lg font-bold text-sm hover:bg-app-primary hover:text-white transition-colors shadow-sm">Kellner</button>
            <button onClick={() => { setShowOrderHistory(true); resetSplit(); }} className="flex-1 md:flex-none bg-app-card text-app-primary border border-app-primary px-3 md:px-4 py-2 rounded-lg font-bold text-sm hover:bg-app-primary hover:text-white transition-colors shadow-sm">Rechnung</button>
          </div>
        </div>
        
        <div className="flex gap-2 items-center overflow-x-auto pb-2 scrollbar-hide relative sticky left-0">
          {/* Hamburger Menu */}
          <div className="flex-shrink-0 relative sticky left-0 bg-app-card">
            <button
              onClick={() => setShowCategoryMenu(!showCategoryMenu)}
              className="flex flex-col gap-1.5 p-2 bg-app-card border border-app-muted/30 rounded-lg hover:bg-app-muted/10 transition-colors"
              aria-label="Kategorien"
            >
              <span className="w-5 h-0.5 bg-app-text rounded"></span>
              <span className="w-5 h-0.5 bg-app-text rounded"></span>
              <span className="w-5 h-0.5 bg-app-text rounded"></span>
            </button>
          </div>
          
          {/* Horizontale Kategorien-Liste */}
          {currentMenu.length > 0 ? currentMenu.map((category) => (
            <button key={category.id} onClick={() => {
              const header = categoryHeaderRefs.current[category.name];
              if (header) {
                const headerOffset = 180;
                const elementPosition = header.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
              }
            }}
              ref={(el) => { categoryButtonRefs.current[category.name] = el; }}
              className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold transition-all border 
                ${activeCategory === category.name 
                  ? "bg-app-primary text-white border-app-primary shadow-md" 
                  : "bg-app-card text-app-muted border-app-muted/30 hover:bg-app-muted/10"
                }`}
            >
              {category.name}
            </button>
          )) : (
            <div className="text-app-muted text-sm italic px-4">Keine Kategorien geladen.</div>
          )}
        </div>
        
        {/* Dropdown Menu */}
        {showCategoryMenu && (
          <div className="fixed top-20 left-4 md:top-24 bg-app-card border border-app-muted/30 rounded-lg shadow-2xl z-50 min-w-[220px]">
            {currentMenu.length > 0 ? (
              currentMenu.map((category) => (
                <button
                  key={category.id}
                  onClick={() => {
                    setShowCategoryMenu(false);
                    const header = categoryHeaderRefs.current[category.name];
                    if (header) {
                      const headerOffset = 180;
                      const elementPosition = header.getBoundingClientRect().top;
                      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                    }
                  }}
                  className={`w-full text-left px-4 py-3 text-sm font-bold transition-colors border-b border-app-muted/10 last:border-b-0 ${
                    activeCategory === category.name
                      ? "bg-app-primary text-white"
                      : "text-app-text hover:bg-app-muted/10"
                  }`}
                >
                  {category.name}
                </button>
              ))
            ) : (
              <div className="text-app-muted text-sm italic px-4 py-3">Keine Kategorien geladen.</div>
            )}
          </div>
        )}
        
        {/* Close menu when clicking outside */}
        {showCategoryMenu && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowCategoryMenu(false)}
          ></div>
        )}
      </div>

      <div className="p-4 space-y-8 md:space-y-12">
        {currentMenu.length > 0 ? currentMenu.map((category) => (
          <div 
            key={category.id}
            ref={(el) => { categoryHeaderRefs.current[category.name] = el; }}
            data-category={category.name}
            className="space-y-2 md:space-y-4"
          >
            {/* Category Header */}
            <div className="mb-4">
              <h3 className="text-2xl md:text-3xl font-black text-app-primary border-b-2 border-app-primary/30 pb-2">
                {category.name}
              </h3>
            </div>
            
            {/* Products in category */}
            {category.items.length > 0 ? category.items.map((product) => (
          <div
            key={product.id}
            className={`rounded-xl border bg-app-card shadow-sm hover:shadow-md transition-shadow relative overflow-hidden ${product.isSpecial ? "border-app-accent border-2" : "border-app-muted/20"} md:flex md:flex-col md:justify-between md:p-4 p-3`}
          >
            {product.isSpecial && (<div className="absolute top-0 right-0 bg-app-accent text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg">TIPP!</div>)}
            
            {/* Mobile Layout: Horizontal */}
            <div className="md:hidden flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-app-text leading-tight">{product.name}</h2>
                {product.desc && <p className="text-xs text-app-muted whitespace-pre-line">{product.desc}</p>}
                <AllergensToggle allergens={product.allergens} enabled={allergensEnabled} />
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className={`flex flex-col items-end leading-none ${product.isSpecial ? 'mt-1' : ''}`}>
                  <span className="font-bold text-base text-app-primary">{product.price.toFixed(2).replace('.', ',')}€</span>
                  <span className="text-[10px] text-app-muted font-bold">inkl. MwSt {product.vatRate ?? 7}%</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); addToCart(product); }}
                  className="bg-app-primary text-white rounded-lg w-10 h-10 flex items-center justify-center font-bold text-xl hover:brightness-110 transition-colors active:scale-[0.95]"
                >
                  +
                </button>
              </div>
            </div>
            
            {/* Desktop Layout: Vertical */}
            <div className="hidden md:block">
              <div>
                <div className="flex items-start justify-between">
                  <h2 className="text-lg font-bold text-app-text">{product.name}</h2>
                  <div className={`flex flex-col items-end leading-none ${product.isSpecial ? 'mt-1' : ''}`}>
                    <span className="font-bold text-lg text-app-primary">{product.price.toFixed(2).replace('.', ',')} €</span>
                    <span className="text-[10px] text-app-muted font-bold">inkl. MwSt {product.vatRate ?? 7}%</span>
                  </div>
                </div>
                {product.desc && <p className="mt-1 text-sm text-app-muted whitespace-pre-line">{product.desc}</p>}
                <AllergensToggle allergens={product.allergens} enabled={allergensEnabled} />
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); addToCart(product); }}
                className="mt-4 w-full rounded-lg bg-app-primary py-2.5 text-sm font-bold text-white hover:brightness-110 transition-colors active:scale-[0.98]"
              >
                Hinzufügen +
              </button>
            </div>
          </div>
            )) : (
              <div className="text-center py-10 text-app-muted italic">In dieser Kategorie gibt es aktuell keine Gerichte.</div>
            )}
          </div>
        )) : (
          <div className="text-center py-10 text-app-muted italic">Keine Kategorien geladen.</div>
        )}

        {!allergensEnabled && allergensDisabledNotice.trim() && (
          <div className="rounded-2xl border border-app-muted/20 bg-app-card p-4 md:p-5">
            <h3 className="text-sm font-black uppercase tracking-wide text-app-primary">Hinweis zu Allergenen</h3>
            <p className="mt-2 whitespace-pre-line text-sm text-app-muted">{allergensDisabledNotice}</p>
          </div>
        )}
      </div>

      {showUpsell && !showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-2xl bg-app-card p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200 border-t-4 border-app-accent">
            <div className="mb-2 flex justify-end">
              <button
                onClick={cancelLastAddedItem}
                className="rounded-full bg-app-bg p-2 text-app-muted hover:bg-app-muted/20"
                aria-label="Schließen"
              >
                X
              </button>
            </div>
            <div className="text-center">
              <h3 className="text-xl font-bold text-app-text mb-2">Gute Wahl!</h3>
              <div className="mt-4">
                <div className="mt-2 bg-app-bg p-2 rounded-lg border border-app-muted/20 animate-in fade-in slide-in-from-top-2">
                  <textarea value={tempNote} onChange={(e) => handleUpsellNoteChange(e.target.value)} placeholder="Extrawunsch / Notiz hinzufügen" className="w-full p-2 text-base md:text-sm border rounded text-app-text bg-app-card outline-none focus:border-app-accent" rows={2}/>
                </div>
              </div>
              {currentUpsellItems.length > 0 && (
                <p className="mt-4 font-medium text-app-primary">Dazu passt vielleicht:</p>
              )}
            </div>
            {currentUpsellItems.length > 0 && (
              <div className="mt-4 space-y-3">
                {currentUpsellItems.map((item) => (
                  <div key={item.id} className="flex w-full items-center justify-between rounded-xl border border-app-muted/20 p-3 transition-colors group">
                     <div className="text-left">
                       <div className="font-bold text-app-text">{item.name}</div>
                       <span className="text-sm font-bold text-app-accent">+{item.price.toFixed(2).replace('.', ',')}€</span>
                     </div>
                     <div className="flex items-center gap-2">
                       {(selectedUpsellQuantities[String(item.id)] || 0) > 0 && (
                         <>
                           <button
                             onClick={() => decrementUpsellSelection(item.id)}
                             className="flex h-9 w-9 items-center justify-center rounded-lg bg-app-bg text-lg font-bold text-app-text transition-colors hover:bg-app-muted/20"
                             aria-label={`${item.name} entfernen`}
                           >
                             -
                           </button>
                           <span className="min-w-6 rounded-full bg-app-primary/10 px-2 py-1 text-center text-xs font-bold text-app-primary">
                             {selectedUpsellQuantities[String(item.id)]}
                           </span>
                         </>
                       )}
                       <button
                         onClick={() => incrementUpsellSelection(item.id)}
                         className="flex h-9 w-9 items-center justify-center rounded-lg bg-app-primary text-lg font-bold text-white hover:brightness-110 transition-colors"
                         aria-label={`${item.name} hinzufügen`}
                       >
                         +
                       </button>
                     </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 space-y-2">
              <button
                onClick={addSelectedUpsellsToCart}
                className="w-full rounded-lg bg-app-primary py-3 text-sm font-bold text-white shadow-lg transition-colors hover:brightness-110"
              >
                {currentUpsellItems.length > 0 ? "Zum Warenkorb hinzufügen" : "Fertig"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCartDetails && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full rounded-t-2xl bg-app-card p-6 shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[80dvh] flex flex-col min-h-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6 border-b border-app-muted/20 pb-4 shrink-0">
              <h2 className="text-2xl font-bold text-app-text">Dein Warenkorb</h2>
              <button onClick={() => setShowCartDetails(false)} className="rounded-full bg-app-bg p-2 text-app-muted hover:bg-app-muted/20">X</button>
            </div>
            <div className="overflow-y-auto overscroll-y-contain space-y-4 mb-6 flex-1 min-h-0" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
              {cart.map((item) => (
                <div key={item.id} className="flex flex-col border-b border-dashed border-app-muted/20 pb-4 last:border-0">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col">
                      <span className="font-bold text-app-text text-lg">{item.name}</span>
                      <span className="text-[10px] text-app-muted font-bold uppercase">MwSt: {item.vatRate ?? 7}%</span>
                      {item.note && <span className="text-xs text-app-accent font-bold">Notiz: {item.note}</span>}
                    </div>
                    <button onClick={() => removeProduct(item.id)} className="text-app-danger hover:brightness-110 p-1 font-bold">X</button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center bg-app-bg rounded-lg p-1">
                      <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 flex items-center justify-center bg-app-card rounded-md text-app-text shadow-sm font-bold hover:bg-app-bg">-</button>
                      <span className="w-10 text-center font-bold text-app-text">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 flex items-center justify-center bg-app-card rounded-md text-app-text shadow-sm font-bold hover:bg-app-bg">+</button>
                    </div>
                    <div className="text-right leading-none">
                      <span className="font-bold text-app-primary text-lg">{(item.price * item.quantity).toFixed(2).replace('.', ',')} €</span>
                      <div className="text-[10px] text-app-muted font-bold">inkl. MwSt {item.vatRate ?? 7}%</div>
                    </div>
                  </div>
                </div>
              ))}
              {cart.length === 0 && <p className="text-center text-app-muted italic py-4">Dein Warenkorb ist leer.</p>}
            </div>
            <div className="mt-auto border-t border-app-muted/20 pt-4 shrink-0">
              <div className="flex flex-col mb-6">
                <div className="flex justify-between items-center text-xl"><span className="font-bold text-app-text">Gesamtsumme</span><span className="font-bold text-app-accent text-2xl">{total.toFixed(2).replace('.', ',')} €</span></div>
                <div className="text-right text-xs text-app-muted mt-1">inkl. MwSt.</div>
              </div>
              <button onClick={placeOrder} disabled={cart.length === 0} className={`w-full rounded-xl py-4 text-lg font-bold text-white shadow-lg transition-all ${cart.length === 0 ? "bg-gray-400 cursor-not-allowed" : "bg-app-accent active:scale-[0.98] hover:brightness-110"}`}>Jetzt bestellen ({cartItemCount} Artikel)</button>
            </div>
          </div>
          <div className="flex-1" onClick={() => setShowCartDetails(false)}></div>
        </div>
      )}

      {showOrderHistory && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full rounded-t-2xl bg-app-card p-6 shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[90dvh] flex flex-col min-h-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2 shrink-0">
              <h2 className="text-xl font-bold text-app-text">{activeSplitOrder ? "Artikel hinzufügen" : "Rechnung"}</h2>
              <button onClick={() => setShowOrderHistory(false)} className="rounded-full bg-app-bg p-2 text-app-muted hover:bg-app-muted/20">X</button>
            </div>

            <div className="overflow-y-auto overscroll-y-contain space-y-4 mb-2 flex-1 min-h-0 pb-20" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
              {(isSplittingMode || activeSplitOrder) && groupedItemsForSplit.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase text-app-muted tracking-wider mb-2 border-b border-app-muted/20 pb-1">Tisch Bestellungen (Wählbar)</h3>
                  {groupedItemsForSplit.map((group) => {
                    const selectedCount = group.availableIds.filter(id => splitSelection.includes(id)).length;
                    const maxAvailable = group.availableIds.length;
                    return (
                      <div key={group.name} className="flex justify-between items-center p-3 rounded mb-1 bg-app-bg border border-app-muted/10 hover:border-app-primary">
                        <div className="flex flex-col">
                          <span className="font-bold text-app-text">{getBaseItemName(group.originalName)}</span>
                          <span className="text-xs text-app-muted">{maxAvailable} verfügbar</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => decreaseSplitItem(group.name, group.availableIds)} className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${selectedCount > 0 ? "bg-app-danger text-white" : "bg-app-card text-app-muted"}`}>-</button>
                          <span className="font-bold text-lg w-4 text-center text-app-text">{selectedCount}</span>
                          <button onClick={() => increaseSplitItem(group.name, group.availableIds)} className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${selectedCount < maxAvailable ? "bg-app-primary text-white" : "bg-app-card text-app-muted"}`}>+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!isSplittingMode && !activeSplitOrder && (
                <>
                  {groupedItemsForSplit.length > 0 && (
                    <div className="mb-6">
                      {groupedItemsForSplit.map((group) => (
                        <div key={group.name} className="flex justify-between text-app-text py-1 border-b border-app-muted/10">
                          <span>{group.availableIds.length}x {getBaseItemName(group.originalName)}</span>
                          <div className="text-right">
                            <div>{(group.price * group.availableIds.length).toFixed(2)}€</div>
                            {group.availableIds.length > 1 && (
                              <div className="text-[11px] text-app-muted">{group.price.toFixed(2)}€ pro Stück</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {rechnungenOrders.length > 0 && (
                    <div className="mt-6 bg-app-primary/10 p-4 rounded-xl border border-app-primary/20">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-xs font-bold uppercase text-app-primary tracking-wider">Erstellte Rechnungen</h3>
                        <span className="text-app-primary font-bold bg-app-card px-2 py-0.5 rounded text-xs">Gesamt: {rechnungenTotal.toFixed(2)} €</span>
                      </div>
                      {rechnungenOrders.map((order, idx) => (
                        <div key={order.id} className="mb-2 bg-app-card rounded-lg p-3 shadow-sm border border-app-muted/10">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-xs text-app-muted font-bold uppercase">Rechnung #{idx + 1}</span>
                            <div className="flex gap-2">
                              <button onClick={() => { setActiveSplitOrder(order); setIsSplittingMode(true); }} className="text-app-primary bg-app-primary/10 p-1.5 rounded hover:brightness-110 text-xs font-bold">Bearbeiten</button>
                              <button onClick={() => deleteRechnung(order.id)} className="text-app-danger bg-app-danger/10 p-1.5 rounded hover:brightness-110 text-xs font-bold">Löschen</button>
                            </div>
                          </div>
                          {order.items.map((itemStr, i) => {
                            const itemVat = (() => {
                              const match = itemStr.match(/^(\d+)x\s(.+)/);
                              const name = match ? match[2].trim() : itemStr.trim();
                              const item = currentMenu.flatMap(c => c.items).find(p => p.name === name);
                              return item?.vatRate ?? 7;
                            })();
                            return (
                              <div key={i} className="flex justify-between text-app-text text-sm font-medium py-0.5 group">
                                <span>• {(() => { const m = itemStr.match(/^(\d+)x\s(.+)$/); if (!m) return getBaseItemName(itemStr); return `${m[1]}x ${getBaseItemName(m[2])}`; })()}</span>
                                <div className="flex items-center gap-2">
                                  <div className="text-right">
                                    <div>{getItemPrice(itemStr).toFixed(2)}€</div>
                                  </div>
                                  <button onClick={() => removeItemFromRechnung(order, i)} className="text-app-danger opacity-0 group-hover:opacity-100 transition-opacity font-bold">×</button>
                                </div>
                              </div>
                            );
                          })}
                          <div className="mt-2 pt-2 border-t border-app-muted/10 text-right font-bold text-app-primary">
                            <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                              <span>Summe: {order.total_price?.toFixed(2)} €</span>
                              <span className="text-[9px] md:text-[10px] text-app-muted font-bold">inkl. MwSt</span>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="border-t border-app-muted/10 pt-4 mt-4 bg-app-card shrink-0">
              {!isSplittingMode && !activeSplitOrder ? (
                <>
                  <div className="bg-app-bg p-4 rounded-xl mb-4 border border-app-muted/20">
                    {rechnungenOrders.length > 0 && (
                      <div className="flex justify-between items-center text-app-muted text-sm mb-1"><span>Erstellte Rechnungen:</span><span className="inline-flex items-baseline gap-1 whitespace-nowrap">{rechnungenTotal.toFixed(2)} € <span className="text-[9px] md:text-[10px] font-bold">inkl. MwSt</span></span></div>
                    )}
                    <div className={`flex justify-between items-center font-bold text-app-text text-xl ${rechnungenOrders.length > 0 ? "mt-2 pt-2 border-t border-app-muted/20" : ""}`}>
                      <span>Gesamt:</span>
                      <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-app-accent">{rawTableTotal.toFixed(2).replace('.', ',')} € <span className="text-[9px] md:text-[10px] font-bold">inkl. MwSt</span></span>
                    </div>
                  </div>
                  <button onClick={() => setIsSplittingMode(true)} className="w-full py-4 rounded-xl font-bold border-2 border-app-primary text-app-primary hover:bg-app-primary/10 transition-colors">
                    Rechnung aufteilen
                  </button>
                </>
              ) : (
                <>
                  <div className="flex justify-between font-bold text-xl text-app-text mb-4"><span>Auswahl:</span><span className="text-app-accent">{splitSelection.length > 0 ? (splitSelection.reduce((acc, uid) => {
                    const group = groupedItemsForSplit.find(g => g.availableIds.includes(uid));
                    return acc + (group ? group.price : 0);
                  }, 0)).toFixed(2) : "0.00"} €</span></div>
                  <div className="flex gap-3">
                    <button onClick={() => { setIsSplittingMode(false); setActiveSplitOrder(null); setSplitSelection([]); }} className="px-6 py-4 rounded-xl font-bold bg-app-bg text-app-muted hover:bg-app-muted/10">Zurück</button>
                    <button onClick={saveRechnung} disabled={splitSelection.length === 0} className="flex-1 py-4 rounded-xl font-bold text-white bg-app-accent disabled:bg-gray-400 shadow-lg hover:brightness-110 transition-colors">
                      {activeSplitOrder ? "Hinzufügen" : "Rechnung aufteilen"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/95 animate-in fade-in duration-300">
          <SimpleConfetti />
          <div className="text-center z-10 animate-in zoom-in slide-in-from-bottom-8 duration-500 p-8 rounded-3xl bg-white shadow-2xl border-4 border-app-accent">
            <StirPotAnimation />
            <h1 className="text-3xl font-black text-app-primary mb-2">Bestellung<br/>abgeschlossen!</h1>
            <p className="text-app-text font-medium">Vielen Dank. Die Küche legt los.</p>
          </div>
        </div>
      )}
      
      {cart.length > 0 && !showCartDetails && (
        <div className="fixed bottom-0 left-0 w-full bg-app-card border-t border-app-muted/20 p-4 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.15)] z-40">
          <div className="flex items-center justify-between mb-3 cursor-pointer group" onClick={() => setShowCartDetails(true)}>
            <div className="flex items-center gap-2">
              <span className="text-app-primary font-medium group-hover:text-app-text transition-colors">{cartItemCount} Artikel</span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-4 text-app-primary animate-bounce"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
            </div>
            <span className="text-2xl font-bold text-app-text group-hover:scale-105 transition-transform">{total.toFixed(2).replace('.', ',')} €</span>
          </div>
          <button onClick={placeOrder} className="w-full rounded-xl bg-app-accent py-3.5 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-all hover:brightness-110">Kostenpflichtig bestellen</button>
        </div>
      )}
    </div>
  );
}

function SimpleConfetti() {
  const cR=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const c=cR.current; if(!c)return; const ctx=c.getContext("2d"); if(!ctx)return;

    const setCanvasSize=()=>{c.width=window.innerWidth;c.height=window.innerHeight;};
    setCanvasSize();
    window.addEventListener("resize",setCanvasSize);

    const css=getComputedStyle(document.body);
    const colorPrimary=(css.getPropertyValue("--primary")||"#275D7B").trim();
    const colorAccent=(css.getPropertyValue("--accent")||"#FF6633").trim();
    const colorText=(css.getPropertyValue("--text-main")||"#222222").trim();
    const colorMuted=(css.getPropertyValue("--text-muted")||"#777777").trim();
    const palette=[colorPrimary,colorAccent,colorText,colorMuted,"#ffffff"];

    type Piece={x:number;y:number;vx:number;vy:number;s:number;r:number;vr:number;c:string;shape:"rect"|"circle"};
    const p:Piece[]=[];
    for(let i=0;i<420;i++){
      p.push({
        x:Math.random()*c.width,
        y:Math.random()*c.height*0.35-c.height*0.45,
        vx:(Math.random()-0.5)*2.6,
        vy:Math.random()*4.6+2.2,
        s:Math.random()*6+4,
        r:Math.random()*Math.PI,
        vr:(Math.random()-0.5)*0.24,
        c:palette[Math.floor(Math.random()*palette.length)],
        shape:Math.random()>0.35?"rect":"circle",
      });
    }

    let id:number;
    const r=()=>{
      ctx.clearRect(0,0,c.width,c.height);
      p.forEach(pt=>{
        pt.x+=pt.vx;
        pt.y+=pt.vy;
        pt.r+=pt.vr;
        pt.vy+=0.02;

        if(pt.y>c.height+30){
          pt.y=-30;
          pt.x=Math.random()*c.width;
          pt.vy=Math.random()*4.6+2.2;
        }

        ctx.save();
        ctx.translate(pt.x,pt.y);
        ctx.rotate(pt.r);
        ctx.fillStyle=pt.c;
        if(pt.shape==="circle"){
          ctx.beginPath();
          ctx.arc(0,0,pt.s*0.5,0,Math.PI*2);
          ctx.fill();
        }else{
          ctx.fillRect(-pt.s*0.5,-pt.s*0.35,pt.s,pt.s*0.7);
        }
        ctx.restore();
      });
      id=requestAnimationFrame(r);
    };
    r();
    return()=>{cancelAnimationFrame(id);window.removeEventListener("resize",setCanvasSize);};
  },[]);
  return <canvas ref={cR} className="fixed inset-0 pointer-events-none w-full h-full"/>;
}

function StirPotAnimation() {
  return (
    <div className="mx-auto mb-5 w-[190px] h-[140px] relative pointer-events-none select-none cook-icon">
      <svg viewBox="0 0 220 170" className="w-full h-full" fill="none" aria-hidden="true">
        {/* Bewegungs-Linien statt Pfeilen */}
        <path className="cook-motion-line" d="M36 38c16-16 40-16 56 0" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <path className="cook-motion-line [animation-delay:140ms]" d="M128 38c16-16 40-16 56 0" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />

        <g className="cook-spoon">
          <path d="M142 22l-31 58" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
          <ellipse cx="106" cy="88" rx="8" ry="12" transform="rotate(26 106 88)" stroke="currentColor" strokeWidth="7" />
        </g>

        <path d="M54 96h112v48c0 10-8 18-18 18H72c-10 0-18-8-18-18V96z" stroke="currentColor" strokeWidth="8" strokeLinejoin="round"/>
        <path d="M30 108h20v24H30" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M170 108h20v24h-20" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>

        <path d="M78 168c2 7 8 7 10 0" stroke="currentColor" strokeWidth="8" strokeLinecap="round" className="cook-flame"/>
        <path d="M101 168c2 7 8 7 10 0" stroke="currentColor" strokeWidth="8" strokeLinecap="round" className="cook-flame [animation-delay:120ms]"/>
        <path d="M124 168c2 7 8 7 10 0" stroke="currentColor" strokeWidth="8" strokeLinecap="round" className="cook-flame [animation-delay:240ms]"/>
      </svg>
    </div>
  );
}
