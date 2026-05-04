"use client";

import { useParams } from "next/navigation";
import { StaffReservationsOverview } from "@/components/StaffReservationsOverview";

export default function RestaurantWaiterReservationsPage() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;

  return <StaffReservationsOverview restaurantId={restaurantId} />;
}
