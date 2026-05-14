"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

// --- TYPEN ---
type MenuItemType = "drink" | "starter" | "main" | "dessert";

type MenuItem = {
  id: number;
  name: string;
  price: number;
  category: string;
  description: string;
  item_type?: MenuItemType | "food";
  vat_rate?: number;
  allergens?: string[] | string | null;
};

type Category = {
  id: string;
  label: string;
};

type LunchSpecialConfig = {
  enabled: boolean;
  startTime: string; // Format: "HH:MM"
  endTime: string;   // Format: "HH:MM"
  items: number[];   // IDs der Menü-Items
  itemPrices: { [itemId: number]: number }; // Spezielle Preise für Mittagskarte
  menus: LunchMenu[]; // Menü-Kombinationen
};

type LunchMenu = {
  id: string;
  name: string;
  description: string;
  itemIds: number[]; // IDs der kombinierten Items
  price: number;
};

type MenuDraft = {
  name: string;
  description: string;
  itemIds: number[];
  price: string;
};

// --- STANDARDS ---
const DEFAULT_CATEGORIES: Category[] = [
  { id: "empfehlungen", label: "Unsere Empfehlungen" },
  { id: "schmankerl", label: "Schmankerl & Suppen" },
  { id: "schnitzel", label: "Schnitzel & Hauptspeisen" },
  { id: "veggie", label: "Vegetarisch & Vegan" },
  { id: "biere", label: "Biere vom Fass" },
  { id: "drinks", label: "Alkoholfrei & Wein" },
  { id: "dessert", label: "Dessert" },
];

const ITEM_TYPE_OPTIONS: Array<{ value: MenuItemType; label: string }> = [
  { value: "drink", label: "Getränk" },
  { value: "starter", label: "Vorspeise" },
  { value: "main", label: "Hauptspeise" },
  { value: "dessert", label: "Nachtisch" },
];

const ALLERGEN_OPTIONS = [
  "Gluten (Weizen, Roggen, Hafer etc.)",
  "Krebstiere (Krabben, Garnelen etc.)",
  "Eier",
  "Fisch",
  "Erdnüsse",
  "Soja",
  "Milch (inkl. Laktose)",
  "Schalenfrüchte (Nüsse wie Mandeln, Walnüsse etc.)",
  "Sellerie",
  "Senf",
  "Sesam",
  "Schwefeldioxid & Sulfite",
  "Lupinen",
  "Weichtiere (Muscheln, Tintenfisch etc.)",
];

const stripEmojiFromText = (value: string) => value
  .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F]/gu, "")
  .replace(/\s{2,}/g, " ")
  .trim();

const createCategoryId = (label: string) => stripEmojiFromText(label)
  .toLowerCase()
  .trim()
  .replace(/ä/g, 'ae')
  .replace(/ö/g, 'oe')
  .replace(/ü/g, 'ue')
  .replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

const sanitizeCategory = (category: Category): Category => {
  const cleanedLabel = stripEmojiFromText(category.label || category.id);
  const cleanedId = category.id?.trim() || createCategoryId(cleanedLabel);

  return {
    id: cleanedId || createCategoryId(cleanedLabel) || 'kategorie',
    label: cleanedLabel || 'Kategorie',
  };
};

const normalizeAllergens = (value?: string[] | string | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (error) {
      console.warn("[Admin] Allergene konnten nicht als JSON gelesen werden", error);
    }
  }

  return trimmed.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
};

type AllergensSelectorProps = {
  selected: string[];
  onToggle: (allergen: string) => void;
  enabled: boolean;
};

const AllergensSelector = ({ selected, onToggle, enabled }: AllergensSelectorProps) => (
  <div>
    <label className="text-xs font-bold text-app-muted uppercase">Allergene</label>
    <div className={`mt-2 rounded-xl border px-4 py-3 ${enabled ? 'border-app-muted/20 bg-app-bg' : 'border-app-muted/10 bg-app-muted/5 opacity-50'}`}>
      <div className={`flex list-none items-center justify-between gap-3 text-sm font-bold ${enabled ? 'text-app-text' : 'text-app-muted'}`}>
        <span>
          Allergene auswählen
          <span className="ml-2 text-xs font-semibold text-app-muted">
            {selected.length > 0 ? `(${selected.length} gewählt)` : "(keine gewählt)"}
          </span>
        </span>
        <span className="text-xs font-semibold text-app-muted">
          {enabled ? 'Ausklappbar' : 'In Einstellungen deaktiviert'}
        </span>
      </div>
      {enabled && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-app-muted/20 bg-white px-3 py-2 text-sm font-bold text-app-text">
            <span>Liste öffnen</span>
            <span className="text-lg text-app-muted transition-transform group-open:rotate-180">⌃</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        {ALLERGEN_OPTIONS.map((allergen) => {
          const isChecked = selected.includes(allergen);
          return (
            <label
              key={allergen}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                isChecked
                  ? "border-app-primary bg-app-primary/10 text-app-text"
                  : "border-app-muted/20 bg-white text-app-muted hover:border-app-primary/40"
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(allergen)}
                className="mt-0.5 h-4 w-4 accent-app-primary"
              />
              <span>{allergen}</span>
            </label>
          );
        })}
          </div>
        </details>
      )}
    </div>
  </div>
);

const normalizeMenuItemType = (value?: string | null): MenuItemType => {
  if (value === "drink" || value === "starter" || value === "main" || value === "dessert") return value;
  if (value === "food") return "main";
  return "main";
};

const toDbItemType = (value: MenuItemType): "food" | "drink" => (value === "drink" ? "drink" : "food");

const normalizeItemTypeOverrides = (value: any): Record<string, MenuItemType> => {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, MenuItemType> = {};
  Object.entries(value).forEach(([key, raw]) => {
    result[key] = normalizeMenuItemType(String(raw));
  });
  return result;
};

const getResolvedMenuItemType = (item: MenuItem, overrides: Record<string, MenuItemType>): MenuItemType => {
  const override = overrides[String(item.id)];
  if (override) return override;
  return item.item_type === "drink" ? "drink" : "main";
};

const getMenuItemTypeLabel = (value?: string | null) => {
  const normalized = normalizeMenuItemType(value);
  return ITEM_TYPE_OPTIONS.find((option) => option.value === normalized)?.label || "Hauptspeise";
};

const getMenuItemTypeBadgeClass = (value?: string | null) => {
  const normalized = normalizeMenuItemType(value);
  if (normalized === "drink") return "bg-cyan-500/15 text-cyan-600";
  if (normalized === "starter") return "bg-violet-500/15 text-violet-600";
  if (normalized === "dessert") return "bg-pink-500/15 text-pink-600";
  return "bg-emerald-500/15 text-emerald-600";
};

export default function MenuEditor() {
  // --- STATES ---
  const [items, setItems] = useState<MenuItem[]>([]);
  const [itemTypeOverrides, setItemTypeOverrides] = useState<Record<string, MenuItemType>>({});
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [showNewItemSection, setShowNewItemSection] = useState(false);

  // BEARBEITUNGS-STATE
  const [editingId, setEditingId] = useState<number | null>(null);
  // Wir nutzen hier einen temporären State für das Formular
  const [editFormData, setEditFormData] = useState({ name: "", price: "", category: "", description: "", item_type: "main" as MenuItemType, vat_rate: "7", allergens: [] as string[] });

  // KATEGORIE-BEARBEITUNGS-STATE
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryLabel, setEditCategoryLabel] = useState("");

  // NEUES ITEM STATE
  const [newItem, setNewItem] = useState({ name: "", price: "", category: "", description: "", item_type: "main" as MenuItemType, vat_rate: "7", allergens: [] as string[] });
  const [newCatName, setNewCatName] = useState("");

  // MITTAGSKARTE STATE
  const [lunchSpecial, setLunchSpecial] = useState<LunchSpecialConfig>({
    enabled: false,
    startTime: "11:00",
    endTime: "14:30",
    items: [],
    itemPrices: {},
    menus: []
  });
  const [showCurrentMenuSection, setShowCurrentMenuSection] = useState(false);
  const [showLunchSpecialSection, setShowLunchSpecialSection] = useState(false);
  const [showLunchTimesSection, setShowLunchTimesSection] = useState(false);
  const [showLunchItemsSection, setShowLunchItemsSection] = useState(false);
  const [showMenuCreationSection, setShowMenuCreationSection] = useState(false);
  const [showCategoryManagementSection, setShowCategoryManagementSection] = useState(false);
  const [showUpsellingSection, setShowUpsellingSection] = useState(false);
  const [allergensEnabled, setAllergensEnabled] = useState(true);
  const [upsellProductIds, setUpsellProductIds] = useState<number[]>([]);
  
  // MENÜ-ERSTELLUNG STATE
  const [newMenu, setNewMenu] = useState<MenuDraft>({ name: "", description: "", itemIds: [], price: "" });
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editMenuFormData, setEditMenuFormData] = useState<MenuDraft>({ name: "", description: "", itemIds: [], price: "" });

  // --- HELPER: TOLERANTE SUCHE (Wichtig für Kategorien-Zuordnung) ---
  const normalize = (str: string) => str ? str.trim().toLowerCase() : "";
  const toggleAllergen = (current: string[], allergen: string) => (
    current.includes(allergen)
      ? current.filter((item) => item !== allergen)
      : [...current, allergen]
  );

  // --- 1. DATEN LADEN ---
  const fetchData = async () => {
    setLoading(true);

    // A) Gerichte laden
    const { data: menuData, error: menuError } = await supabase.from('menu').select('*').eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID).order('name', { ascending: true });
    if (menuError) console.error("Menu Load Error:", menuError);

    // B) Erweiterte Typen laden (aus settings)
    let overrides: Record<string, MenuItemType> = {};
    const { data: typeMapData } = await supabase.from('settings').select('value').eq('key', 'menu_item_types').eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID).single();
    if (typeMapData?.value) {
      try {
        overrides = normalizeItemTypeOverrides(JSON.parse(typeMapData.value));
      } catch (e) {
        console.error("Item Type Map Load Error:", e);
      }
    }
    setItemTypeOverrides(overrides);

    if (menuData) {
      setItems(menuData.map((item: MenuItem) => ({
        ...item,
        item_type: getResolvedMenuItemType(item, overrides),
        allergens: normalizeAllergens(item.allergens)
      })));
    }

    // C) Kategorien laden
    const { data: catData } = await supabase.from('settings').select('value').eq('key', 'menu_categories').eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID).single();
    if (catData?.value) {
      try {
        const parsed = JSON.parse(catData.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
            const sanitizedCategories = parsed.map((category: Category) => sanitizeCategory(category));
            setCategories(sanitizedCategories);
            if (JSON.stringify(parsed) !== JSON.stringify(sanitizedCategories)) {
              await saveCategoriesToDB(sanitizedCategories);
            }
            // Default Kategorie für neue Items setzen, falls noch leer
            if (!newItem.category) setNewItem(prev => ({ ...prev, category: sanitizedCategories[0].id }));
        }
      } catch(e) {}
    } else {
        // Falls noch keine Kategorien in DB -> Standards speichern
        saveCategoriesToDB(DEFAULT_CATEGORIES);
        if (!newItem.category) setNewItem(prev => ({ ...prev, category: DEFAULT_CATEGORIES[0].id }));
    }

    // D) Mittagskarte laden
    const { data: lunchData } = await supabase.from('settings').select('value').eq('key', 'lunch_special').eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID).single();
    if (lunchData?.value) {
      try {
        const parsed = JSON.parse(lunchData.value);
        // Sicherstellen, dass alle Felder existieren
        setLunchSpecial({
          enabled: parsed.enabled || false,
          startTime: parsed.startTime || "11:00",
          endTime: parsed.endTime || "14:30",
          items: parsed.items || [],
          itemPrices: parsed.itemPrices || {},
          menus: parsed.menus || []
        });
      } catch(e) {
        console.error("Lunch Special Load Error:", e);
      }
    }

    const { data: allergensEnabledData } = await supabase.from('settings').select('value').eq('key', 'allergens_enabled').eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID).single();
    if (allergensEnabledData?.value) {
      setAllergensEnabled(allergensEnabledData.value !== 'false');
    } else {
      setAllergensEnabled(true);
    }

    const { data: upsellData } = await supabase.from('settings').select('value').eq('key', 'upsell_products').eq('restaurant_id', process.env.NEXT_PUBLIC_RESTAURANT_ID).single();
    if (upsellData?.value) {
      try {
        const parsed = JSON.parse(upsellData.value);
        setUpsellProductIds(Array.isArray(parsed) ? parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id)) : []);
      } catch (error) {
        console.error('Upsell Products Load Error:', error);
        setUpsellProductIds([]);
      }
    } else {
      setUpsellProductIds([]);
    }

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);


  const saveItemTypeOverridesToDB = async (overrides: Record<string, MenuItemType>) => {
    await supabase
      .from('settings')
      .upsert({ restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID, key: 'menu_item_types', value: JSON.stringify(overrides) }, { onConflict: 'key' });
  };

  const persistItemTypeForId = async (id: number, menuItemType: MenuItemType) => {
    const nextOverrides = { ...itemTypeOverrides };
    if (menuItemType === 'starter' || menuItemType === 'dessert') nextOverrides[String(id)] = menuItemType;
    else delete nextOverrides[String(id)];

    setItemTypeOverrides(nextOverrides);
    await saveItemTypeOverridesToDB(nextOverrides);
  };

  // --- 2. LOGIK: NEUES ITEM ---
  const addItem = async () => {
    if (!newItem.name || !newItem.price) return alert("Bitte Name und Preis eingeben!");
    
    const catToUse = newItem.category || categories[0].id;
    const cleanPrice = parseFloat(newItem.price.replace(',', '.'));

    const { data, error } = await supabase.from('menu').insert({
      restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID,
      name: newItem.name,
      price: cleanPrice,
      category: catToUse,
      description: newItem.description,
      item_type: toDbItemType(newItem.item_type || "main"),
      vat_rate: parseInt(newItem.vat_rate || (newItem.item_type === "drink" ? "19" : "7")),
      allergens: newItem.allergens
    }).select('id').single();

    if (error) alert("Fehler beim Erstellen: " + error.message);
    else {
      if (data?.id) await persistItemTypeForId(data.id, newItem.item_type || "main");
      setNewItem({ ...newItem, name: "", price: "", description: "", item_type: "main", vat_rate: "7", allergens: [] });
      fetchData();
    }
  };

  // --- 3. LOGIK: BEARBEITEN (UPDATE) ---
  const startEdit = (item: MenuItem) => {
    setEditingId(item.id);
    
    // Kategorie finden (tolerant gegen Groß-/Kleinschreibung)
    let matchingCat = categories.find(c => normalize(c.id) === normalize(item.category))?.id;
    if (!matchingCat) matchingCat = categories[0].id; // Fallback

    setEditFormData({
      name: item.name,
      price: item.price.toString(),
      category: matchingCat,
      description: item.description || "",
      item_type: normalizeMenuItemType(item.item_type),
      vat_rate: (item.vat_rate !== undefined ? item.vat_rate : (normalizeMenuItemType(item.item_type) === "drink" ? 19 : 7)).toString(),
      allergens: normalizeAllergens(item.allergens)
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (id: number) => {
    console.log("Versuche zu speichern für ID:", id); // Debugging

    const cleanPrice = parseFloat(editFormData.price.replace(',', '.'));
    if (isNaN(cleanPrice)) return alert("Ungültiger Preis! Bitte Zahl eingeben.");

    // Hier passiert das Update
    const { error } = await supabase.from('menu').update({
        name: editFormData.name,
        price: cleanPrice,
        category: editFormData.category,
      description: editFormData.description,
      item_type: toDbItemType(editFormData.item_type || "main"),
      vat_rate: parseInt(editFormData.vat_rate || (editFormData.item_type === "drink" ? "19" : "7")),
      allergens: editFormData.allergens
    }).eq('id', id);

    if (error) {
        console.error("Supabase Fehler:", error);
        alert("Fehler beim Speichern: " + error.message + "\n(Code: " + error.code + ")");
    } else {
        await persistItemTypeForId(id, editFormData.item_type || "main");
        console.log("Erfolgreich gespeichert!");
        setEditingId(null); // Edit Modus beenden
        fetchData(); // Liste neu laden
    }
  };

  const deleteItem = async (id: number) => {
    if (!confirm("Gericht wirklich löschen?")) return;
    const { error } = await supabase.from('menu').delete().eq('id', id);
    if (error) alert("Löschen fehlgeschlagen: " + error.message);
    else {
      const nextOverrides = { ...itemTypeOverrides };
      delete nextOverrides[String(id)];
      setItemTypeOverrides(nextOverrides);
      await saveItemTypeOverridesToDB(nextOverrides);
      fetchData();
    }
  };

  // --- 4. LOGIK: KATEGORIEN ---
  const saveCategoriesToDB = async (cats: Category[]) => {
    const sanitizedCategories = cats.map(sanitizeCategory);
    await supabase.from('settings').upsert({ restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID, key: 'menu_categories', value: JSON.stringify(sanitizedCategories) }, { onConflict: 'key' });
  };

  const addCategory = async () => {
    const cleanedLabel = stripEmojiFromText(newCatName);
    if (!cleanedLabel) return;
    const id = createCategoryId(cleanedLabel);

    const newCats = [...categories, sanitizeCategory({ id, label: cleanedLabel })];
    setCategories(newCats);
    setNewCatName("");
    await saveCategoriesToDB(newCats);
  };

  const deleteCategory = async (idToDelete: string) => {
    if (!confirm("Kategorie entfernen? Gerichte landen dann unter 'Nicht zugeordnet'.")) return;
    const newCats = categories.filter(c => c.id !== idToDelete);
    setCategories(newCats);
    await saveCategoriesToDB(newCats);
  };

  const moveCategory = async (categoryId: string, direction: -1 | 1) => {
    const currentIndex = categories.findIndex((category) => category.id === categoryId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) return;

    const reorderedCategories = [...categories];
    const [movedCategory] = reorderedCategories.splice(currentIndex, 1);
    reorderedCategories.splice(targetIndex, 0, movedCategory);

    setCategories(reorderedCategories);
    await saveCategoriesToDB(reorderedCategories);
  };

  const startEditCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setEditCategoryLabel(category.label);
  };

  const cancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditCategoryLabel("");
  };

  const saveEditCategory = async (categoryId: string) => {
    const cleanedLabel = stripEmojiFromText(editCategoryLabel);
    if (!cleanedLabel) return alert("Bitte einen Namen eingeben!");
    
    const updatedCategories = categories.map(cat => 
      cat.id === categoryId ? sanitizeCategory({ ...cat, label: cleanedLabel }) : sanitizeCategory(cat)
    );
    
    setCategories(updatedCategories);
    await saveCategoriesToDB(updatedCategories);
    setEditingCategoryId(null);
    setEditCategoryLabel("");
  };

  // --- 5. LOGIK: MITTAGSKARTE ---
  const saveLunchSpecialToDB = async (config: LunchSpecialConfig) => {
    console.log('[Admin] Speichere Mittagskarte:', config);
    const { error } = await supabase.from('settings').upsert(
      { restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID, key: 'lunch_special', value: JSON.stringify(config) }, 
      { onConflict: 'key' }
    );
    if (error) {
      console.error('[Admin] Fehler beim Speichern der Mittagskarte:', error);
    } else {
      console.log('[Admin] Mittagskarte erfolgreich gespeichert');
    }
  };

  const saveUpsellProductsToDB = async (productIds: number[]) => {
    const { error } = await supabase.from('settings').upsert(
      { restaurant_id: process.env.NEXT_PUBLIC_RESTAURANT_ID, key: 'upsell_products', value: JSON.stringify(productIds) },
      { onConflict: 'key' }
    );

    if (error) {
      console.error('[Admin] Fehler beim Speichern der Upsell-Produkte:', error);
      alert('Upsell-Produkte konnten nicht gespeichert werden.');
    }
  };

  const toggleLunchSpecialItem = async (itemId: number) => {
    const newItems = lunchSpecial.items.includes(itemId)
      ? lunchSpecial.items.filter(id => id !== itemId)
      : [...lunchSpecial.items, itemId];
    
    const updatedConfig = { ...lunchSpecial, items: newItems };
    setLunchSpecial(updatedConfig);
    await saveLunchSpecialToDB(updatedConfig);
  };

  const updateLunchSpecialTime = async (field: 'startTime' | 'endTime', value: string) => {
    const updatedConfig = { ...lunchSpecial, [field]: value };
    setLunchSpecial(updatedConfig);
    await saveLunchSpecialToDB(updatedConfig);
  };

  const toggleLunchSpecialEnabled = async () => {
    const updatedConfig = { ...lunchSpecial, enabled: !lunchSpecial.enabled };
    console.log('[Admin] Toggle Mittagskarte:', updatedConfig.enabled ? 'AKTIVIERT' : 'DEAKTIVIERT');
    setLunchSpecial(updatedConfig);
    await saveLunchSpecialToDB(updatedConfig);
  };

  const updateItemPrice = async (itemId: number, price: string) => {
    const priceNum = parseFloat(price.replace(',', '.'));
    if (isNaN(priceNum)) return;
    
    const updatedConfig = { 
      ...lunchSpecial, 
      itemPrices: { ...lunchSpecial.itemPrices, [itemId]: priceNum }
    };
    setLunchSpecial(updatedConfig);
    await saveLunchSpecialToDB(updatedConfig);
  };

  const addMenu = async () => {
    if (!newMenu.name || !newMenu.price || newMenu.itemIds.length === 0) {
      return alert("Bitte Name, Preis und mindestens ein Gericht auswählen!");
    }

    const menuId = `menu_${Date.now()}`;
    const newMenuObj: LunchMenu = {
      id: menuId,
      name: newMenu.name,
      description: newMenu.description,
      itemIds: newMenu.itemIds,
      price: parseFloat(newMenu.price.replace(',', '.'))
    };

    const updatedConfig = {
      ...lunchSpecial,
      menus: [...lunchSpecial.menus, newMenuObj]
    };

    setLunchSpecial(updatedConfig);
    await saveLunchSpecialToDB(updatedConfig);
    setNewMenu({ name: "", description: "", itemIds: [], price: "" });
  };

  const startEditMenu = (menu: LunchMenu) => {
    setEditingMenuId(menu.id);
    setEditMenuFormData({
      name: menu.name,
      description: menu.description,
      itemIds: [...menu.itemIds],
      price: menu.price.toFixed(2).replace('.', ',')
    });
  };

  const cancelEditMenu = () => {
    setEditingMenuId(null);
    setEditMenuFormData({ name: "", description: "", itemIds: [], price: "" });
  };

  const saveEditedMenu = async (menuId: string) => {
    if (!editMenuFormData.name || !editMenuFormData.price || editMenuFormData.itemIds.length === 0) {
      return alert("Bitte Name, Preis und mindestens ein Gericht auswählen!");
    }

    const cleanPrice = parseFloat(editMenuFormData.price.replace(',', '.'));
    if (isNaN(cleanPrice)) {
      return alert("Bitte einen gültigen Menü-Preis eingeben!");
    }

    const updatedConfig = {
      ...lunchSpecial,
      menus: lunchSpecial.menus.map((menu) => (
        menu.id === menuId
          ? {
              ...menu,
              name: editMenuFormData.name,
              description: editMenuFormData.description,
              itemIds: editMenuFormData.itemIds,
              price: cleanPrice,
            }
          : menu
      ))
    };

    setLunchSpecial(updatedConfig);
    await saveLunchSpecialToDB(updatedConfig);
    cancelEditMenu();
  };

  const deleteMenu = async (menuId: string) => {
    if (!confirm("Menü wirklich löschen?")) return;
    
    const updatedConfig = {
      ...lunchSpecial,
      menus: lunchSpecial.menus.filter(m => m.id !== menuId)
    };
    setLunchSpecial(updatedConfig);
    await saveLunchSpecialToDB(updatedConfig);
  };

  const toggleMenuItemSelection = (itemId: number) => {
    const newItemIds = newMenu.itemIds.includes(itemId)
      ? newMenu.itemIds.filter(id => id !== itemId)
      : [...newMenu.itemIds, itemId];
    
    setNewMenu({ ...newMenu, itemIds: newItemIds });
  };

  const toggleUpsellProductSelection = async (itemId: number) => {
    const nextProductIds = upsellProductIds.includes(itemId)
      ? upsellProductIds.filter((id) => id !== itemId)
      : [...upsellProductIds, itemId];

    setUpsellProductIds(nextProductIds);
    await saveUpsellProductsToDB(nextProductIds);
  };

  const toggleEditMenuItemSelection = (itemId: number) => {
    const newItemIds = editMenuFormData.itemIds.includes(itemId)
      ? editMenuFormData.itemIds.filter(id => id !== itemId)
      : [...editMenuFormData.itemIds, itemId];

    setEditMenuFormData({ ...editMenuFormData, itemIds: newItemIds });
  };


  // --- HELPER FÜR ANZEIGE ---
  const getItemsByCategory = (catId: string) => {
    return items.filter(item => normalize(item.category) === normalize(catId));
  };
  const getUncategorizedItems = () => {
    const knownIds = categories.map(c => normalize(c.id));
    return items.filter(item => !knownIds.includes(normalize(item.category)));
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text p-8 font-sans pb-32">
      <div className="max-w-4xl mx-auto">
        
        {/* HEADER */}
        <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-black">Speisekarte verwalten</h1>
            <div className="flex gap-3">
                <a href="/" className="bg-app-card border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/10 font-bold transition-colors">Home</a>
                <Link href="/admin" className="bg-app-card border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/10 font-bold transition-colors">
                    ← Dashboard
                </Link>
            </div>
        </div>

        <div className="space-y-2.5">

        {/* ================= 1. NEUES GERICHT HINZUFÜGEN ================= */}
        <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowNewItemSection(!showNewItemSection)}
              className="flex w-full items-center justify-between px-6 py-5 text-left"
              aria-expanded={showNewItemSection}
            >
              <div>
                <h2 className="text-xl font-bold mb-1 text-app-text">Neues Gericht hinzufügen</h2>
                <p className="text-sm text-app-muted">Lege neue Gerichte mit Preis, Kategorie, Beschreibung und Allergenen an.</p>
              </div>
              <span
                className={`text-2xl text-app-muted transition-transform ${showNewItemSection ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                ⌃
              </span>
            </button>

            {showNewItemSection && (
              <div className="px-6 pb-6">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-5">
                      <label className="text-xs font-bold text-app-muted uppercase">Name</label>
                      <input type="text" placeholder="Name" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-accent mt-1" />
                    </div>
                    <div className="md:col-span-3">
                      <label className="text-xs font-bold text-app-muted uppercase">Kategorie</label>
                      <select value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})} className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-accent mt-1">
                          {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-bold text-app-muted uppercase">Typ</label>
                      <select value={newItem.item_type} onChange={e => setNewItem({...newItem, item_type: e.target.value as MenuItemType, vat_rate: e.target.value === "drink" ? "19" : "7"})} className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-accent mt-1">
                          {ITEM_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-bold text-app-muted uppercase">Preis (€)</label>
                      <input type="text" placeholder="0,00" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-accent mt-1" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-bold text-app-muted uppercase">MwSt</label>
                      <select value={newItem.vat_rate} onChange={e => setNewItem({...newItem, vat_rate: e.target.value})} className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-accent mt-1">
                          <option value="7">7%</option>
                          <option value="19">19%</option>
                      </select>
                    </div>
                    <div className="md:col-span-12">
                      <label className="text-xs font-bold text-app-muted uppercase">Beschreibung</label>
                      <input type="text" placeholder="Details..." value={newItem.description} onChange={e => setNewItem({...newItem, description: e.target.value})} className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-accent mt-1" />
                    </div>
                    <div className="md:col-span-12">
                      <AllergensSelector
                        selected={newItem.allergens}
                        onToggle={(allergen) => setNewItem((prev) => ({ ...prev, allergens: toggleAllergen(prev.allergens, allergen) }))}
                        enabled={allergensEnabled}
                      />
                    </div>
                </div>
                <button onClick={addItem} className="mt-6 w-full bg-app-accent text-white font-bold py-3 rounded-xl hover:scale-[1.01] transition-transform shadow-lg">Speichern</button>
              </div>
            )}
        </div>

        {/* ================= 2. AKTUELLE SPEISEKARTE (BEARBEITEN) ================= */}
        <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCurrentMenuSection(!showCurrentMenuSection)}
            className="flex w-full items-center justify-between px-6 py-5 text-left"
            aria-expanded={showCurrentMenuSection}
          >
            <div>
              <h2 className="text-xl font-bold mb-1 text-app-text">Speisekarte verwalten</h2>
              <p className="text-sm text-app-muted">Bearbeite vorhandene Gerichte, Kategorien und Zuordnungen deiner Speisekarte.</p>
            </div>
            <span
              className={`text-2xl text-app-muted transition-transform ${showCurrentMenuSection ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </button>

        {showCurrentMenuSection && (
  <div className="space-y-8 px-6 pb-6">
            {loading && <p className="text-center py-8 text-app-muted animate-pulse">Lade...</p>}

            {!loading && categories.map((category) => {
              const categoryItems = getItemsByCategory(category.id);
              if (categoryItems.length === 0) return null;

              return (
                <div key={category.id} className="bg-app-card/50 rounded-2xl p-6 border border-app-muted/10">
                  <div className="mb-4 border-b border-app-muted/10 pb-2">
                    {editingCategoryId !== category.id ? (
                      <h3 className="text-xl font-black text-app-text flex justify-between items-center group">
                        <span className="flex items-center gap-2">
                          {category.label}
                          <button 
                            onClick={() => startEditCategory(category)}
                            className="opacity-0 group-hover:opacity-100 text-app-muted hover:text-app-primary text-sm transition-opacity p-1"
                            title="Überschrift bearbeiten"
                          >
                            Bearbeiten
                          </button>
                        </span>
                        <span className="text-sm font-normal text-app-muted bg-app-bg px-2 py-1 rounded">{categoryItems.length} Artikel</span>
                      </h3>
                    ) : (
                      <div className="flex items-center gap-2 animate-in fade-in">
                        <input 
                          type="text" 
                          value={editCategoryLabel} 
                          onChange={e => setEditCategoryLabel(e.target.value)}
                          className="flex-1 p-2 rounded-lg bg-app-bg border-2 border-app-primary outline-none font-bold text-lg"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditCategory(category.id);
                            if (e.key === 'Escape') cancelEditCategory();
                          }}
                        />
                        <button 
                          onClick={() => saveEditCategory(category.id)}
                          className="bg-app-primary text-white font-bold px-4 py-2 rounded-lg hover:brightness-110 text-sm"
                        >
                          Speichern
                        </button>
                        <button 
                          onClick={cancelEditCategory}
                          className="text-app-muted hover:text-app-text font-bold px-3 py-2 text-sm"
                        >
                          Abbrechen
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    {categoryItems.map((item) => (
                      <div key={item.id} className="bg-app-card p-4 rounded-xl shadow-sm border border-app-muted/5 hover:border-app-primary transition-all group">
                          
                          {editingId !== item.id ? (
                            // --- NORMAL ANSICHT ---
                            <div className="flex items-center justify-between">
                                <div className="flex-1 pr-4">
                                    <div className="font-bold text-lg text-app-text flex items-center gap-2">
                                      {item.name}
                                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${getMenuItemTypeBadgeClass(item.item_type)}`}>
                                        {getMenuItemTypeLabel(item.item_type)}
                                      </span>
                                    </div>
                                    {item.description && <div className="text-sm text-app-muted mt-0.5">{item.description}</div>}
                                    {normalizeAllergens(item.allergens).length > 0 && (
                                      <div className="mt-1 text-xs text-app-muted">
                                        Allergene: {normalizeAllergens(item.allergens).join(", ")}
                                      </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="text-xs font-bold uppercase text-app-muted bg-app-bg px-2 py-1 rounded">
                                      MwSt: {item.vat_rate !== undefined ? `${item.vat_rate}%` : (item.item_type === "drink" ? "19%" : "7%")}
                                    </span>
                                    <span className="font-bold text-xl text-app-primary">{item.price.toFixed(2).replace('.', ',')} €</span>
                                    <button onClick={() => startEdit(item)} className="text-app-muted hover:text-app-primary p-2 rounded-lg bg-app-bg hover:bg-app-primary/10 transition-colors">Bearbeiten</button>
                                    <button onClick={() => deleteItem(item.id)} className="text-app-muted hover:text-app-danger p-2 rounded-lg hover:bg-app-danger/10 transition-colors font-bold">X</button>
                                </div>
                            </div>
                          ) : (
                            // --- EDIT FORMULAR (Hier bearbeitest du!) ---
                            <div className="flex flex-col gap-3 animate-in fade-in bg-app-primary/5 p-3 rounded-lg border border-app-primary">
                                <div className="flex gap-2">
                                    <input type="text" value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} className="flex-1 p-2 rounded bg-app-bg border border-app-primary outline-none font-bold" placeholder="Name" />
                                    <input type="text" value={editFormData.price} onChange={e => setEditFormData({...editFormData, price: e.target.value})} className="w-24 p-2 rounded bg-app-bg border border-app-primary outline-none font-bold text-right" placeholder="Preis" />
                                </div>
                                <div className="flex gap-2">
                                     <select value={editFormData.category} onChange={e => setEditFormData({...editFormData, category: e.target.value})} className="w-1/3 p-2 rounded bg-app-bg border border-app-muted/30 outline-none text-sm">
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
                                    </select>
                                    <select value={editFormData.item_type} onChange={e => setEditFormData({...editFormData, item_type: e.target.value as MenuItemType, vat_rate: e.target.value === "drink" ? "19" : "7"})} className="w-1/4 p-2 rounded bg-app-bg border border-app-muted/30 outline-none text-sm">
                                      {ITEM_TYPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                    <select value={editFormData.vat_rate} onChange={e => setEditFormData({...editFormData, vat_rate: e.target.value})} className="w-1/4 p-2 rounded bg-app-bg border border-app-muted/30 outline-none text-sm">
                                      <option value="7">7%</option>
                                      <option value="19">19%</option>
                                    </select>
                                    <input type="text" value={editFormData.description} onChange={e => setEditFormData({...editFormData, description: e.target.value})} className="flex-1 p-2 rounded bg-app-bg border border-app-muted/30 outline-none text-sm" placeholder="Beschreibung" />
                                </div>
                                <AllergensSelector
                                  selected={editFormData.allergens}
                                  onToggle={(allergen) => setEditFormData((prev) => ({ ...prev, allergens: toggleAllergen(prev.allergens, allergen) }))}
                                  enabled={allergensEnabled}
                                />
                                <div className="flex justify-end gap-2 mt-1">
                                    <button onClick={cancelEdit} className="text-xs font-bold text-app-muted px-3 py-2 hover:text-app-text">Abbrechen</button>
                                    <button onClick={() => saveEdit(item.id)} className="text-xs font-bold bg-app-primary text-white px-4 py-2 rounded hover:brightness-110">Speichern</button>
                                </div>
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* UNKATEGORISIERTE ITEMS */}
            {!loading && getUncategorizedItems().length > 0 && (
                <div className="bg-app-danger/5 rounded-2xl p-6 border-2 border-app-danger border-dashed">
                  <h3 className="text-xl font-black text-app-danger mb-4 flex items-center gap-2">
                    Nicht zugeordnet <span className="text-sm font-normal text-app-muted">(Kategorie prüfen!)</span>
                  </h3>
                  <div className="space-y-3">
                    {getUncategorizedItems().map((item) => (
                       <div key={item.id} className="bg-white/50 rounded-lg border border-app-danger/20 p-2">
                          {editingId !== item.id ? (
                              <div className="flex justify-between items-center p-2">
                                  <div>
                                    <span className="font-bold block">{item.name}</span>
                                    <span className="text-xs text-app-danger">Falsche Kategorie: "{item.category}"</span>
                                  </div>
                                  <div className="flex gap-2">
                                     <button onClick={() => startEdit(item)} className="text-white bg-app-primary px-4 py-2 rounded font-bold text-sm hover:brightness-110">Korrigieren</button>
                                     <button onClick={() => deleteItem(item.id)} className="text-app-danger font-bold text-sm px-2 hover:bg-app-danger/10 rounded">Löschen</button>
                                  </div>
                              </div>
                          ) : (
                              // Edit Formular auch hier anzeigen!
                              <div className="flex flex-col gap-3 animate-in fade-in bg-white p-3 rounded border border-app-primary shadow-lg">
                                <div className="text-xs font-bold text-app-primary uppercase mb-1">Gericht korrigieren</div>
                                <div className="flex gap-2">
                                    <input type="text" value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} className="flex-1 p-2 rounded bg-app-bg border border-app-muted/30 outline-none font-bold" />
                                    <input type="text" value={editFormData.price} onChange={e => setEditFormData({...editFormData, price: e.target.value})} className="w-24 p-2 rounded bg-app-bg border border-app-muted/30 outline-none font-bold text-right" />
                                </div>
                                <div className="flex gap-2">
                                     <select autoFocus value={editFormData.category} onChange={e => setEditFormData({...editFormData, category: e.target.value})} className="w-1/2 p-2 rounded bg-app-bg border-2 border-app-primary outline-none font-bold text-app-primary">
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
                                    </select>
                                    <select value={editFormData.item_type} onChange={e => setEditFormData({...editFormData, item_type: e.target.value as MenuItemType, vat_rate: e.target.value === "drink" ? "19" : "7"})} className="w-1/4 p-2 rounded bg-app-bg border-2 border-app-primary outline-none font-bold text-app-primary">
                                      {ITEM_TYPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                    <select value={editFormData.vat_rate} onChange={e => setEditFormData({...editFormData, vat_rate: e.target.value})} className="w-1/4 p-2 rounded bg-app-bg border-2 border-app-primary outline-none font-bold text-app-primary">
                                      <option value="7">7%</option>
                                      <option value="19">19%</option>
                                    </select>
                                </div>
                                <AllergensSelector
                                  selected={editFormData.allergens}
                                  onToggle={(allergen) => setEditFormData((prev) => ({ ...prev, allergens: toggleAllergen(prev.allergens, allergen) }))}
                                  enabled={allergensEnabled}
                                />
                                <div className="flex justify-end gap-2 mt-1">
                                    <button onClick={cancelEdit} className="text-xs font-bold text-app-muted px-3 py-2">Abbrechen</button>
                                    <button onClick={() => saveEdit(item.id)} className="text-xs font-bold bg-app-primary text-white px-4 py-2 rounded shadow hover:brightness-110">Speichern & Zuordnen</button>
                                </div>
                            </div>
                          )}
                       </div>
                    ))}
                  </div>
                </div>
            )}
        </div>
        )}
        </div>

        {/* ================= 3. MITTAGSKARTE VERWALTEN ================= */}
        <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLunchSpecialSection(!showLunchSpecialSection)}
            className="flex w-full items-center justify-between px-6 py-5 text-left"
            aria-expanded={showLunchSpecialSection}
          >
            <div>
              <h2 className="text-xl font-bold mb-1 text-app-text">
                Mittagskarte / Tagesangebote verwalten
              </h2>
              <p className="text-sm text-app-muted">
                Hierzu gehören Zeiten einstellen, Aktivierung, Angebotsgerichte und Menüs.
              </p>
            </div>
            <span
              className={`text-2xl text-app-muted transition-transform ${showLunchSpecialSection ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </button>

            {showLunchSpecialSection && (
      <div className="space-y-6 px-6 pb-6">
        <div className="space-y-6 rounded-3xl border border-app-primary/15 bg-app-primary/5 p-4 md:p-6">
                    {/* ZEITEINSTELLUNGEN */}
              <div className="bg-app-card rounded-2xl shadow-lg border border-app-muted/20">
                <button
                  type="button"
                  onClick={() => setShowLunchTimesSection(!showLunchTimesSection)}
                  className="flex w-full items-center justify-between p-6 text-left"
                  aria-expanded={showLunchTimesSection}
                >
                  <div>
                        <h3 className="text-lg font-bold mb-1">Zeiten einstellen</h3>
                    <p className="text-sm text-app-muted">Lege fest, wann die Mittagskarte automatisch angezeigt wird</p>
                  </div>
                  <span
                    className={`text-2xl text-app-muted transition-transform ${showLunchTimesSection ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  >
                    ⌃
                  </span>
                </button>

                {showLunchTimesSection && (
                  <div className="px-6 pb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-app-muted uppercase block mb-2">Start-Zeit</label>
                        <input 
                          type="time" 
                          value={lunchSpecial.startTime}
                          onChange={(e) => updateLunchSpecialTime('startTime', e.target.value)}
                          className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-primary font-mono text-lg"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-app-muted uppercase block mb-2">End-Zeit</label>
                        <input 
                          type="time" 
                          value={lunchSpecial.endTime}
                          onChange={(e) => updateLunchSpecialTime('endTime', e.target.value)}
                          className="w-full p-3 rounded-lg bg-app-bg border border-app-muted/20 outline-none focus:border-app-primary font-mono text-lg"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <div className="bg-app-primary/10 border border-app-primary/30 rounded-lg p-4">
                          <p className="text-sm font-bold text-app-primary">
                                                Mittagskarte wird angezeigt: {lunchSpecial.startTime} - {lunchSpecial.endTime} Uhr
                          </p>
                          <p className="text-xs text-app-muted mt-2">
                            Aktuelle Zeit: {new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                    </div>

                    {/* AKTIVIERUNGS-TOGGLE */}
              <div className="bg-app-card p-6 rounded-2xl shadow-lg border border-app-muted/20">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-app-muted/15 bg-app-bg px-4 py-4">
                  <div>
                    <h3 className="text-lg font-bold mb-1">Mittagskarte aktivieren</h3>
                    <p className="text-sm text-app-muted">Schaltet die Mittagskarte im eingestellten Zeitfenster automatisch ein.</p>
                  </div>
                  <button 
                    onClick={toggleLunchSpecialEnabled}
                    className={`relative w-16 h-8 rounded-full transition-colors border-2 ${
                      lunchSpecial.enabled 
                        ? 'bg-app-primary border-app-primary' 
                        : 'bg-gray-300 border-gray-400'
                    }`}
                    aria-label={lunchSpecial.enabled ? 'Mittagskarte deaktivieren' : 'Mittagskarte aktivieren'}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform shadow-md ${
                      lunchSpecial.enabled ? 'translate-x-8' : ''
                    }`} />
                  </button>
                </div>
              </div>

                    {/* GERICHTE AUSWÄHLEN & PREISE ÄNDERN */}
              <div className="bg-app-card rounded-2xl shadow-lg border border-app-muted/20">
                <button
                  type="button"
                  onClick={() => setShowLunchItemsSection(!showLunchItemsSection)}
                  className="flex w-full items-center justify-between p-6 text-left"
                  aria-expanded={showLunchItemsSection}
                >
                  <div>
                                <h3 className="text-lg font-bold mb-1">Gerichte auswählen & Angebotspreise festlegen</h3>
                    <p className="text-sm text-app-muted">Wähle Gerichte aus und setze spezielle Mittagspreise (optional)</p>
                  </div>
                  <span
                    className={`text-2xl text-app-muted transition-transform ${showLunchItemsSection ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  >
                    ⌃
                  </span>
                </button>

                {showLunchItemsSection && (
                  <div className="px-6 pb-6">
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {items.map((item) => {
                        const isSelected = lunchSpecial.items.includes(item.id);
                        const specialPrice = lunchSpecial.itemPrices[item.id];
                        return (
                          <div 
                            key={item.id}
                            className={`p-4 rounded-lg border-2 transition-all ${
                              isSelected 
                                ? 'bg-app-primary/10 border-app-primary' 
                                : 'bg-app-bg border-app-muted/20'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div 
                                className="flex-1 cursor-pointer"
                                onClick={() => toggleLunchSpecialItem(item.id)}
                              >
                                <div className="font-bold text-app-text">{item.name}</div>
                                {item.description && (
                                  <div className="text-sm text-app-muted mt-0.5">{item.description}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                {isSelected && (
                                  <div className="flex items-center gap-2">
                                    <div className="text-right">
                                      <div className="text-xs text-app-muted line-through">
                                        {item.price.toFixed(2).replace('.', ',')} €
                                      </div>
                                      <input
                                        type="text"
                                        placeholder="Angebot"
                                        value={specialPrice !== undefined ? specialPrice.toString().replace('.', ',') : ''}
                                        onChange={(e) => updateItemPrice(item.id, e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-20 px-2 py-1 text-sm rounded bg-app-accent/10 border border-app-accent outline-none text-right font-bold"
                                      />
                                    </div>
                                  </div>
                                )}
                                {!isSelected && (
                                  <span className="font-bold text-app-muted">{item.price.toFixed(2).replace('.', ',')} €</span>
                                )}
                                <div 
                                  className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer ${
                                    isSelected ? 'bg-app-primary border-app-primary' : 'border-app-muted/30'
                                  }`}
                                  onClick={() => toggleLunchSpecialItem(item.id)}
                                >
                                                            {isSelected && <span className="text-white font-bold">•</span>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {lunchSpecial.items.length > 0 && (
                      <div className="mt-4 p-4 bg-app-primary/5 rounded-lg border border-app-primary/20">
                        <p className="text-sm font-bold text-app-primary">
                                            {lunchSpecial.items.length} Gerichte ausgewählt
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

                    {/* MENÜS ERSTELLEN */}
                    <div className="bg-app-card rounded-2xl shadow-lg border border-app-muted/20">
                      <button
                        type="button"
                        onClick={() => setShowMenuCreationSection(!showMenuCreationSection)}
                        className="flex w-full items-center justify-between p-6 text-left"
                        aria-expanded={showMenuCreationSection}
                      >
                        <div>
                          <h3 className="text-lg font-bold mb-1">Menüs erstellen (Kombinationen)</h3>
                          <p className="text-sm text-app-muted">Erstelle Kombi-Angebote (z.B. Schnitzel + Bier)</p>
                        </div>
                        <span
                          className={`text-2xl text-app-muted transition-transform ${showMenuCreationSection ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        >
                          ⌃
                        </span>
                      </button>

                      {showMenuCreationSection && (
                        <div className="px-6 pb-6">
                          {/* NEUES MENÜ ERSTELLEN */}
                          <div className="bg-app-bg p-4 rounded-lg border border-app-muted/20 mb-6">
                            <h4 className="font-bold mb-4 text-app-text">Neues Menü</h4>
                            <div className="space-y-3">
                              <div>
                                <label className="text-xs font-bold text-app-muted uppercase block mb-1">Menü-Name</label>
                                <input 
                                  type="text" 
                                  placeholder="z.B. Schnitzel-Menü"
                                  value={newMenu.name}
                                  onChange={(e) => setNewMenu({...newMenu, name: e.target.value})}
                                  className="w-full p-2 rounded bg-white border border-app-muted/30 outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-xs font-bold text-app-muted uppercase block mb-1">Beschreibung</label>
                                <input 
                                  type="text" 
                                  placeholder="z.B. Wiener Schnitzel mit 0,5l Bier"
                                  value={newMenu.description}
                                  onChange={(e) => setNewMenu({...newMenu, description: e.target.value})}
                                  className="w-full p-2 rounded bg-white border border-app-muted/30 outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-xs font-bold text-app-muted uppercase block mb-2">Gerichte auswählen</label>
                                <div className="space-y-1 max-h-48 overflow-y-auto bg-app-bg p-2 rounded">
                                  {items.length > 0 ? items.map((item) => {
                                    const isInMenu = newMenu.itemIds.includes(item.id);
                                    return (
                                      <div 
                                        key={item.id}
                                        onClick={() => toggleMenuItemSelection(item.id)}
                                        className={`p-2 rounded cursor-pointer flex items-center justify-between ${
                                          isInMenu ? 'bg-app-accent/20 border border-app-accent' : 'bg-white border border-app-muted/10 hover:border-app-muted/30'
                                        }`}
                                      >
                                        <div className="flex-1">
                                          <span className="text-sm font-bold">{item.name}</span>
                                          <span className="text-xs text-app-muted ml-2">
                                            ({item.price.toFixed(2).replace('.', ',')} €)
                                          </span>
                                        </div>
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${
                                          isInMenu ? 'bg-app-accent border-app-accent text-white' : 'border-app-muted/30'
                                        }`}>
                                          {isInMenu && '•'}
                                        </div>
                                      </div>
                                    );
                                  }) : (
                                    <p className="text-sm text-app-muted text-center py-4">Keine Gerichte verfügbar</p>
                                  )}
                                </div>
                              </div>
                              <div>
                                <label className="text-xs font-bold text-app-muted uppercase block mb-1">Menü-Preis (€)</label>
                                <input 
                                  type="text" 
                                  placeholder="12,90"
                                  value={newMenu.price}
                                  onChange={(e) => setNewMenu({...newMenu, price: e.target.value})}
                                  className="w-full p-2 rounded bg-white border border-app-muted/30 outline-none"
                                />
                              </div>
                              <button 
                                onClick={addMenu}
                                className="w-full bg-app-accent text-white font-bold py-2 rounded-lg hover:brightness-110"
                              >
                                Menü hinzufügen
                              </button>
                            </div>
                          </div>

                          {/* VORHANDENE MENÜS */}
                          {lunchSpecial.menus.length > 0 && (
                            <div className="space-y-3">
                              <h4 className="font-bold text-app-text">Aktive Menüs</h4>
                              {lunchSpecial.menus.map((menu) => (
                                <div key={menu.id} className="bg-app-accent/10 p-4 rounded-lg border-2 border-app-accent">
                                  {editingMenuId === menu.id ? (
                                    <div className="space-y-3">
                                      <div>
                                        <label className="text-xs font-bold text-app-muted uppercase block mb-1">Menü-Name</label>
                                        <input
                                          type="text"
                                          value={editMenuFormData.name}
                                          onChange={(e) => setEditMenuFormData({ ...editMenuFormData, name: e.target.value })}
                                          className="w-full p-2 rounded bg-white border border-app-muted/30 outline-none"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-xs font-bold text-app-muted uppercase block mb-1">Beschreibung</label>
                                        <input
                                          type="text"
                                          value={editMenuFormData.description}
                                          onChange={(e) => setEditMenuFormData({ ...editMenuFormData, description: e.target.value })}
                                          className="w-full p-2 rounded bg-white border border-app-muted/30 outline-none"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-xs font-bold text-app-muted uppercase block mb-2">Gerichte im Menü</label>
                                        <div className="space-y-1 max-h-48 overflow-y-auto bg-app-bg p-2 rounded">
                                          {items.length > 0 ? items.map((item) => {
                                            const isInMenu = editMenuFormData.itemIds.includes(item.id);
                                            return (
                                              <div
                                                key={item.id}
                                                onClick={() => toggleEditMenuItemSelection(item.id)}
                                                className={`p-2 rounded cursor-pointer flex items-center justify-between ${
                                                  isInMenu ? 'bg-app-accent/20 border border-app-accent' : 'bg-white border border-app-muted/10 hover:border-app-muted/30'
                                                }`}
                                              >
                                                <div className="flex-1">
                                                  <span className="text-sm font-bold">{item.name}</span>
                                                  <span className="text-xs text-app-muted ml-2">
                                                    ({item.price.toFixed(2).replace('.', ',')} €)
                                                  </span>
                                                </div>
                                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${
                                                  isInMenu ? 'bg-app-accent border-app-accent text-white' : 'border-app-muted/30'
                                                }`}>
                                                  {isInMenu && '•'}
                                                </div>
                                              </div>
                                            );
                                          }) : (
                                            <p className="text-sm text-app-muted text-center py-4">Keine Gerichte verfügbar</p>
                                          )}
                                        </div>
                                      </div>
                                      <div>
                                        <label className="text-xs font-bold text-app-muted uppercase block mb-1">Menü-Preis (€)</label>
                                        <input
                                          type="text"
                                          value={editMenuFormData.price}
                                          onChange={(e) => setEditMenuFormData({ ...editMenuFormData, price: e.target.value })}
                                          className="w-full p-2 rounded bg-white border border-app-muted/30 outline-none"
                                        />
                                      </div>
                                      <div className="flex gap-2 justify-end">
                                        <button
                                          onClick={cancelEditMenu}
                                          className="px-4 py-2 rounded-lg border border-app-muted/30 bg-white font-bold text-app-muted hover:bg-app-muted/10"
                                        >
                                          Abbrechen
                                        </button>
                                        <button
                                          onClick={() => saveEditedMenu(menu.id)}
                                          className="px-4 py-2 rounded-lg bg-app-accent text-white font-bold hover:brightness-110"
                                        >
                                          Änderungen speichern
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex justify-between items-start mb-2 gap-3">
                                        <div className="flex-1">
                                          <h5 className="font-bold text-app-text">{menu.name}</h5>
                                          <p className="text-sm text-app-muted">{menu.description}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-lg text-app-accent">{menu.price.toFixed(2).replace('.', ',')} €</span>
                                          <button
                                            onClick={() => startEditMenu(menu)}
                                            className="text-app-primary hover:bg-app-primary/10 px-2 py-1 rounded font-bold"
                                          >
                                            Bearbeiten
                                          </button>
                                          <button 
                                            onClick={() => deleteMenu(menu.id)}
                                            className="text-app-danger hover:bg-app-danger/10 px-2 py-1 rounded font-bold"
                                          >
                                            X
                                          </button>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {menu.itemIds.map(itemId => {
                                          const item = items.find(i => i.id === itemId);
                                          return item ? (
                                            <span key={itemId} className="text-xs bg-white px-2 py-1 rounded border border-app-muted/30">
                                              {item.name}
                                            </span>
                                          ) : null;
                                        })}
                                      </div>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                        </div>
                      )}
                    </div>
                  </div>
                </div>
            )}
        </div>

        {/* ================= 5. UPSELLING VERWALTEN ================= */}
        <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowUpsellingSection(!showUpsellingSection)}
            className="flex w-full items-center justify-between px-6 py-5 text-left"
            aria-expanded={showUpsellingSection}
          >
            <div className="flex items-start justify-between gap-3 w-full">
              <div>
                <h2 className="text-xl font-bold mb-1 text-app-text">Upselling verwalten</h2>
                <p className="text-sm text-app-muted">Wähle die Produkte aus, aus denen im Gastbereich immer 2 zufällige Upsell-Vorschläge angezeigt werden.</p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                <span className="text-xs font-bold text-app-accent bg-app-accent/10 px-2 py-1 rounded-full whitespace-nowrap">
                  {upsellProductIds.length} gewählt
                </span>
                <span
                  className={`text-2xl text-app-muted transition-transform ${showUpsellingSection ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                >
                  ⌃
                </span>
              </div>
            </div>
          </button>
          {showUpsellingSection && (
            <div className="px-6 pb-6">
              <div className="space-y-1 max-h-72 overflow-y-auto bg-app-bg p-2 rounded-lg border border-app-muted/20">
                {items.length > 0 ? items.map((item) => {
                  const isSelected = upsellProductIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => void toggleUpsellProductSelection(item.id)}
                      className={`p-2 rounded cursor-pointer flex items-center justify-between ${
                        isSelected ? 'bg-app-primary/15 border border-app-primary' : 'bg-white border border-app-muted/10 hover:border-app-muted/30'
                      }`}
                    >
                      <div className="flex-1">
                        <span className="text-sm font-bold text-app-text">{item.name}</span>
                        <span className="text-xs text-app-muted ml-2">
                          ({item.price.toFixed(2).replace('.', ',')} €)
                        </span>
                      </div>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${
                        isSelected ? 'bg-app-primary border-app-primary text-white' : 'border-app-muted/30'
                      }`}>
                        {isSelected && '•'}
                      </div>
                    </div>
                  );
                }) : (
                  <p className="text-sm text-app-muted text-center py-4">Keine Gerichte verfügbar</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ================= 4. KATEGORIEN VERWALTEN ================= */}
        <div className="bg-app-card border border-app-muted/20 rounded-2xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCategoryManagementSection(!showCategoryManagementSection)}
            className="flex w-full items-center justify-between px-6 py-5 text-left"
            aria-expanded={showCategoryManagementSection}
          >
            <div>
              <h2 className="text-xl font-bold mb-1 text-app-text">Kategorien verwalten</h2>
              <p className="text-sm text-app-muted">Erstelle, sortiere, prüfe und entferne Kategorien für deine Speisekarte.</p>
            </div>
            <span
              className={`text-2xl text-app-muted transition-transform ${showCategoryManagementSection ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </button>

          {showCategoryManagementSection && (
            <div className="p-6">
              <div className="flex gap-4 mb-8">
                <input type="text" placeholder="Neue Kategorie (z.B. Heißgetränke)" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} className="flex-1 p-3 rounded-xl bg-app-bg border border-app-muted/20 outline-none focus:border-app-primary" />
                <button onClick={addCategory} className="bg-app-primary text-white font-bold px-6 rounded-xl hover:brightness-110">Hinzufügen</button>
              </div>
              <div className="space-y-3">
                {categories.map((cat, index) => (
                  <div key={cat.id} className="flex flex-col gap-3 rounded-xl border border-app-muted/10 bg-app-bg p-4 md:flex-row md:items-center md:justify-between">
                    {editingCategoryId === cat.id ? (
                      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
                        <input
                          autoFocus
                          value={editCategoryLabel}
                          onChange={(event) => setEditCategoryLabel(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveEditCategory(cat.id);
                            if (event.key === 'Escape') cancelEditCategory();
                          }}
                          className="w-full rounded-lg border border-app-primary bg-app-card px-3 py-2 font-bold text-app-text outline-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => saveEditCategory(cat.id)} className="rounded-lg bg-app-primary px-4 py-2 text-sm font-bold text-white hover:brightness-110">Speichern</button>
                          <button onClick={cancelEditCategory} className="rounded-lg border border-app-muted/20 px-4 py-2 text-sm font-bold text-app-muted hover:bg-app-muted/10">Abbrechen</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <span className="block truncate text-lg font-bold text-app-text">{cat.label}</span>
                          <span className="text-xs font-semibold text-app-muted">Position {index + 1}</span>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => moveCategory(cat.id, -1)}
                            disabled={index === 0}
                            className="h-9 w-9 rounded-lg border border-app-muted/20 text-app-muted hover:border-app-primary hover:text-app-primary disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={`${cat.label} nach oben verschieben`}
                            title="Nach oben"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveCategory(cat.id, 1)}
                            disabled={index === categories.length - 1}
                            className="h-9 w-9 rounded-lg border border-app-muted/20 text-app-muted hover:border-app-primary hover:text-app-primary disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={`${cat.label} nach unten verschieben`}
                            title="Nach unten"
                          >
                            ↓
                          </button>
                          <button onClick={() => startEditCategory(cat)} className="rounded-lg border border-app-muted/20 px-3 py-2 text-sm font-bold text-app-muted hover:border-app-primary hover:text-app-primary">Bearbeiten</button>
                          <button onClick={() => deleteCategory(cat.id)} className="rounded-lg border border-app-danger/20 px-3 py-2 text-sm font-bold text-app-danger hover:bg-app-danger/10">Löschen</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        </div>

      </div>
    </div>
  );
}
