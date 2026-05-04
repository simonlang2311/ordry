'use client';

import { ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePersonalAuth } from '@/lib/usePersonalAuth';

type ProtectedRouteProps = {
  children: ReactNode;
  requiredRole?: string;
};

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const { isAuthenticated, isAuthInitialized, handlePasswordSubmit } = usePersonalAuth();

  const handlePasswordForm = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (!password) {
      setPasswordError('Passwort erforderlich');
      return;
    }

    if (handlePasswordSubmit(password)) {
      setPassword('');
    } else {
      setPasswordError('Passwort falsch');
      setPassword('');
    }
  };

  if (!isAuthInitialized) {
    return <div className="min-h-screen bg-slate-900"></div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#275D7B] text-white flex items-center justify-center p-4">
        <div className="bg-[#1e4a62] rounded-2xl shadow-2xl w-full max-w-md p-8 border border-white/10">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-white/20 p-3 rounded-2xl font-bold text-lg backdrop-blur-sm">P</div>
            <div>
              <h2 className="text-2xl font-bold">Personal-Bereich</h2>
              <p className="text-xs text-blue-200 font-medium uppercase">Authentifizierung erforderlich</p>
            </div>
          </div>

          <form onSubmit={handlePasswordForm} className="space-y-4">
            <div>
              <label className="text-sm font-bold text-blue-100 uppercase mb-2 block">
                Passwort
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Passwort eingeben"
                autoFocus
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white outline-none focus:border-white focus:ring-4 focus:ring-white/20 transition-all placeholder-blue-200/50"
              />
            </div>

            {passwordError && (
              <div className="bg-red-500/30 border border-red-400 text-red-100 px-4 py-3 rounded-lg text-sm font-medium">
                {passwordError}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-white text-[#275D7B] font-bold py-3 rounded-lg hover:bg-blue-50 transition-colors active:scale-95 shadow-lg"
            >
              Anmelden
            </button>

            <button
              type="button"
              onClick={() => router.push('/')}
              className="w-full bg-white/10 border border-white/20 hover:bg-white/20 text-white font-bold py-3 rounded-lg transition-colors"
            >
              Zur Startseite
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
