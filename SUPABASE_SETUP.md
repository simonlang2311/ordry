# Supabase Setup für Multi-Tenant SaaS

## 1. TABELLEN ERSTELLEN

### Tables (Tische)
```sql
CREATE TABLE IF NOT EXISTS public.tables (
  id BIGINT PRIMARY KEY DEFAULT nextval('tables_id_seq'::regclass),
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  x NUMERIC DEFAULT 0,
  y NUMERIC DEFAULT 0,
  shape TEXT DEFAULT 'round',
  level TEXT DEFAULT 'EG',
  seats INTEGER DEFAULT 4,
  current_token TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(restaurant_id, label)
);

CREATE INDEX idx_tables_restaurant_id ON public.tables(restaurant_id);
CREATE INDEX idx_tables_label ON public.tables(label);
```

### Restaurants
```sql
CREATE TABLE IF NOT EXISTS public.restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Menu Items
```sql
CREATE TABLE IF NOT EXISTS public.menu (
  id BIGINT PRIMARY KEY DEFAULT nextval('menu_id_seq'::regclass),
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  description TEXT,
  category TEXT,
  item_type TEXT DEFAULT 'food',
  vat_rate NUMERIC DEFAULT 19,
  allergens TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_menu_restaurant_id ON public.menu(restaurant_id);
CREATE INDEX idx_menu_category ON public.menu(restaurant_id, category);
```

### Orders
```sql
CREATE TABLE IF NOT EXISTS public.orders (
  id BIGINT PRIMARY KEY DEFAULT nextval('orders_id_seq'::regclass),
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL,
  items TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT DEFAULT 'new',
  total_price NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT
);

CREATE INDEX idx_orders_restaurant_id ON public.orders(restaurant_id);
CREATE INDEX idx_orders_table_id ON public.orders(restaurant_id, table_id);
CREATE INDEX idx_orders_status ON public.orders(status);
```

### Settings
```sql
CREATE TABLE IF NOT EXISTS public.settings (
  id BIGINT PRIMARY KEY DEFAULT nextval('settings_id_seq'::regclass),
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(restaurant_id, key)
);

CREATE INDEX idx_settings_restaurant_id ON public.settings(restaurant_id);
CREATE INDEX idx_settings_key ON public.settings(restaurant_id, key);
```

### Reservations (Optional für später)
```sql
CREATE TABLE IF NOT EXISTS public.reservations (
  id BIGINT PRIMARY KEY DEFAULT nextval('reservations_id_seq'::regclass),
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  guests_count INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reservations_restaurant_id ON public.reservations(restaurant_id);
CREATE INDEX idx_reservations_date ON public.reservations(restaurant_id, date);
```

## 2. ROW LEVEL SECURITY (RLS) AKTIVIEREN

```sql
-- Alle Tabellen aktivieren
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Policies für Restaurants
CREATE POLICY "Enable read access for all"
  ON public.restaurants FOR SELECT USING (true);

CREATE POLICY "Enable insert for all"
  ON public.restaurants FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all"
  ON public.restaurants FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Enable delete for all"
  ON public.restaurants FOR DELETE USING (true);

-- Policies für Tables
CREATE POLICY "Enable read access for all authenticated users" 
  ON public.tables FOR SELECT 
  USING (true);

CREATE POLICY "Enable insert/update for authenticated users" 
  ON public.tables FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users" 
  ON public.tables FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Enable delete for all"
  ON public.tables FOR DELETE USING (true);

-- Policies für Menu
CREATE POLICY "Enable read access for all" 
  ON public.menu FOR SELECT USING (true);

CREATE POLICY "Enable insert for all"
  ON public.menu FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all"
  ON public.menu FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Enable delete for all"
  ON public.menu FOR DELETE USING (true);

-- Policies für Orders
CREATE POLICY "Enable read access for all" 
  ON public.orders FOR SELECT USING (true);

CREATE POLICY "Enable insert for all" 
  ON public.orders FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all" 
  ON public.orders FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Enable delete for all" 
  ON public.orders FOR DELETE USING (true);

-- Policies für Settings
CREATE POLICY "Enable read access for all" 
  ON public.settings FOR SELECT USING (true);

CREATE POLICY "Enable insert/update for authenticated" 
  ON public.settings FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for authenticated" 
  ON public.settings FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Enable delete for all"
  ON public.settings FOR DELETE USING (true);

-- Policies für Reservations
CREATE POLICY "Enable read access for all" 
  ON public.reservations FOR SELECT USING (true);

CREATE POLICY "Enable insert for all" 
  ON public.reservations FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all"
  ON public.reservations FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Enable delete for all"
  ON public.reservations FOR DELETE USING (true);
```

## 3. TEST-DATEN EINFÜGEN

```sql
-- Restaurant erstellen
INSERT INTO public.restaurants (id, name, slug) 
VALUES ('demo-restaurant-1', 'Demo Restaurant 1', 'demo-1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurants (id, name, slug) 
VALUES ('demo-restaurant-2', 'Demo Restaurant 2', 'demo-2')
ON CONFLICT (id) DO NOTHING;

-- Tische für Demo Restaurant 1
INSERT INTO public.tables (restaurant_id, label, x, y, shape, level, seats) VALUES
('demo-restaurant-1', '1', 100, 100, 'round', 'EG', 4),
('demo-restaurant-1', '2', 200, 100, 'round', 'EG', 4),
('demo-restaurant-1', '3', 300, 100, 'round', 'EG', 4),
('demo-restaurant-1', '4', 100, 200, 'square', 'EG', 6),
('demo-restaurant-1', '5', 200, 200, 'rect', 'EG', 8),
('demo-restaurant-1', '6', 300, 200, 'round', 'OG', 4),
('demo-restaurant-1', '7', 100, 300, 'round', 'OG', 4)
ON CONFLICT (restaurant_id, label) DO NOTHING;

-- Tische für Demo Restaurant 2
INSERT INTO public.tables (restaurant_id, label, x, y, shape, level, seats) VALUES
('demo-restaurant-2', '1', 100, 100, 'round', 'EG', 4),
('demo-restaurant-2', '2', 200, 100, 'round', 'EG', 4),
('demo-restaurant-2', '3', 300, 100, 'round', 'EG', 2)
ON CONFLICT (restaurant_id, label) DO NOTHING;

-- Menü-Einträge für Demo Restaurant 1
INSERT INTO public.menu (restaurant_id, name, price, category, item_type, vat_rate) VALUES
('demo-restaurant-1', 'Wasser 0,5l', 2.50, 'Getränke', 'drink', 19),
('demo-restaurant-1', 'Bier Pils 0,4l', 4.50, 'Getränke', 'drink', 19),
('demo-restaurant-1', 'Pizza Margherita', 12.99, 'Hauptgerichte', 'food', 7),
('demo-restaurant-1', 'Pizza Quattro Formaggi', 14.99, 'Hauptgerichte', 'food', 7),
('demo-restaurant-1', 'Schnitzel', 15.99, 'Hauptgerichte', 'food', 7),
('demo-restaurant-1', 'Tiramisu', 5.99, 'Desserts', 'food', 7)
ON CONFLICT DO NOTHING;

-- Menü-Einträge für Demo Restaurant 2
INSERT INTO public.menu (restaurant_id, name, price, category, item_type, vat_rate) VALUES
('demo-restaurant-2', 'Espresso', 2.50, 'Getränke', 'drink', 19),
('demo-restaurant-2', 'Cappuccino', 3.50, 'Getränke', 'drink', 19),
('demo-restaurant-2', 'Croissant', 3.99, 'Bäckerei', 'food', 7),
('demo-restaurant-2', 'Sandwich', 7.99, 'Bäckerei', 'food', 7)
ON CONFLICT DO NOTHING;

-- Standard-Einstellungen
INSERT INTO public.settings (restaurant_id, key, value) VALUES
('demo-restaurant-1', 'menu_categories', '[{"id":"Getränke","label":"Getränke"},{"id":"Hauptgerichte","label":"Hauptgerichte"},{"id":"Desserts","label":"Desserts"}]'),
('demo-restaurant-1', 'theme', 'ordry'),
('demo-restaurant-1', 'font_family', 'geist'),
('demo-restaurant-1', 'allergens_enabled', 'true'),
('demo-restaurant-1', 'drinks_target', 'bar'),
('demo-restaurant-1', 'personal_password', 'schnitzel'),
('demo-restaurant-1', 'app_name', 'ordry'),
('demo-restaurant-1', 'logo_url', ''),
('demo-restaurant-2', 'menu_categories', '[{"id":"Getränke","label":"Getränke"},{"id":"Bäckerei","label":"Bäckerei"}]'),
('demo-restaurant-2', 'theme', 'ordry'),
('demo-restaurant-2', 'font_family', 'geist'),
('demo-restaurant-2', 'allergens_enabled', 'true'),
('demo-restaurant-2', 'drinks_target', 'bar'),
('demo-restaurant-2', 'personal_password', 'schnitzel'),
('demo-restaurant-2', 'app_name', 'ordry'),
('demo-restaurant-2', 'logo_url', '')
ON CONFLICT (restaurant_id, key) DO NOTHING;
```

## 4. In der App verwenden

### Tables laden
```typescript
const { data: tables } = await supabase
  .from('tables')
  .select('*')
  .eq('restaurant_id', restaurantId)
  .order('id', { ascending: true });
```

### Bestellungen für einen Tisch
```typescript
const { data: orders } = await supabase
  .from('orders')
  .select('*')
  .eq('restaurant_id', restaurantId)
  .eq('table_id', tableId);
```

### Menü laden
```typescript
const { data: menu } = await supabase
  .from('menu')
  .select('*')
  .eq('restaurant_id', restaurantId);
```

### Einstellungen laden
```typescript
const { data: settings } = await supabase
  .from('settings')
  .select('value')
  .eq('restaurant_id', restaurantId)
  .eq('key', 'menu_categories')
  .single();
```
