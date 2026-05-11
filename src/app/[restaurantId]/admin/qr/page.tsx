'use client';
import { useParams } from "next/navigation";
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { supabase } from '@/lib/supabase';
import { createNewTokenForTable, fetchCurrentTokenForTable } from '@/lib/tokenManager';
import QRCode from 'qrcode';
import JSZip from 'jszip';

interface Table {
  id: number;
  label: string;
  name: string;
  currentToken?: string | null;
}

function QRCodeContent() {
  const params = useParams();
  const restaurantId = params.restaurantId as string;
  const [tables, setTables] = useState<Table[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState('');
  const canvasRefs = useRef<{ [key: number]: HTMLCanvasElement | null }>({});

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    // Lade Tische aus der Datenbank
    const fetchTables = async () => {
      try {
        const { data, error } = await supabase
          .from('tables')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('id', { ascending: true });

        if (error) {
          console.error('Fehler beim Laden der Tische:', error);
          return;
        }

        if (data) {
          const tablesWithTokens = await Promise.all(
            data.map(async (table) => ({
              ...table,
              currentToken: await fetchCurrentTokenForTable(table.label, supabase, restaurantId)
            }))
          );

          setTables(tablesWithTokens);
        }
      } catch (err) {
        console.error('Exception beim Laden der Tische:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, []);

  const getGuestUrl = (tableLabel: string, token?: string | null) => {
    if (!token) return '';

    const baseUrl = origin || window.location.origin;
    return `${baseUrl}/${encodeURIComponent(restaurantId)}/qr/${encodeURIComponent(tableLabel)}?qr=${encodeURIComponent(token)}`;
  };

  const generateQRCode = async (table: Table, canvasIndex: number) => {
    const canvas = canvasRefs.current[canvasIndex];
    if (!canvas || !table.currentToken) return;

    const url = getGuestUrl(table.label, table.currentToken);
    
    try {
      await QRCode.toCanvas(canvas, url, {
        width: 300,
        margin: 2,
        color: {
          dark: '#275D7B',
          light: '#FFFFFF'
        }
      });
    } catch (error) {
      console.error('QR-Code Fehler:', error);
    }
  };

  const downloadQRCode = async (table: Table, canvasIndex: number) => {
    if (!table.currentToken) {
      alert('Für diesen Tisch ist noch kein gültiger QR-Code verfügbar.');
      return;
    }

    setGenerating(`download-${table.id}`);
    
    try {
      const url = getGuestUrl(table.label, table.currentToken);
      
      // Generiere QR-Code als Data URL
      const dataUrl = await QRCode.toDataURL(url, {
        width: 800,
        margin: 2,
        color: {
          dark: '#275D7B',
          light: '#FFFFFF'
        }
      });

      // Konvertiere zu Blob und lade herunter
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `QR-${(table.name || `Tisch ${table.label}`).replace(/\s+/g, '-')}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download-Fehler:', error);
      alert('Fehler beim Herunterladen des QR-Codes');
    } finally {
      setGenerating(null);
    }
  };

  const regenerateQRCode = async (table: Table) => {
    setGenerating(`regenerate-${table.id}`);

    try {
      const newToken = await createNewTokenForTable(table.label, supabase, restaurantId);

      setTables((currentTables) =>
        currentTables.map((currentTable) =>
          currentTable.id === table.id
            ? { ...currentTable, currentToken: newToken }
            : currentTable
        )
      );
    } catch (error) {
      console.error('QR-Regenerierung fehlgeschlagen:', error);
      alert('Der neue QR-Code konnte nicht erstellt werden.');
    } finally {
      setGenerating(null);
    }
  };

  const downloadAllQRCodes = async () => {
    setGenerating('download-all');
    
    try {
      const zip = new JSZip();
      
      // Generiere alle QR-Codes und füge sie zum ZIP hinzu
      for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        if (!table.currentToken) {
          continue;
        }

        const url = getGuestUrl(table.label, table.currentToken);
        
        // Generiere QR-Code als Base64
        const dataUrl = await QRCode.toDataURL(url, {
          width: 800,
          margin: 2,
          color: {
            dark: '#275D7B',
            light: '#FFFFFF'
          }
        });
        
        // Entferne "data:image/png;base64," prefix
        const base64Data = dataUrl.split(',')[1];
        const fileName = `QR-${(table.name || `Tisch ${table.label}`).replace(/[\s\/]/g, '-')}.png`;
        
        // Füge zum ZIP hinzu
        zip.file(fileName, base64Data, { base64: true });
      }
      
      // Generiere ZIP und lade herunter
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `QR-Codes-Alle-Tische-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('ZIP-Fehler:', error);
      alert('Fehler beim Erstellen der ZIP-Datei');
    } finally {
      setGenerating(null);
    }
  };

  useEffect(() => {
    // Generiere alle QR-Codes für die Vorschau
    tables.forEach((table, index) => {
      generateQRCode(table, index);
    });
  }, [tables, origin]);

  if (loading) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text p-8 flex items-center justify-center">
        <div className="text-2xl font-bold">Lade Tische...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg text-app-text p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between border-b border-app-muted/20 pb-4">
          <div>
            <h1 className="text-4xl font-black mb-2">QR-Code Generator</h1>
            <p className="text-app-muted">QR-Codes für alle Tische herunterladen</p>
            {tables.length === 0 && (
              <p className="mt-2 text-sm font-bold text-yellow-500">
                Keine Tische in der Datenbank gefunden. Bitte lege zuerst Tische an.
              </p>
            )}
          </div>
          <div className="flex gap-3 mt-4 md:mt-0">
            <button
              onClick={downloadAllQRCodes}
              disabled={generating !== null}
              className="bg-app-primary hover:bg-app-primary/80 disabled:bg-app-muted disabled:cursor-not-allowed px-6 py-2 rounded-lg transition-colors font-bold"
            >
              {generating === 'download-all' ? 'Lädt...' : 'Alle Herunterladen'}
            </button>
            <Link
              href={`/${restaurantId}/admin`}
              className="bg-app-card border border-app-muted/30 px-4 py-2 rounded-lg hover:bg-app-muted/20 transition-colors font-bold"
            >
              ← Dashboard
            </Link>
          </div>
        </div>

        {/* QR-CODE GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {tables.map((table, index) => (
            <div
              key={table.id}
              className="bg-app-card border border-app-muted/20 rounded-lg p-6 shadow-sm flex flex-col"
            >
              {/* QR-Code Canvas */}
              <div className="mb-4 flex w-full items-center justify-center p-2">
                <canvas
                  ref={(el) => {
                    canvasRefs.current[index] = el;
                  }}
                  className="block"
                />
              </div>

              <h3 className="text-xl font-bold mb-2 text-center">{table.name || `Tisch ${table.label}`}</h3>

              <div className="text-xs text-app-muted mb-4 text-center break-all">
                {table.currentToken
                  ? getGuestUrl(table.label, table.currentToken)
                  : 'Token wird geladen...'}
              </div>

              <div className="w-full space-y-2">
                <button
                  onClick={() => regenerateQRCode(table)}
                  disabled={generating !== null}
                  className="w-full bg-app-primary hover:bg-app-primary/80 disabled:bg-app-muted disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors font-bold"
                >
                  {generating === `regenerate-${table.id}` ? 'Erstellt neu...' : 'Neuen QR-Code erstellen'}
                </button>

                <button
                  onClick={() => downloadQRCode(table, index)}
                  disabled={generating !== null || !table.currentToken}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:bg-app-muted disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors font-bold"
                >
                  {generating === `download-${table.id}` ? 'Lädt...' : 'Als JPG Herunterladen'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function QRCodePage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <QRCodeContent />
    </ProtectedRoute>
  );
}
