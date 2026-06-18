'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth-provider';
import { UserPlus, User, KeyRound, Loader2, AlertCircle } from 'lucide-react';

export default function SignupPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);

  const { signup, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.replace('/chat');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    let active = true;

    const renderWidget = () => {
      if (!active || !containerRef.current || widgetIdRef.current) return;
      if (typeof window !== 'undefined' && (window as any).turnstile) {
        try {
          if (containerRef.current) {
            containerRef.current.innerHTML = '';
          }
          const id = (window as any).turnstile.render(containerRef.current, {
            sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY || "1x00000000000000000000AA",
            theme: 'dark',
            callback: (token: string) => {
              if (active) {
                setTurnstileToken(token);
              }
            },
          });
          widgetIdRef.current = id;
        } catch (e) {
          console.error("Turnstile render error:", e);
        }
      }
    };

    (window as any).onloadTurnstileCallback = () => {
      renderWidget();
    };

    // Dynamically insert the Turnstile script tag if not present
    let script = document.querySelector('script[src*="turnstile/v0/api.js"]') as HTMLScriptElement;
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback&render=explicit';
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    } else {
      if ((window as any).turnstile) {
        renderWidget();
      } else {
        const prevCallback = (window as any).onloadTurnstileCallback;
        (window as any).onloadTurnstileCallback = () => {
          if (prevCallback) prevCallback();
          renderWidget();
        };
      }
    }

    return () => {
      active = false;
      if (widgetIdRef.current && (window as any).turnstile) {
        try {
          (window as any).turnstile.remove(widgetIdRef.current);
        } catch (e) {}
        widgetIdRef.current = null;
      }
      delete (window as any).onloadTurnstileCallback;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim();

    if (!cleanUsername || !password || !confirmPassword) {
      setError('Please fill in all registration fields.');
      return;
    }

    if (cleanUsername.length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const bypass = process.env.NEXT_PUBLIC_BYPASS_TURNSTILE === 'true';
    const token = turnstileToken || (bypass ? 'dev-bypass-token' : null);

    if (!token) {
      setError("Please complete the 'I am not a robot' security check.");
      return;
    }

    try {
      await signup(cleanUsername, password, token);
    } catch (err: any) {
      setError(err?.message || 'Registration failed. Please choose another username.');
      // Reset Turnstile on error to force re-verification
      if (typeof window !== 'undefined' && (window as any).turnstile && turnstileToken) {
        (window as any).turnstile.reset();
        setTurnstileToken(null);
      }
    }
  };

  return (
    <div className="flex-1 min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black p-4">
      {/* Decorative background glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 p-8 rounded-2xl shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-slate-950 border border-slate-800 rounded-2xl mb-4 shadow-xl shadow-indigo-500/5">
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M4.5 7.5C6 5 9 3.5 12 3.5s6 1.5 7.5 4"
                stroke="url(#toruqx-taurus-horns-signup)"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M12 9c-3 0-5.5 2.5-5.5 5.5s2.5 5.5 5.5 5.5 5.5-2.5 5.5-5.5S15 9 12 9z"
                stroke="url(#toruqx-taurus-base-signup)"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="14.5" r="2" fill="#ffffff" />
              <defs>
                <linearGradient id="toruqx-taurus-horns-signup" x1="4.5" y1="3.5" x2="19.5" y2="7.5" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#3b82f6" />
                  <stop offset="0.5" stopColor="#6366f1" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
                <linearGradient id="toruqx-taurus-base-signup" x1="6.5" y1="9" x2="17.5" y2="20" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#ec4899" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-100">Join Toruqx</h1>
          <p className="text-sm text-slate-400 mt-2">
            Get started with your secure RAG workspace
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
                placeholder="Enter a username (min 3 chars)"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800/80 rounded-xl text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition-all text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider uppercase text-slate-400" htmlFor="password">
              Password
            </label>
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
                placeholder="Password (min 6 chars)"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800/80 rounded-xl text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition-all text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider uppercase text-slate-400" htmlFor="confirmPassword">
              Confirm Password
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                <KeyRound className="h-4 w-4" />
              </span>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                placeholder="Confirm password"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800/80 rounded-xl text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition-all text-sm"
              />
            </div>
          </div>

          {/* Cloudflare Turnstile Verification Widget */}
          <div className="flex justify-center my-3 bg-slate-950/20 py-2 border border-slate-800/30 rounded-xl">
            <div ref={containerRef}></div>
          </div>

          <button
            type="submit"
            disabled={isLoading || (!turnstileToken && process.env.NEXT_PUBLIC_BYPASS_TURNSTILE !== 'true')}
            className="w-full flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 text-slate-950 font-semibold rounded-xl text-sm transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="text-center mt-8">
          <p className="text-sm text-slate-400">
            Already have an account?{' '}
            <Link href="/login" className="text-slate-200 hover:underline font-medium">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
