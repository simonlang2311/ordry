// Token Management für dynamische QR-Codes
// QR-Code zeigt auf: /t/5?qr=ABC123DEF456
// Nach erfolgreichem Scan wird intern auf /table/5 ohne sichtbaren Token gewechselt
// Token wird nur bei expliziter QR-Erneuerung erneuert, alte QR-Codes werden ungültig

export interface TokenData {
  token: string;
  table_id: string;
  created_at: string;
}

export interface OrderRecord {
  id: number;
  table_id: string;
  status: string;
  created_at: string;
  items: string[];
  total_price?: number;
  session_id?: string | null;
}

const TOKEN_KEY = 'ordry_token';
const CUSTOMER_TOKEN_SETTINGS_KEY = 'table_customer_tokens';

/**
 * Generiert einen neuen Token (UUID)
 */
export const generateToken = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Speichert den Token im sessionStorage (wird gelöscht beim Tab-Close)
 * Optional - nur als Cache, nicht für Validierung verwendet
 */
export const saveToken = (tableId: string, token: string, restaurantId: string): void => {
  try {
    const tokenData: TokenData = {
      token: token,
      table_id: tableId,
      created_at: new Date().toISOString()
    };
    const key = `${TOKEN_KEY}_${restaurantId}`;
    sessionStorage.setItem(key, JSON.stringify(tokenData));
    console.log('[TokenManager] Token im Cache gespeichert:', { table_id: tableId, token: token.substring(0, 8) + '...', restaurantId });
  } catch (e) {
    // sessionStorage kann in manchen Kontexten nicht verfügbar sein (z.B. DevTunnel)
    console.log('[TokenManager] sessionStorage nicht verfügbar, überspringe Cache');
  }
};

/**
 * Lädt den aktuellen Token aus sessionStorage
 * Optional - nur als Cache, nicht für Validierung verwendet
 */
export const getToken = (restaurantId: string): TokenData | null => {
  try {
    const key = `${TOKEN_KEY}_${restaurantId}`;
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    return JSON.parse(stored) as TokenData;
  } catch (e) {
    console.log('[TokenManager] sessionStorage nicht verfügbar für Laden');
    return null;
  }
};

/**
 * Liefert einen gecachten Token nur dann zurück, wenn er zum gewünschten Tisch gehört.
 */
export const getCachedTokenForTable = (tableId: string, restaurantId: string): string | null => {
  const cachedToken = getToken(restaurantId);
  if (!cachedToken) return null;
  if (cachedToken.table_id !== tableId) return null;
  return cachedToken.token;
};

/**
 * Löscht den Token aus sessionStorage
 * Optional - nur Cache, nicht kritisch für Sicherheit
 */
export const clearToken = (restaurantId: string): void => {
  try {
    const key = `${TOKEN_KEY}_${restaurantId}`;
    sessionStorage.removeItem(key);
    console.log('[TokenManager] Token-Cache gelöscht für Restaurant:', restaurantId);
  } catch (e) {
    console.log('[TokenManager] sessionStorage nicht verfügbar zum Löschen');
  }
};

/**
 * Prüft, ob ein Token gültig ist
 */
export const isValidToken = (tableId: string, providedToken: string, restaurantId: string): boolean => {
  const currentToken = getToken(restaurantId);
  if (!currentToken) return false;
  
  // Token muss für denselben Tisch sein
  if (currentToken.table_id !== tableId) return false;
  
  // Token muss übereinstimmen
  if (currentToken.token !== providedToken) return false;
  
  return true;
};

/**
 * Holt den Status der letzten Bestellung für einen Tisch
 */
export const getLastOrderStatus = async (
  tableId: string,
  supabase: any,
  restaurantId: string
): Promise<{ status: string; order: OrderRecord | null }> => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('table_id', tableId)
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Keine Bestellungen gefunden
        return { status: 'not_found', order: null };
      }
      console.error('[TokenManager] Fehler beim Abrufen der letzten Bestellung:', error);
      return { status: 'error', order: null };
    }

    if (!data) {
      return { status: 'not_found', order: null };
    }

    return {
      status: data.status === 'paid' ? 'paid' : 'unpaid',
      order: data as OrderRecord
    };
  } catch (e) {
    console.error('[TokenManager] Exception beim Status-Check:', e);
    return { status: 'error', order: null };
  }
};

/**
 * Holt den aktuellen Token für einen Tisch aus der Datenbank
 */
export const getCurrentTableToken = async (
  tableId: string,
  supabase: any,
  restaurantId: string
): Promise<string | null> => {
  if (!restaurantId) {
    console.error('[TokenManager] Kein restaurantId angegeben beim Abruf des Tokens für Tisch:', tableId);
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('tables')
      .select('current_token')
      .eq('restaurant_id', restaurantId)
      .eq('label', tableId)
      .maybeSingle();

    if (error) {
      console.error('[TokenManager] Fehler beim Abrufen des aktuellen Tokens für tableId:', tableId, 'restaurantId:', restaurantId, error);
      return null;
    }

    if (!data) {
      console.warn('[TokenManager] Kein aktueller Token gefunden für tableId:', tableId, 'restaurantId:', restaurantId);
      return null;
    }

    return data.current_token;
  } catch (e) {
    console.error('[TokenManager] Exception beim Token-Abruf:', e);
    return null;
  }
};

export const validateQrToken = async (
  tableId: string,
  providedToken: string | null,
  supabase: any,
  restaurantId: string
): Promise<boolean> => {
  if (!providedToken) return false;

  const currentQrToken = await getCurrentTableToken(tableId, supabase, restaurantId);
  return currentQrToken === providedToken;
};

type CustomerTokenMap = Record<string, string | string[]>;

const getCustomerTokenMap = async (
  supabase: any,
  restaurantId: string
): Promise<CustomerTokenMap> => {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('restaurant_id', restaurantId)
    .eq('key', CUSTOMER_TOKEN_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    console.error('[TokenManager] Fehler beim Laden der Kunden-Tokens:', error);
    return {};
  }

  if (!data?.value) return {};

  try {
    const parsed = JSON.parse(data.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error('[TokenManager] Kunden-Tokens konnten nicht gelesen werden:', error);
    return {};
  }
};

const saveCustomerTokenMap = async (
  tokenMap: CustomerTokenMap,
  supabase: any,
  restaurantId: string
): Promise<boolean> => {
  const { error } = await supabase
    .from('settings')
    .upsert(
      { restaurant_id: restaurantId, key: CUSTOMER_TOKEN_SETTINGS_KEY, value: JSON.stringify(tokenMap) },
      { onConflict: 'key,restaurant_id' }
    );

  if (error) {
    console.error('[TokenManager] Fehler beim Speichern der Kunden-Tokens:', error);
    return false;
  }

  return true;
};

export const getCurrentCustomerToken = async (
  tableId: string,
  supabase: any,
  restaurantId: string
): Promise<string | null> => {
  const tokenMap = await getCustomerTokenMap(supabase, restaurantId);
  const tokenEntry = tokenMap[tableId];
  if (Array.isArray(tokenEntry)) return tokenEntry[tokenEntry.length - 1] || null;
  return tokenEntry || null;
};

export const isValidCustomerToken = async (
  tableId: string,
  providedToken: string,
  supabase: any,
  restaurantId: string
): Promise<boolean> => {
  const tokenMap = await getCustomerTokenMap(supabase, restaurantId);
  const tokenEntry = tokenMap[tableId];
  if (Array.isArray(tokenEntry)) return tokenEntry.includes(providedToken);
  return tokenEntry === providedToken;
};

export const createNewCustomerTokenForTable = async (
  tableId: string,
  supabase: any,
  restaurantId: string
): Promise<string> => {
  const tokenMap = await getCustomerTokenMap(supabase, restaurantId);
  const newToken = generateToken();
  const currentEntry = tokenMap[tableId];
  const currentTokens = Array.isArray(currentEntry) ? currentEntry : (currentEntry ? [currentEntry] : []);
  tokenMap[tableId] = [...currentTokens, newToken];
  await saveCustomerTokenMap(tokenMap, supabase, restaurantId);
  saveToken(tableId, newToken, restaurantId);
  console.log('[TokenManager] Neuer Kunden-Token erstellt:', { tableId, restaurantId, token: newToken.substring(0, 8) + '...' });
  return newToken;
};

export const invalidateCustomerTokensForTable = async (
  tableId: string,
  supabase: any,
  restaurantId: string
): Promise<boolean> => {
  const tokenMap = await getCustomerTokenMap(supabase, restaurantId);
  tokenMap[tableId] = [];
  const saved = await saveCustomerTokenMap(tokenMap, supabase, restaurantId);
  console.log('[TokenManager] Kunden-Tokens für Tisch invalidiert:', { tableId, restaurantId });
  return saved;
};

export const fetchCurrentCustomerTokenForTable = async (
  tableId: string,
  supabase: any,
  restaurantId: string
): Promise<string> => {
  const currentToken = await getCurrentCustomerToken(tableId, supabase, restaurantId);
  if (currentToken) return currentToken;
  return createNewCustomerTokenForTable(tableId, supabase, restaurantId);
};

/**
 * Speichert einen neuen Token für einen Tisch in der Datenbank
 */
export const saveTableToken = async (
  tableId: string,
  token: string,
  supabase: any,
  restaurantId: string
): Promise<boolean> => {
  try {
    let { data, error } = await supabase
      .from('tables')
      .update({ current_token: token })
      .eq('restaurant_id', restaurantId)
      .eq('label', tableId)
      .select('id')
      .maybeSingle();

    if (!data && !error && /^[0-9]+$/.test(tableId)) {
      const result = await supabase
        .from('tables')
        .update({ current_token: token })
        .eq('restaurant_id', restaurantId)
        .eq('id', Number(tableId))
        .select('id')
        .maybeSingle();
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('[TokenManager] Fehler beim Speichern des Tokens:', error);
      return false;
    }

    if (!data) {
      console.warn('[TokenManager] Kein Tisch zum Speichern des Tokens gefunden:', { tableId, restaurantId });
      return false;
    }

    console.log('[TokenManager] Token für Tisch gespeichert:', tableId);
    return true;
  } catch (e) {
    console.error('[TokenManager] Exception beim Token-Speichern:', e);
    return false;
  }
};

/**
 * Validiert den Token für einen Tisch beim Laden
 * Leitet bei gültigem Token weiter, sonst zeigt Error
 */
export const validateAndRedirectToken = async (
  tableId: string,
  providedToken: string | null,
  supabase: any,
  restaurantId: string
): Promise<{
  isValid: boolean;
  shouldRedirect: boolean;
  validToken: string | null;
}> => {

  const cachedToken = getCachedTokenForTable(tableId, restaurantId);
  const candidateToken = providedToken ?? cachedToken;

  console.log('[TokenManager] Validiere Token für Tisch:', tableId, 'tokenFromUrl:', candidateToken?.substring(0, 8) + '...', 'restaurantId:', restaurantId);

  // admin bypass using special token
  if (candidateToken === process.env.NEXT_PUBLIC_ADMIN_ACCESS_TOKEN) {
    console.log('[TokenManager] Admin token used, granting access');
    return { isValid: true, shouldRedirect: false, validToken: candidateToken };
  }

  // require either a scan token from URL or a previously cached session token
  if (!candidateToken) {
    console.log('[TokenManager] Kein Scan- oder Session-Token vorhanden – Zugriff verweigert');
    return { isValid: false, shouldRedirect: false, validToken: null };
  }

  // fetch the active customer token
  const currentCustomerToken = await getCurrentCustomerToken(tableId, supabase, restaurantId);
  if (!currentCustomerToken) {
    console.log('[TokenManager] Kein Kunden-Token vorhanden – bitte QR-Code scannen');
    return { isValid: false, shouldRedirect: false, validToken: null };
  }

  // token must exactly match
  if (!(await isValidCustomerToken(tableId, candidateToken, supabase, restaurantId))) {
    console.log('[TokenManager] Kunden-Token stimmt nicht überein');
    console.log('[TokenManager] Provided:', candidateToken?.substring(0, 8) + '...');
    console.log('[TokenManager] Expected current token:', currentCustomerToken?.substring(0, 8) + '...');
    clearToken(restaurantId);
    return { isValid: false, shouldRedirect: false, validToken: null };
  }

  // optional: if the last order was paid we could rotate the token here.
  // For now we simply ignore payment status so the guest link keeps working
  // until the waiter explicitly requests a new QR code. This avoids users
  // seeing "Zugriff verweigert" if the kitchen marks an order paid without
  // refreshing the token in the DB.
  //
  // const { status } = await getLastOrderStatus(tableId, supabase);
  // if (status === 'paid') {
  //   console.log('[TokenManager] Letzte Bestellung bezahlt – alter Token ungueltig');
  //   clearToken();
  //   return { isValid: false, shouldRedirect: false, validToken: null };
  // }

  // all good - Token ist valide
  console.log('[TokenManager] Token gültig für Tisch:', tableId);
  saveToken(tableId, candidateToken, restaurantId);
  return { isValid: true, shouldRedirect: false, validToken: candidateToken };
};

/**
 * Erstellt einen neuen Token nach Bezahlung
 */
export const createNewTokenForTable = async (
  tableId: string,
  supabase: any,
  restaurantId: string
): Promise<string> => {
  const newToken = generateToken();
  await saveTableToken(tableId, newToken, supabase, restaurantId);
  saveToken(tableId, newToken, restaurantId);
  console.log('[TokenManager] Neuer Token erstellt:', newToken.substring(0, 8) + '...');
  return newToken;
};

/**
 * Liest den aktuellen Token aus der Datenbank (erstellt bei Bedarf einen neuen).
 * Wird von der Kellner‑UI verwendet, damit beim Öffnen eines Tisches immer der
 * neuste, gültige Wert zur Verfügung steht.
 *
 * @param tableId - ID oder Beschriftung des Tisches
 * @param supabase - Supabase-Client
 * @returns der gültige Token (oder null falls Fehler)
 */
export const fetchCurrentTokenForTable = async (
  tableId: string,
  supabase: any,
  restaurantId: string
): Promise<string | null> => {
  // Labels sind die öffentlich sichtbaren Tisch-IDs und können ebenfalls numerisch sein.
  // Deshalb immer zuerst per label suchen und nur als Fallback per technischer id.
  let result = await supabase
    .from('tables')
    .select('current_token')
    .eq('restaurant_id', restaurantId)
    .eq('label', tableId)
    .maybeSingle();

  let data: any = result.data;
  let error: any = result.error;

  if (!data && !error && /^[0-9]+$/.test(tableId)) {
    result = await supabase
      .from('tables')
      .select('current_token')
      .eq('restaurant_id', restaurantId)
      .eq('id', Number(tableId))
      .maybeSingle();
    data = result.data;
    error = result.error;
  }

  if (error) {
    console.error('[TokenManager] fetchCurrentTokenForTable error', error);
    return null;
  }

  let token = data?.current_token;
  if (!token) {
    // Falls noch keiner existiert, anlegen
    token = generateToken();
    await saveTableToken(tableId, token, supabase, restaurantId);
    console.log('[TokenManager] Kein bestehender Token - neuer erstellt');
  }
  return token;
};
