"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AdminDashboardGate from "@/components/AdminDashboardGate";
import { supabase } from "@/lib/supabase";

const restaurantId = process.env.NEXT_PUBLIC_RESTAURANT_ID || "demo-restaurant-1";

const adminSections = [
  {
    href: "/admin/menu",
    title: "Speisekarte bearbeiten",
    description: "Gerichte hinzufügen, Preise ändern oder löschen.",
  },
  {
    href: "/admin/reservationsinsights",
    title: "Reservierungen",
    description: "Alle Buchungen ansehen, Statistiken & Stornierung.",
  },
  {
    href: "/admin/statistics",
    title: "Statistiken",
    description: "Detaillierte Analyse der Bestellungen & Gerichte.",
  },
  {
    href: "/admin/qr",
    title: "QR-Code Generator",
    description: "QR-Codes für Tische erstellen & herunterladen.",
  },
  {
    href: "/admin/personal",
    title: "Personalisierung",
    description: "Logo hochladen & Design anpassen.",
  },
  {
    href: "/admin/settings",
    title: "Einstellungen",
    description: "Getränke-Zuordnung & Personal-Passwort.",
  },
];

function AdminContent() {
  const [restaurantName, setRestaurantName] = useState("");

  useEffect(() => {
    let isActive = true;

    const loadRestaurantName = async () => {
      const { data } = await supabase
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .maybeSingle();

      if (isActive) setRestaurantName(data?.name || restaurantId);
    };

    void loadRestaurantName();

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-app-bg text-app-text p-8 transition-colors duration-500 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black mb-2">{restaurantName || restaurantId}</h1>
            <p className="text-app-muted">Hier steuerst du das Design und die Inhalte.</p>
          </div>
          <div className="flex items-center gap-4">
            <a href="/" className="bg-app-card text-app-text border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/20 transition-colors">Home</a>
          </div>
        </header>

        {/* --- 1. VERWALTUNG --- */}
        <section className="mb-12">
            <h2 className="text-2xl font-bold mb-6 border-b border-app-muted/20 pb-2">Verwaltung</h2>
            <div className="space-y-2.5">
                {adminSections.map((section) => (
                  <Link
                    key={section.href}
                    href={section.href}
                    className="flex items-center justify-between gap-4 rounded-2xl bg-app-card border border-app-muted/20 shadow-lg px-5 py-4 hover:border-app-primary transition-colors"
                    aria-label={`${section.title} öffnen`}
                  >
                    <span className="text-2xl font-bold text-app-text hover:text-app-primary transition-colors">
                      {section.title}
                    </span>

                    <span className="shrink-0 w-10 h-10 rounded-full bg-app-bg flex items-center justify-center text-2xl text-app-text hover:bg-app-primary hover:text-white transition-colors">
                      →
                    </span>
                  </Link>
                ))}
            </div>
        </section>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <ProtectedRoute>
      <AdminDashboardGate restaurantId={restaurantId} homeHref="/">
        <AdminContent />
      </AdminDashboardGate>
    </ProtectedRoute>
  );
}
