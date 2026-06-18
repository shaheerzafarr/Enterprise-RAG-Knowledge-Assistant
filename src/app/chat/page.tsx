'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiService } from '../../services/api';
import { useSidebar } from '../../components/sidebar-context';
import { 
  Sparkles, 
  MessageSquarePlus, 
  Search, 
  Cpu, 
  FileText, 
  ShieldCheck,
  Loader2,
  Menu
} from 'lucide-react';

export default function ChatDashboardPage() {
  const { toggleMobileOpen } = useSidebar();
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const handleCreateSession = async () => {
    setCreating(true);
    try {
      const newSession = await apiService.chat.createSession();
      router.push(`/chat/${newSession.id}`);
    } catch (err) {
      console.error('Failed to create new session', err);
    } finally {
      setCreating(false);
    }
  };

  const features = [
    {
      icon: Search,
      title: "Grounded Semantic Search",
      description: "Matches user queries against local Qdrant vectors utilizing sentence-transformers for precise context retrieval."
    },
    {
      icon: Cpu,
      title: "Optimized LLM Reasoning",
      description: "Uses Google Gemini models to synthesize clean responses strictly constrained to retrieved context chunks."
    },
    {
      icon: FileText,
      title: "Inline Citation Map",
      description: "Interactive citation chips link generated assertions to specific paragraphs, filenames, and segment indices."
    },
    {
      icon: ShieldCheck,
      title: "Enterprise Multi-Tenancy",
      description: "Secured via JWT tokens, isolating document catalogs, sessions, and logs by authenticated user accounts."
    }
  ];

  return (
    <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden relative">
      {/* Header */}
      <header className="px-6 py-4 border-b border-slate-900/60 bg-slate-950/80 backdrop-blur-md flex items-center gap-4 shrink-0 z-10">
        <button
          onClick={toggleMobileOpen}
          className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-slate-800 rounded-xl transition-all cursor-pointer inline-flex md:hidden"
          title="Open Navigation"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>
        <div>
          <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            RAG Assistant Workspace
          </h1>
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Home Dashboard
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/60 via-slate-950 to-black p-8 overflow-y-auto relative">
        {/* Glow overlays */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-2xl text-center relative z-10 space-y-8">
        {/* Welcome Header */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-slate-900 border border-slate-800 rounded-full text-xs font-semibold text-slate-300">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            <span>Ready for Grounded Retrieval</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-100 sm:text-5xl">
            Enterprise RAG Workspace
          </h1>
          <p className="text-base text-slate-400 max-w-lg mx-auto">
            Interact with your ingested enterprise knowledge base securely using local embeddings, caching, and stream-synthesis.
          </p>
        </div>

        {/* Primary Call to Action */}
        <div>
          <button
            onClick={handleCreateSession}
            disabled={creating}
            className="inline-flex items-center gap-2.5 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-950 font-bold rounded-xl text-sm transition-all duration-200 cursor-pointer shadow-lg disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageSquarePlus className="h-4.5 w-4.5" />
            )}
            Start a New Conversation
          </button>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-12 text-left">
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <div 
                key={idx} 
                className="p-5 bg-slate-900/30 backdrop-blur-sm border border-slate-800/80 hover:border-slate-700/60 rounded-2xl transition-all duration-300 group"
              >
                <div className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-xl inline-block mb-3 group-hover:border-slate-700/60 transition-all">
                  <Icon className="h-5 w-5 text-slate-400 group-hover:text-slate-200 transition-colors" />
                </div>
                <h3 className="text-sm font-bold text-slate-200 mb-1">{feature.title}</h3>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}
