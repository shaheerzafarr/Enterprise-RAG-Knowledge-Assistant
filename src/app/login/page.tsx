'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth-provider';
import { KeyRound, User, Loader2, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  
  const { login, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If user is already authenticated, redirect straight to chat
    if (isAuthenticated && !isLoading) {
      router.replace('/chat');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    // Add callback to window for Cloudflare Turnstile
    (window as any).onTurnstileSuccess = (token: string) => {
      setTurnstileToken(token);
    };

    // Dynamically insert the Turnstile script tag
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
      delete (window as any).onTurnstileSuccess;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!username.trim() || !password.trim()) {
      setError('Please fill in all credentials fields.');
      return;
    }

    if (!turnstileToken) {
      setError("Please complete the 'I am not a robot' security check.");
      return;
    }

    try {
      await login(username.trim(), password, turnstileToken);
    } catch (err: any) {
      setError(err?.message || 'Login failed. Please check your credentials.');
      // Reset Turnstile on error to force re-verification
      if (typeof window !== 'undefined' && (window as any).turnstile) {
        (window as any).turnstile.reset();
        setTurnstileToken(null);
      }
    }
  };

  return (
    <div className="flex-1 min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black p-4">
      {/* Decorative background glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 p-8 rounded-2xl shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-slate-950 border border-slate-800 rounded-xl mb-4">
            <KeyRound className="h-6 w-6 text-slate-300" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Welcome Back</h1>
          <p className="text-sm text-slate-400 mt-2">
            Access the Enterprise RAG Knowledge Assistant
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-900/50 rounded-xl flex items-start gap-3 text-red-200 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider uppercase text-slate-400" htmlFor="username">
              Username
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                <User className="h-4 w-4" />
              </span>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                placeholder="Enter your username"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800/80 rounded-xl text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition-all text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold tracking-wider uppercase text-slate-400" htmlFor="password">
                Password
              </label>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                <KeyRound className="h-4 w-4" />
              </span>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800/80 rounded-xl text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition-all text-sm"
              />
            </div>
          </div>

          {/* Cloudflare Turnstile Verification Widget */}
          <div className="flex justify-center my-3 bg-slate-950/20 py-2 border border-slate-800/30 rounded-xl">
            <div
              className="cf-turnstile"
              data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY || "1x00000000000000000000AA"}
              data-theme="dark"
              data-callback="onTurnstileSuccess"
            ></div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !turnstileToken}
            className="w-full flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 text-slate-950 font-semibold rounded-xl text-sm transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="text-center mt-8">
          <p className="text-sm text-slate-400">
            Don't have an account?{' '}
            <Link href="/signup" className="text-slate-200 hover:underline font-medium">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
