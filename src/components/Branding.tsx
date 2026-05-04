"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Image from "next/image";

interface BrandingConfig {
  logoUrl: string;
  appName: string;
  restaurantLink?: string;
}

type RestaurantNameRow = {
  name?: string | null;
};

export const DEFAULT_BRANDING: BrandingConfig = {
  logoUrl: "",
  appName: "ordry",
};

type BrandingContextValue = {
  branding: BrandingConfig;
  loading: boolean;
};

const BrandingContext = createContext<BrandingContextValue>({
  branding: DEFAULT_BRANDING,
  loading: false,
});

export function BrandingProvider({
  initialBranding,
  children,
}: {
  initialBranding: BrandingConfig;
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const isRootPage = pathname === "/";
  const restaurantParam = params?.restaurantId;
  const restaurantId = isRootPage
    ? undefined
    : typeof restaurantParam === "string"
      ? restaurantParam
      : Array.isArray(restaurantParam)
        ? restaurantParam[0]
        : process.env.NEXT_PUBLIC_RESTAURANT_ID ?? undefined;
  const [branding, setBranding] = useState<BrandingConfig>(initialBranding);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isCurrentRestaurant = true;

    if (!restaurantId) {
      setBranding(initialBranding);
      setLoading(false);
      return () => {
        isCurrentRestaurant = false;
      };
    }

    setBranding(DEFAULT_BRANDING);
    setLoading(true);

    const loadBranding = async () => {
      try {
        let settingsQuery = supabase
          .from('settings')
          .select('key, value')
          .in('key', ['logo_url', 'app_name', 'restaurant_link']);

        if (restaurantId) {
          settingsQuery = settingsQuery.eq('restaurant_id', restaurantId);
        }

        const restaurantQuery = supabase
          .from('restaurants')
          .select('name')
          .eq('id', restaurantId)
          .maybeSingle<RestaurantNameRow>();

        const [
          { data, error },
          { data: restaurantData, error: restaurantError },
        ] = await Promise.all([settingsQuery, restaurantQuery]);

        if (error) {
          console.error("Error loading branding:", error);
          throw error;
        }

        if (restaurantError) {
          console.error("Error loading restaurant name:", restaurantError);
        }

        const config: BrandingConfig = {
          ...DEFAULT_BRANDING,
        };

        data?.forEach((setting) => {
          if (setting.key === 'logo_url') {
            config.logoUrl = setting.value;
          }
          if (setting.key === 'app_name') {
            config.appName = setting.value;
          }
          if (setting.key === 'restaurant_link') {
            config.restaurantLink = setting.value;
          }
        });

        const restaurantName = restaurantData?.name?.trim();
        if (restaurantName) {
          config.appName = restaurantName;
        }

        if (isCurrentRestaurant) {
          setBranding(config);
        }
      } catch (error) {
        console.error("Fehler beim Laden der Branding-Daten:", error);
      } finally {
        if (isCurrentRestaurant) {
          setLoading(false);
        }
      }
    };

    loadBranding();

    // Echtzeit-Updates bei Änderungen
    const settingsSubscription = supabase
      .channel(`settings-changes-${restaurantId}`)
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'settings',
          filter: `restaurant_id=eq.${restaurantId}`,
        }, 
        (payload) => {
          const newData = payload.new as { key?: string; value?: string };
          if (!newData.key || !['logo_url', 'app_name', 'restaurant_link'].includes(newData.key)) {
            return;
          }
          setBranding(prev => {
            const updated = { ...prev };
            if (newData.key === 'logo_url') {
              updated.logoUrl = newData.value || "";
            } else if (newData.key === 'app_name') {
              updated.appName = newData.value || DEFAULT_BRANDING.appName;
            } else if (newData.key === 'restaurant_link') {
              updated.restaurantLink = newData.value || undefined;
            }
            return updated;
          });
        }
      )
      .subscribe();

    const restaurantSubscription = supabase
      .channel(`restaurant-name-changes-${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'restaurants',
          filter: `id=eq.${restaurantId}`,
        },
        (payload) => {
          const newData = payload.new as { name?: string | null };
          const restaurantName = newData?.name?.trim();
          if (!restaurantName) return;
          setBranding((prev) => ({ ...prev, appName: restaurantName }));
        }
      )
      .subscribe();

    return () => {
      isCurrentRestaurant = false;
      supabase.removeChannel(settingsSubscription);
      supabase.removeChannel(restaurantSubscription);
    };
  }, [initialBranding, restaurantId]);

  return (
    <BrandingContext.Provider value={{ branding, loading }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function Logo({ className = "", width = 150, height = 50, priority = false, onClick, style }: LogoProps) {
  const { branding, loading } = useBranding();
  const [failedLogoUrl, setFailedLogoUrl] = useState("");
  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    width,
    height,
    minWidth: width,
    minHeight: height,
    aspectRatio: `${width} / ${height}`,
    ...style,
  };

  // Während des Ladens: sofort das Default-Logo statt Platzhalter anzeigen
  if (loading) {
    return (
      <div 
        className={`${className} ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
        style={wrapperStyle}
        onClick={onClick}
      >
        <Image
          src="/ordry.png"
          alt="ordry Logo"
          fill
          sizes={`${width}px`}
          className="object-contain"
          priority={priority}
        />
      </div>
    );
  }

  // Wenn ein Custom-Logo existiert: Custom-Logo verwenden
  if (branding.logoUrl && failedLogoUrl !== branding.logoUrl) {
    return (
      <div 
        className={`${className} ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
        style={wrapperStyle}
        onClick={onClick}
      >
        <img
          src={branding.logoUrl}
          alt={`${branding.appName} Logo`}
          className="w-full h-full object-contain"
          onError={() => setFailedLogoUrl(branding.logoUrl)}
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback: Ordry Default-Logo
  return (
    <div 
      className={`${className} ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      style={wrapperStyle}
      onClick={onClick}
    >
      <Image
        src="/ordry.png"
        alt="ordry Logo"
        fill
        sizes={`${width}px`}
        className="object-contain"
        priority={priority}
      />
    </div>
  );
}

interface AppNameProps {
  className?: string;
}

export function AppName({ className = "" }: AppNameProps) {
  const { branding, loading } = useBranding();

  if (loading) {
    return <span className={`${className} animate-pulse`}>ordry</span>;
  }

  return <span className={className}>{branding.appName}</span>;
}
