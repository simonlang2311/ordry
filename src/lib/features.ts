import { supabase } from "@/lib/supabase";

export type RestaurantFeatures = {
  tableLimit: number;
  upsellingEnabled: boolean;
  reservationsEnabled: boolean;
  statisticsEnabled: boolean;
  themesLockedToOrdry: boolean;
};

export const RESTAURANT_FEATURES_KEY = "restaurant_features";

export const DEFAULT_RESTAURANT_FEATURES: RestaurantFeatures = {
  tableLimit: 20,
  upsellingEnabled: true,
  reservationsEnabled: true,
  statisticsEnabled: true,
  themesLockedToOrdry: false,
};

export const parseRestaurantFeatures = (value?: string | null): RestaurantFeatures => {
  if (!value) return DEFAULT_RESTAURANT_FEATURES;

  try {
    const parsed = JSON.parse(value) as Partial<RestaurantFeatures>;
    return {
      tableLimit: Number.isFinite(Number(parsed.tableLimit))
        ? Math.max(0, Math.floor(Number(parsed.tableLimit)))
        : DEFAULT_RESTAURANT_FEATURES.tableLimit,
      upsellingEnabled: parsed.upsellingEnabled ?? DEFAULT_RESTAURANT_FEATURES.upsellingEnabled,
      reservationsEnabled: parsed.reservationsEnabled ?? DEFAULT_RESTAURANT_FEATURES.reservationsEnabled,
      statisticsEnabled: parsed.statisticsEnabled ?? DEFAULT_RESTAURANT_FEATURES.statisticsEnabled,
      themesLockedToOrdry: parsed.themesLockedToOrdry ?? DEFAULT_RESTAURANT_FEATURES.themesLockedToOrdry,
    };
  } catch {
    return DEFAULT_RESTAURANT_FEATURES;
  }
};

export const loadRestaurantFeatures = async (restaurantId: string): Promise<RestaurantFeatures> => {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("restaurant_id", restaurantId)
    .eq("key", RESTAURANT_FEATURES_KEY)
    .maybeSingle();

  if (error) {
    console.error("Restaurant-Features konnten nicht geladen werden:", error);
  }

  return parseRestaurantFeatures(data?.value);
};

export const saveRestaurantFeatures = async (
  restaurantId: string,
  features: RestaurantFeatures
) => {
  return supabase
    .from("settings")
    .upsert(
      {
        restaurant_id: restaurantId,
        key: RESTAURANT_FEATURES_KEY,
        value: JSON.stringify(features),
      },
      { onConflict: "restaurant_id,key" }
    );
};
