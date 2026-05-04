"use client";

import { StaffReservationsOverview } from "@/components/StaffReservationsOverview";

export default function WaiterReservationsPage() {
  return <StaffReservationsOverview restaurantId={process.env.NEXT_PUBLIC_RESTAURANT_ID || "demo-restaurant-1"} />;
}
