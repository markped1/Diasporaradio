
import React, { useState } from 'react';

interface PasswordModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const PasswordModal: React.FC<PasswordModalProps> = ({ onClose, onSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simplified hash verification for browser demo (use server-side auth in real prod)
    // Note: This matches "admin123"
    if (password === 'admin123') { 
      onSuccess();
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="glass-card w-full max-w-sm rounded-3xl p-8 shadow-2xl animate-scale-in">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-lock text-2xl"></i>
          </div>
          <h3 className="text-xl font-bold">Admin Portal</h3>
          <p className="text-sm text-gray-400">Restricted Access Area</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              placeholder="Enter Access Key"
              className={`w-full bg-black/40 border ${error ? 'border-red-500' : 'border-white/10'} rounded-xl px-4 py-3 focus:outline-none focus:border-green-500 text-center tracking-widest`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p className="text-red-500 text-[10px] mt-1 text-center">Incorrect password.</p>}
          </div>
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white/5 hover:bg-white/10 rounded-xl py-3 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-[2] gradient-bg text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-green-500/20 active:scale-95 transition-transform"
            >
              Authenticate
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordModal;
