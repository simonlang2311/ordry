import { useState } from 'react';

type PasswordModalProps = {
  isOpen: boolean;
  onSubmit: (password: string) => boolean;
  onClose: () => void;
};

export const PasswordModal = ({ isOpen, onSubmit, onClose }: PasswordModalProps) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('Passwort erforderlich');
      return;
    }

    if (onSubmit(password)) {
      setPassword('');
    } else {
      setError('Passwort falsch');
      setPassword('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300">
        <div className="bg-[#275D7B] text-white p-6 sm:p-8">
          <h2 className="text-2xl sm:text-3xl font-bold">Personal-Bereich</h2>
          <p className="text-blue-100 text-sm mt-2">Bitte geben Sie das Passwort ein</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-4">
          <div>
            <label className="text-sm font-bold text-slate-700 uppercase mb-2 block">
              Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort eingeben"
              autoFocus
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 text-slate-900 outline-none focus:border-[#275D7B] focus:ring-4 focus:ring-[#275D7B]/10 transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-[#275D7B] hover:bg-[#1e4a62] text-white font-bold py-3 rounded-lg transition-colors active:scale-95"
          >
            Anmelden
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-lg transition-colors"
          >
            Abbrechen
          </button>
        </form>
      </div>
    </div>
  );
};
