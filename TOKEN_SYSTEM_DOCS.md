# 🔐 Token-basiertes Zugriffssystem für Dynamische QR-Codes

## Überblick

Das System funktioniert mit **dynamischen Tokens statt Session-IDs**. Der QR-Code bleibt **statisch** (`/table/5`), aber intern verwendet das System Tokens, die nach jedem Bezahlen erneuert werden.

```
┌─────────────────────────────────────────────────────────────┐
│ QR-Code (STATISCH): /table/5                                │
│                                                             │
│ 1. Gast scannt                                              │
│    ↓                                                         │
│ 2. System holt aktuellen Token aus DB                       │
│    ↓                                                         │
│ 3. Redirect: /table/5?token=ABC123DEF (UNSICHTBAR in URL)  │
│    ↓                                                         │
│ 4. history.replaceState() versteckt Token: /table/5         │
│    ↓                                                         │
│ 5. Menü wird geladen mit Token im sessionStorage            │
│                                                             │
│ Nach BEZAHLUNG:                                             │
│ • Token wird erneuert                                        │
│ • Alter Token wird ungültig                                 │
│ • Direkteingabe /table/5 = Neuer Token wird geholt          │
└─────────────────────────────────────────────────────────────┘
```

## 📊 Datenbank-Migration

Du musst die `tables` Tabelle um **eine Spalte** erweitern:

```sql
ALTER TABLE tables ADD COLUMN current_token UUID;

-- Beispiel
UPDATE tables SET current_token = gen_random_uuid() WHERE current_token IS NULL;
```

### Tisch-Struktur nach Migration:

```sql
CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  label VARCHAR(50),
  x DECIMAL,
  y DECIMAL,
  shape VARCHAR(50),
  level VARCHAR(50),
  seats INT,
  current_token UUID,  -- ← NEU: Aktueller gültiger Token
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 🔄 Workflow

### QR‑Code link

Statt direkt auf `/table/{id}` verweisen die QR‑Codes jetzt auf einen Redirect-Endpoint `/t/{id}`. Beim Scannen läuft folgender Ablauf ab:

1. Gast scannt QR-Code → Browser öffnet `/t/5` (oder entsprechender Tisch)
2. Server sendet HTTP-Redirect auf `/table/5?token=<aktuell>`
3. Client empfängt URL mit Token, versteckt den Parameter mit `history.replaceState`
4. Browser zeigt `/table/5`, der Token befindet sich nur im `sessionStorage`.

Damit ist sichergestellt, dass die Liste nicht allein durch Tippen auf `/table/5` erreichbar ist.

## 🔄 Workflow

### Szenario 1: Neuer Tisch (Erste Bestellung)

```
1. QR-Code gescannt: /table/5
   → Token in DB = NULL
   
2. System:
   - Holt Token aus DB → NULL
   - Validiert → OK (erste Bestellung erlaubt)
   - Menü wird geladen
   
3. Gast gibt Bestellung auf:
   - placeOrder() wird aufgerufen
   - Token wird ERSTMALIG generiert
   - Token in DB gespeichert
   - Token im sessionStorage gespeichert
   - history.replaceState() versteckt Token
```

### Szenario 2: Aktive Bestellung (Normaler Zugriff)

```
1. QR-Code gescannt: /table/5
   
2. System:
   - Holt aktuellen Token aus DB
   - Token = "abc123def456"
   - Prüft: Existiert offene Bestellung? JA
   - Redirect zu: /table/5?token=abc123def456
   - history.replaceState() versteckt Token → URL wird: /table/5
   
3. Browser zeigt: /table/5 (Token ist versteckt!)
   - sessionStorage hat Token
   - Menü wird geladen
```

### Szenario 3: Bezahlt (Token Erneuerung)

```
1. Waiter klickt "Alles Bezahlen"
   
2. System:
   - Markiert alle Bestellungen als "paid"
   - Generiert NEUEN Token
   - Token in DB aktualisiert
   - ABER: Alter Browser-Tab hat alten Token im sessionStorage
   
3. Wenn Gast auf GLEICHEM TAB neu lädt:
   - Holt Token aus sessionStorage (alt)
   - Vergleicht mit DB (neu)
   - Sie stimmen nicht überein!
   - Access Denied Screen ❌
   
4. Wenn Gast QR-Code ERNEUT SCANNT:
   - Neuer Tab
   - Token aus sessionStorage = LEER (neuer Tab)
   - System holt aktuellen Token aus DB (neu)
   - Redirect zu /table/5?token=NEW_TOKEN
   - history.replaceState() versteckt Token
   - Reset-Screen oder Neue Bestellung ✅
```

## 📁 Neue / Geänderte Dateien

### Neue Dateien:
- `src/lib/tokenManager.ts` - Token-Verwaltung

### Geänderte Dateien:
- `src/app/table/[id]/page.tsx` - Token-Validierung + URL-Handling
- `src/app/waiter/page.tsx` - Token-Erneuerung bei Bezahlung

### Gelöschte Dateien:
- `src/lib/sessionManager.ts` (veraltet, durch tokenManager.ts ersetzt)

## 🔑 Wichtige Funktionen

### Admin/Waiter Zugriff
Der Service-Personal kann sich mittels `usePersonalAuth` anmelden (Passwort `schnitzel`). Authentifizierte Nutzer erhalten weiterhin vollen Zugriff auf eine Tischseite, müssen aber wie alle anderen einen gültigen Token in der URL vorweisen. Der Hauptunterschied ist, dass die Admin‑URL beim Laden automatisch den aktuellen Token ergänzt und in der Adresse sichtbar bleibt.

### Permanenter Admin-Link
Zusätzlich kann ein **statischer Admin-Token** konfiguriert werden, der in jedem Fall Zugriff gewährt, unabhängig vom Tisch‑Token. Lege in `.env.local` oder im Deployment die Variable

```
NEXT_PUBLIC_ADMIN_ACCESS_TOKEN=geheim123
```

an; dieser Wert ist für das Frontend sichtbar und ermöglicht etwa per QR-Code einen
Schnellzugriff durch Mitarbeiter. Der Link lautet dann z.B.
`/table/5?admintoken=geheim123`.


### `validateAndRedirectToken(tableId, tokenFromUrl, supabase)`
```typescript
Prüft den Token und leitet ggf. weiter.

Besonderheit: Falls es **keine offenen Bestellungen** gibt (Tisch ist frisch oder
letzte Bestellung wurde bezahlt), wird der Zugriff **ohne Token** erlaubt. Bei
jedem solchen Besuch wird **ein neuer Token generiert und in der DB gespeichert**.
Damit sind alte Links sofort ungültig, und es entfällt die vorherige Reset-Seite.
Der frisch erzeugte Token landet zudem im sessionStorage, falls er später für Belege
oder URL‑Anzeigen benötigt wird.

Returns:
{
  isValid: boolean,           // Zugriff erlaubt?
  shouldRedirect: boolean,    // Zu neuem Token weiterleiten?
  validToken: string | null   // Der gültige Token (für Admins oder Redirect)
}
```

### `createNewTokenForTable(tableId, supabase)`
```typescript
Erstellt einen neuen Token nach Bezahlung.
- Generiert UUID
- Speichert in DB
- Speichert im sessionStorage
- Returned neue UUID
```

### `fetchCurrentTokenForTable(tableId, supabase)`
```typescript
Lädt den aktuell in der Tabelle gespeicherten Token und gibt ihn zurück.
Falls noch keiner vorhanden ist, wird automatisch ein neuer Token erzeugt und in
der Datenbank abgelegt. Diese Funktion erleichtert der Kellner‑UI das
automatische Anzeigen des gültigen Tokens beim Öffnen eines Tisches.
```

## 🔒 Sicherheit

| Fall | Aktion |
|------|--------|
| QR-Code gescannt, aktive Bestellung | ✅ Token validieren, Menü laden |
| Tisch ohne offene Bestellung (erstes Betreten) | ✅ Zugang erlauben, sofort neuen Token erzeugen |
| QR-Code gescannt, letzte Bestellung = "paid" | ✅ Neuen Token generieren (Token wird beim Bezahlen aktualisiert) |
| Direkteingabe `/table/5` ohne Token | ✅ Token aus DB holen, weiterleiten |
| Alter Token im Browser, aber DB hat neuen | ❌ Access Denied |
| Neuer Tab, nach Bezahlung | ✅ Token neu holen aus DB |- Kellner/Admin öffnen Tisch | ✅ URL enthält aktuellen Token, wird nicht entfernt
## 📲 URL-Verhalten

```
QR-Code zeigt:       /table/5
Browser-Verlauf:     /table/5 (Token versteckt!)
sessionStorage hat:  token=ABC123DEF456
Supabase DB hat:     current_token=ABC123DEF456
```

Die URL im Browser-Verlauf sieht **nie** den Token, weil `history.replaceState()` ihn entfernt.

## 🧪 Schnell-Test

1. **QR-Code anfordern**: scanne `/t/5` (Redirect-Endpoint)
   - Der Server liefert einen Redirect an `/table/5?token=XYZ`
   - Der Client versteckt den Token (history.replaceState)
   - URL bleibt `/table/5`
- Direkteingabe `/table/5` erzeugt einen HTTP 403 Fehlercode** – dies gilt für **jeden** Nutzer, auch Admins. **Nur** Links mit `?token=` (oder mit dem konfigurierten `?admintoken=`) führen zum Menü, und selbst dabei wird der **Wert des Tokens auf Server‑Seite geprüft**.

> Hinweis: Die Edge‑Middleware ruft die Supabase‑API ab und vergleicht den
> query‑string‑Token mit dem in der `tables.current_token` gespeicherten Wert.
> Wenn beides nicht übereinstimmt oder kein Token in der DB existiert, liefert
> der Server sofort 403 – die React‑App wird gar nicht geladen. Dadurch können
> Gäste keine Zufalls‑Strings verwenden und müssen wirklich den QR‑Code scannen.

> Hinweis: Falls jemand versehentlich eine alte oder falsche Token‑URL nutzt, die Seite ersetzt den Parameter automatisch durch den gerade gültigen Token. So wird der Browserpfad immer synchron mit dem aktuellen Wert gehalten.

---

### Kellner / Admin-Verhalten
- Das Personal benutzt das Backoffice und ist per `usePersonalAuth` eingeloggt.
- Beim Klick auf einen Tisch wird die Gastseite direkt mit aktuellem Token im Query geöffnet (`/table/5?token=XYZ`).
- Die URL bleibt während der Sitzung sichtbar, es erfolgt **keine** automatische Entfernung des Tokens – so kann der Token leicht abgelesen oder kopiert werden.
- Beim erneuten Laden ohne Token (z.B. manuelle Eingabe) ergänzt das System automatisch `?token=<aktueller>` mittels `router.replace`.
- Admin/Waiter können /table/5 jederzeit öffnen; die Middleware lehnt nicht ab.


2. **Gib erste Bestellung auf**
   - Token wird generiert
   - In sessionStorage gespeichert
   - In DB gespeichert

3. **Markiere als "Paid" (Waiter)**
   - Neuer Token wird generiert
   - Alter Token wird ungültig

4. **Lade Seite neu (selber Tab)**
   - Alter Token im sessionStorage
   - Neuer Token in DB
   - Access Denied! ❌

5. **Scanne QR-Code neu (oder öffne `/table/5`)**
   - Neuer Tab
   - Token aus DB holen
   - Weiterleiten + Reset-Screen
   - Neue Bestellung starten ✅

## 🚀 Nächste Schritte

- [ ] Migration: `ALTER TABLE tables ADD COLUMN current_token UUID;`
- [ ] Testen: Token-Validierung funktioniert
- [ ] Testen: Access Denied bei altem Token
- [ ] Testen: URL bleibt `/table/5` (Token versteckt)
