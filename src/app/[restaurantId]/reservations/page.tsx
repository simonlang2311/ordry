"use client";

import { useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import ReservationsPage from "@/app/reservations/page";
import { DEFAULT_RESTAURANT_FEATURES, RestaurantFeatures, loadRestaurantFeatures } from "@/lib/features";

export default function RestaurantReservationsPage() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;
  const [features, setFeatures] = useState<RestaurantFeatures | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadFeatures = async () => {
      const nextFeatures = await loadRestaurantFeatures(restaurantId);
      if (isActive) setFeatures(nextFeatures);
    };

    void loadFeatures();

    return () => {
      isActive = false;
    };
  }, [restaurantId]);

  if (!features) {
    return <div className="min-h-screen bg-app-bg text-app-text" />;
  }

  if (!(features || DEFAULT_RESTAURANT_FEATURES).reservationsEnabled) {
    notFound();
  }

  return <ReservationsPage />;
}
