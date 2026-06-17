'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { User } from '../types';
import { apiService } from '../services/api';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string, turnstileToken?: string) => Promise<void>;
  signup: (username: string, password: string, turnstileToken?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    async function loadUser() {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        setIsLoading(false);
        // If not authenticated and not on login/signup page, redirect to login
        if (pathname !== '/login' && pathname !== '/signup') {
          router.replace('/login');
        }
        return;
      }

      try {
        const currentUser = await apiService.auth.getMe();
        setUser(currentUser);
        setIsAuthenticated(true);
      } catch (err) {
        console.error('Failed to load user session', err);
        // Clear corrupt token
        localStorage.removeItem('auth_token');
        setUser(null);
        setIsAuthenticated(false);
        if (pathname !== '/login' && pathname !== '/signup') {
          router.replace('/login');
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadUser();
  }, [pathname, router]);

  const login = async (username: string, password: string, turnstileToken?: string) => {
    setIsLoading(true);
    try {
      const data = await apiService.auth.login(username, password, turnstileToken);
      localStorage.setItem('auth_token', data.access_token);
      setUser(data.user);
      setIsAuthenticated(true);
      router.replace('/chat');
    } catch (err) {
      setIsAuthenticated(false);
      setUser(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (username: string, password: string, turnstileToken?: string) => {
    setIsLoading(true);
    try {
      const data = await apiService.auth.signup(username, password, turnstileToken);
      localStorage.setItem('auth_token', data.access_token);
      setUser(data.user);
      setIsAuthenticated(true);
      router.replace('/chat');
    } catch (err) {
      setIsAuthenticated(false);
      setUser(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setUser(null);
    setIsAuthenticated(false);
    router.replace('/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
