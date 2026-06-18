'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from './auth-provider';
import { useSidebar } from './sidebar-context';
import { apiService } from '../services/api';
import { ChatSession } from '../types';
import { 
  MessageSquare, 
  Plus, 
  LogOut, 
  FolderUp, 
  User, 
  Loader2,
  Database,
  ChevronRight,
  Trash2,
  Menu
} from 'lucide-react';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { isCollapsed: contextCollapsed, toggleCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCollapsed = contextCollapsed && !isMobile;

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const router = useRouter();
  const params = useParams();
  const currentSessionId = params?.id as string;

  useEffect(() => {
    async function fetchSessions() {
      try {
        const data = await apiService.chat.listSessions();
        setSessions(data);
      } catch (err) {
        console.error('Failed to load chat sessions', err);
      } finally {
        setLoading(false);
      }
    }
    fetchSessions();

    const handleSessionUpdate = () => {
      fetchSessions();
    };

    window.addEventListener('chat-session-updated', handleSessionUpdate);
    return () => {
      window.removeEventListener('chat-session-updated', handleSessionUpdate);
    };
  }, [currentSessionId]);

  const handleCreateSession = async () => {
    setCreating(true);
    try {
      const newSession = await apiService.chat.createSession();
      setSessions((prev) => [newSession, ...prev]);
      if (window.innerWidth < 768) {
        setIsMobileOpen(false);
      }
      router.push(`/chat/${newSession.id}`);
    } catch (err) {
      console.error('Failed to create new session', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this conversation?')) {
      return;
    }
    
    try {
      await apiService.chat.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        router.push('/chat');
      }
    } catch (err) {
      console.error('Failed to delete session', err);
      alert('Failed to delete this chat session.');
    }
  };

  return (
    <aside 
      className={`h-screen flex flex-col bg-slate-950 border-r border-slate-900 select-none z-40 fixed md:relative top-0 bottom-0 left-0 transition-all duration-300 ease-in-out
        ${isCollapsed ? 'md:w-16' : 'md:w-72'}
        ${isMobileOpen ? 'translate-x-0 w-72 shadow-2xl' : '-translate-x-full md:translate-x-0'}
      `}
    >
      {/* Sidebar Header */}
      <div className={`p-4 border-b border-slate-900/60 flex items-center justify-between ${isCollapsed ? 'justify-center' : ''}`}>
        {!isCollapsed && (
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg shrink-0">
              <Database className="h-5 w-5 text-slate-300" />
            </div>
            <div className="overflow-hidden">
              <h2 className="text-sm font-bold text-slate-100 leading-none truncate">RAG Assistant</h2>
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block mt-0.5">Enterprise</span>
            </div>
          </div>
        )}
        <button
          onClick={window.innerWidth < 768 ? () => setIsMobileOpen(false) : toggleCollapsed}
          className={`p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-xl transition-all cursor-pointer ${isCollapsed ? 'mx-auto' : ''}`}
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          <Menu className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* Primary Action Button */}
      <div className={`p-4 ${isCollapsed ? 'flex justify-center' : ''}`}>
        <button
          onClick={handleCreateSession}
          disabled={creating}
          title="New Chat"
          className={`bg-slate-100 hover:bg-slate-200 text-slate-950 font-semibold rounded-xl transition-all duration-200 cursor-pointer disabled:opacity-50 flex items-center justify-center
            ${isCollapsed ? 'w-10 h-10 p-0' : 'w-full py-2.5 px-4 gap-2 text-sm'}
          `}
        >
          {creating ? (
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
          ) : (
            <Plus className="h-4.5 w-4.5" />
          )}
          {!isCollapsed && <span>New Chat</span>}
        </button>
      </div>

      {/* Navigation Links */}
      <div className={`px-4 mb-2 ${isCollapsed ? 'flex justify-center' : ''}`}>
        <Link
          href="/chat/upload"
          title="Document Ingestion"
          onClick={() => { if (window.innerWidth < 768) setIsMobileOpen(false); }}
          className={`flex items-center rounded-xl transition-all ${
            isCollapsed ? 'w-10 h-10 justify-center' : 'w-full px-3 py-2.5 justify-between text-sm font-medium'
          } ${
            pathnameMatches('/chat/upload') 
              ? 'bg-slate-900 text-slate-100 border border-slate-800' 
              : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
          }`}
        >
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 overflow-hidden'}`}>
            <FolderUp className="h-4.5 w-4.5 shrink-0" />
            {!isCollapsed && <span className="truncate">Document Ingestion</span>}
          </div>
          {!isCollapsed && <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />}
        </Link>
      </div>

      {!isCollapsed && (
        <div className="px-4 py-2">
          <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider">Recent Sessions</span>
        </div>
      )}

      {/* Dynamic Sessions List */}
      <div className={`flex-1 overflow-y-auto pb-4 space-y-1 ${isCollapsed ? 'px-0 flex flex-col items-center' : 'px-4'}`}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
          </div>
        ) : sessions.length === 0 ? (
          !isCollapsed && (
            <div className="text-center py-8 text-xs text-slate-600 font-medium">
              No chats created yet
            </div>
          )
        ) : (
          sessions.map((session) => {
            const isActive = currentSessionId === session.id;
            return (
              <div 
                key={session.id}
                className={`group relative flex items-center justify-center ${isCollapsed ? 'w-10' : 'w-full'}`}
              >
                <Link
                  href={`/chat/${session.id}`}
                  title={session.title}
                  onClick={() => { if (window.innerWidth < 768) setIsMobileOpen(false); }}
                  className={`flex items-center rounded-xl transition-all ${
                    isCollapsed 
                      ? 'w-10 h-10 justify-center' 
                      : 'flex-1 gap-2.5 px-3 py-2.5 pr-10 text-sm text-left'
                  } ${
                    isActive
                      ? 'bg-slate-900 text-slate-100 border border-slate-800/80'
                      : 'text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
                  }`}
                >
                  <MessageSquare className={`h-4.5 w-4.5 shrink-0 ${isActive ? 'text-slate-300' : 'text-slate-500'}`} />
                  {!isCollapsed && <span className="truncate font-medium">{session.title}</span>}
                </Link>
                {!isCollapsed && (
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    title="Delete Chat"
                    className="absolute right-2.5 opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-all cursor-pointer z-10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* User Session Footer Card */}
      <div className={`p-4 border-t border-slate-900/60 bg-slate-950/40 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!isCollapsed ? (
          <>
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="p-2 bg-slate-900 border border-slate-800 rounded-xl shrink-0">
                <User className="h-4 w-4 text-slate-400" />
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-semibold text-slate-200 truncate">
                  {user?.username || 'Authenticated User'}
                </div>
                <div className="text-[10px] text-slate-500 font-medium truncate">
                  Session Active
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              title="Sign Out"
              className="p-2 text-slate-500 hover:text-slate-200 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-xl transition-all cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            onClick={logout}
            title={`Sign Out (${user?.username || 'User'})`}
            className="p-2 text-slate-500 hover:text-slate-200 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-xl transition-all cursor-pointer animate-fade-in"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}

// Simple path helper to verify selection highlights
function pathnameMatches(path: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname === path;
}
