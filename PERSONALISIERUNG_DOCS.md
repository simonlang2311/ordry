# 🎨 Personalisierungs-System

## Setup-Anleitung

### 1. Datenbank & Storage einrichten

1. Gehe zu deinem **Supabase Dashboard**
2. Öffne den **SQL Editor**
3. Kopiere den kompletten Inhalt aus `supabase-personalization-setup.sql`
4. Führe das SQL-Script aus (grüner "Run" Button)

Das Script erstellt:
- ✅ Storage Bucket für Logos
- ✅ Notwendige Policies
- ✅ Settings-Tabelle mit Personalisierungsfeldern

### 2. Personalisierungsseite nutzen

1. Starte deine App: `npm run dev`
2. Gehe zu `/admin/personal`
3. Jetzt kannst du:
   - 📷 Logo hochladen (PNG/JPG/SVG, max. 2MB)
   - 🏷️ Restaurant-Namen ändern
   - 🎨 Design-Theme wählen
   - 🎨 Farben anpassen

## Logo im gesamten System verwenden

### Einfache Verwendung mit der Logo-Komponente:

```tsx
import { Logo, AppName } from "@/components/Branding";

// In deiner Komponente:
<Logo width={150} height={50} priority />
<AppName className="text-2xl font-bold" />
```

### Beispiel - Update deiner Startseite:

```tsx
// src/app/page.tsx
import { Logo, AppName } from "@/components/Branding";

export default function HomePage() {
  return (
    <div>
      <header className="p-6">
        <Logo width={150} height={50} priority />
        <h1 className="text-3xl font-bold mt-4">
          Willkommen bei <AppName />
        </h1>
      </header>
    </div>
  );
}
```

## Technische Details

### Performance

✅ **Sehr performant durch:**
- Supabase CDN (Edge-Caching weltweit)
- Next.js Image-Optimierung
- Ladezeit: ~10-50ms
- Browser-Caching
- Keine zusätzlichen API-Calls pro Komponente

### Datenbank-Struktur

```sql
settings
├── key (text, primary key)
├── value (text)
└── updated_at (timestamp)

Einträge:
- logo_url: URL zum Logo in Supabase Storage
- app_name: Name deines Restaurants
- primary_color: Hex-Farbe (#6366f1)
- secondary_color: Hex-Farbe (#8b5cf6)
- theme: modern/elegant/vibrant/nature
```

### Storage-Struktur

```
Storage Bucket: logos
├── logo-1234567890.png
├── logo-1234567891.jpg
└── ...

Eigenschaften:
- Public Bucket (CDN-cached)
- Max. 2MB pro Datei
- Unterstützt: PNG, JPG, SVG, WebP
```

## Features

### 1. Logo-Upload
- Drag & Drop oder Dateiauswahl
- Automatische Validierung (Dateityp, Größe)
- Sofortige Vorschau
- Ersetzt Ordry-Logo überall automatisch

### 2. Design-Themes
- 4 vordefinierte Themes
- Echtzeit-Vorschau
- Synchronisiert über alle Geräte

### 3. Farbanpassung
- Color-Picker für Primär- & Sekundärfarbe
- Hex-Eingabe möglich
- (Wird in zukünftigen Updates verwendet)

### 4. Restaurant-Name
- Eigenen Namen setzen
- Wird überall angezeigt (Logo-Alt-Text, etc.)

## Echtzeit-Updates

Das System nutzt Supabase Realtime:
```tsx
// Automatisch bei jedem Logo/Settings-Update
✅ Alle offenen Tabs werden aktualisiert
✅ Küche, Waiter, Admin synchronisiert
✅ Keine Seiten-Refresh nötig
```

## Best Practices

### Logo-Empfehlungen:
- **Format:** PNG mit transparentem Hintergrund
- **Größe:** 500x500px oder ähnliches Verhältnis
- **Dateigröße:** < 500KB (max. 2MB)
- **Farbe:** Achte auf Kontrast zum Hintergrund

### Backup:
Das Ordry-Logo bleibt als Fallback, wenn:
- Kein Custom-Logo hochgeladen wurde
- Das Logo nicht geladen werden kann
- Storage-Fehler auftreten

## Erweiterungen

Du kannst weitere Personalisierungsoptionen hinzufügen:

```tsx
// Beispiel: Favicon
insert into settings (key, value)
values ('favicon_url', '');

// Beispiel: E-Mail
insert into settings (key, value)
values ('contact_email', 'info@restaurant.de');

// Beispiel: Öffnungszeiten
insert into settings (key, value)
values ('opening_hours', 'Mo-So: 10:00-22:00');
```

## Troubleshooting

### Logo wird nicht angezeigt?
1. Prüfe Supabase Storage Policies
2. Prüfe Browser-Konsole auf Fehler
3. Stelle sicher dass `logo_url` in settings existiert

### Upload funktioniert nicht?
1. Prüfe Datei-Typ (nur Bilder)
2. Prüfe Datei-Größe (< 2MB)
3. Prüfe Supabase Storage-Policies

### Änderungen nicht sichtbar?
1. Hard-Refresh: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Win)
2. Cache leeren
3. Prüfe ob andere Tabs offen sind

---

**Viel Spaß beim Personalisieren! 🎨✨**
