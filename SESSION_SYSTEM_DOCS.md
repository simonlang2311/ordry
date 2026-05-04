# 🔐 Automatisches Session-System für Statische QR-Codes

## Überblick

Das System verwaltet automatisch Sessions für Tische mit statischen QR-Codes. Es verhindert unbefugten Zugriff auf Bestellungen nach der Bezahlung und stellt sicher, dass jede "Sitzung" eindeutig identifizierbar ist.

## Workflow

### 1. Gast scannt QR-Code (Tisch wird aufgerufen)

```
┌─────────────────────────────────────────┐
│ QR-Code gescannt (z.B. /table/5)        │
└──────────────┬──────────────────────────┘
               │
        ┌──────▼──────┐
        │ Tisch prüfen│
        └──────┬──────┘
               │
         ┌─────▼─────────────────────────┐
         │ initializeSession() aufrufen  │
         └─────┬─────────────────────────┘
               │
        ┌──────▼──────────────────────┐
        │ Prüfe letzte Bestellung     │
        │ in orders-Tabelle           │
        └──────┬───────────────────────┘
               │
    ┌──────────┼──────────────┬──────────────┐
    │          │              │              │
    ▼          ▼              ▼              ▼
 Status=     Status=      Status=      Keine
 'paid'     'unpaid'     'other'     Bestellung
 (RESET)  (VALIDIERE)  (VALIDIERE)   (INIT)
    │          │              │          │
    └─────┬────┴──────┬───────┴──────┬──┘
         ▼            ▼              ▼
     [Reset]    [Validiere]      [Laden]
     [Screen]  [session_id]  [Menu normal]
```

### 2. Szenarien bei Tisch-Zugriff

#### A) Letzte Bestellung hat Status "Paid" (RESET)
- ✅ Lokale Session wird GELÖSCHT
- ✅ Reset-Screen wird angezeigt
- ✅ Gast muss auf "Neue Bestellung starten" klicken
- ✅ Nach Neuladen: Menü wird geladen

#### B) Letzte Bestellung ist "unpaid" (VALIDIERE)
- ✅ Prüfe ob lokale `session_id` mit der in der DB gespeicherten `session_id` übereinstimmt
- ✅ Wenn **gültig**: Menü wird normal geladen
- ❌ Wenn **ungültig**: Access Denied Screen (Zugriff verweigert)

#### C) Noch keine Bestellung vorhanden (INIT)
- ✅ Gast kann neue Bestellung starten
- ✅ Session wird NICHT lokal gespeichert (noch keine DB-ID)
- ✅ Bei Absendung der ersten Bestellung: `session_id` wird generiert und gespeichert

### 3. Bestellung wird abgesendet

```
┌──────────────────────────────┐
│ "Bestellung abschicken" Klick│
└──────────┬───────────────────┘
           │
     ┌─────▼──────────────────┐
     │ placeOrder()           │
     │ (insert in orders)     │
     └─────┬──────────────────┘
           │
    ┌──────▼──────────────────────────┐
    │ Prüfe: shouldReset?             │
    │ (erste Bestellung nach Paid?)   │
    └──────┬───────────────────────────┘
           │
         JA│                    NEIN│
          │                       │
    ┌─────▼──────────────────┐   │
    │ createNewSessionForOrder()   │
    │ (generiere UUID)            │
    │ (speichere lokal)           │
    │ (update DB mit session_id)  │
    │                             │
    │ ✅ Neue Session aktiv       │
    └─────┬──────────────────┘   │
         │                     │
         └──────────┬──────────┘
                    │
            ┌───────▼─────────┐
            │ Bestellung sent │
            │ ✅ Session ID   │
            │ in DB gespeichert
            └─────────────────┘
```

## Datenbank-Struktur

Die `orders` Tabelle erhält eine neue Spalte:

```sql
ALTER TABLE orders ADD COLUMN session_id UUID;

-- Beispiel-Bestellung:
{
  id: 42,
  table_id: "5",
  status: "new",
  items: ["2x Schnitzel", "1x Bier"],
  total_price: 29.90,
  session_id: "a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6",  -- UUID
  created_at: "2026-03-02T14:30:00Z"
}
```

## LocalStorage-Format

```javascript
// localStorage['ordry_session']
{
  session_id: "a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6",
  table_id: "5",
  created_at: "2026-03-02T14:30:15Z"
}
```

## Session Manager Funktionen

### `initializeSession(tableId, supabase)`
Wird aufgerufen, wenn ein Tisch zum ersten Mal aufgerufen wird.

**Returns:**
```typescript
{
  isValid: boolean,           // true = Zugriff erlaubt
  shouldReset: boolean,       // true = Reset-Screen anzeigen
  currentSessionId: string | null,  // aktuelle Session-ID oder null
  lastOrder: OrderRecord | null,    // letzte Bestellung oder null
  accessDenied?: boolean      // true = Zugriff verweigert
}
```

### `createNewSessionForOrder(tableId, orderId, supabase)`
Wird aufgerufen, wenn erste Bestellung nach "Paid" abgesendet wird.

**Does:**
1. Generiert neue UUID
2. Speichert Session lokal
3. Aktualisiert order.session_id in der DB

### `isSessionValidForOrder(currentSessionId, orderSessionId)`
Validiert, ob die lokale session_id mit der DB session_id übereinstimmt.

## Sicherheitslogik

| Szenario | Aktion |
|----------|--------|
| QR-Code gescannt, letzte Bestellung = "paid" | ✅ Reset-Screen, localStorage löschen |
| Neue Bestellung gesendet (erste nach paid) | ✅ Neue session_id generieren + speichern |
| Gast kommt mit altem QR-Code (falsche session_id) | ❌ Access Denied, keinen Zugriff |
| Gast kommt mit richtigem QR-Code (gleiche session_id) | ✅ Normal laden |
| Kein localStorage, aber aktive Bestellung | ⚠️ Neue Session für diese Bestellung erstellen |

## Dateien

### Neue Dateien
- `src/lib/sessionManager.ts` - Session-Manager Logik

### Geänderte Dateien
- `src/app/table/[id]/page.tsx` - Integration der Session-Validierung + UI

## Konfiguration

Keine zusätzliche Konfiguration erforderlich! Das System arbeitet automatisch.

## Testing

### Test 1: Reset nach Paid
1. Bestellung aufgeben und als "paid" markieren
2. QR-Code erneut scannen
3. ✅ Reset-Screen sollte erscheinen
4. ✅ localStorage sollte leer sein

### Test 2: Neue Session
1. Nach Reset auf "Neue Bestellung starten" klicken
2. ✅ Neue Session-ID sollte generiert und gespeichert werden
3. ✅ Bestellung sollte mit dieser session_id versehen sein

### Test 3: Access Denied
1. Bestellung mit session_id erstellen
2. Session manuell im localStorage ändern (falsche ID)
3. Seite neuladen
4. ✅ Access Denied Screen sollte erscheinen

### Test 4: Normaler Zugriff
1. Bestellung mit session_id erstellen
2. QR-Code erneut scannen
3. ✅ Menü sollte normal geladen werden (keine Reset/Denied)
4. ✅ Weitere Bestellungen können hinzugefügt werden
