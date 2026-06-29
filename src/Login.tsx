import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Lock, LogIn, Loader2, Home } from 'lucide-react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from './firebase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Succesvolle login triggert de onAuthStateChanged in App.tsx
    } catch (err: any) {
      console.error('Login error:', err);
      setError('Inloggen mislukt. Controleer je e-mail en wachtwoord.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/90 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-white/50"
      >
        <div className="flex justify-center mb-6">
          <div className="bg-[#141e2b] p-4 rounded-2xl shadow-lg">
            <Home className="text-[#e67e22]" size={40} />
          </div>
        </div>
        
        <h1 className="text-3xl font-black text-center text-[#2d3e50] mb-2">
          WoonWens <span className="text-[#e67e22]">Manager</span>
        </h1>
        <p className="text-center text-slate-500 mb-8 font-medium">
          Log in om toegang te krijgen tot het dashboard.
        </p>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-xl mb-6 text-sm font-medium border border-red-100 flex items-center gap-2">
            <div className="w-1.5 h-full bg-red-500 rounded-full" />
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">E-mailadres</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Mail size={18} className="text-slate-400" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-11 pr-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#e67e22] focus:border-[#e67e22] outline-none transition-all font-medium"
                placeholder="naam@makelaar.nl"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Wachtwoord</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock size={18} className="text-slate-400" />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-11 pr-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#e67e22] focus:border-[#e67e22] outline-none transition-all font-medium"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3.5 mt-2 rounded-xl text-white font-bold text-lg shadow-md transition-all flex items-center justify-center gap-2 ${
              loading 
              ? 'bg-slate-400 cursor-not-allowed' 
              : 'bg-gradient-to-r from-[#141e2b] to-[#2d3e50] hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]'
            }`}
          >
            {loading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                <LogIn size={20} />
                Inloggen
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
