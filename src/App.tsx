/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import { auth, onAuthStateChanged, User, signInWithPopup, googleProvider, db, doc, setDoc, serverTimestamp } from './lib/firebase';
import { LogIn, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Sync user to Firestore
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          lastLoginAt: serverTimestamp()
        }, { merge: true });
        setUser(user);
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    setLoginError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login failed:", error);
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError("Dost, tumne login popup band kar diya! Phir se try karo.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Ignore this one as it's usually a duplicate request
      } else {
        setLoginError("Login mein kuch gadbad ho gayi. Kripya phir se koshish karein.");
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white">
            <Sparkles size={32} />
          </div>
          <p className="text-zinc-500 font-medium">HP is waking up...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <AnimatePresence mode="wait">
        {!user ? (
          <motion.div 
            key="login"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="h-screen flex items-center justify-center p-4"
          >
            <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-2xl border border-zinc-100 text-center">
              <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center text-white mx-auto mb-6 shadow-lg shadow-indigo-200">
                <Sparkles size={40} />
              </div>
              <h1 className="text-3xl font-bold text-zinc-900 mb-2">HP AI</h1>
              <p className="text-zinc-500 mb-8 leading-relaxed">
                Welcome back, dost! Login to save your chat history and access advanced AI features.
              </p>
              
              {loginError && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mb-6 p-3 rounded-xl bg-red-50 text-red-600 text-sm border border-red-100"
                >
                  {loginError}
                </motion.div>
              )}

              <button
                onClick={handleLogin}
                className="w-full flex items-center justify-center gap-3 bg-zinc-900 text-white p-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-xl shadow-zinc-200"
              >
                <LogIn size={20} />
                Sign in with Google
              </button>
              <p className="mt-6 text-[10px] text-zinc-400 uppercase tracking-widest">
                Powered by Gemini & Firebase
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-screen"
          >
            <ChatInterface user={user} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
