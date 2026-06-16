'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiService } from '../../../services/api';
import { Message, CitationSource } from '../../../types';
import ChatMessageBubble from '../../../components/chat-message-bubble';
import { 
  Send, 
  Loader2, 
  ArrowDown, 
  Sparkles,
  AlertCircle
} from 'lucide-react';

export default function ChatSessionPage() {
  const params = useParams();
  const sessionId = params?.id as string;
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionTitle, setSessionTitle] = useState('Conversation');
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailLevel, setDetailLevel] = useState<'normal' | 'descriptive'>('normal');

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottomButton, setShowScrollBottomButton] = useState(false);

  // 1. Fetch Session Message History on Mount
  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      setError(null);
      try {
        // Retrieve session history
        const history = await apiService.chat.getSessionHistory(sessionId);
        setMessages(history);
        
        // Match the session title from global sessions list
        const sessions = await apiService.chat.listSessions();
        const activeSession = sessions.find((s) => s.id === sessionId);
        if (activeSession) {
          setSessionTitle(activeSession.title);
        }
      } catch (err: any) {
        console.error('Failed to load chat logs', err);
        setError('Failed to retrieve chat history logs.');
        router.replace('/chat');
      } finally {
        setLoading(false);
        setTimeout(scrollToBottomForce, 50);
      }
    }
    
    if (sessionId) {
      loadHistory();
    }
  }, [sessionId, router]);

  // 2. Auto-scroll lock logic
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Check distance from bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // Show scroll bottom arrow if user has scrolled up more than 200px
    setShowScrollBottomButton(distanceFromBottom > 200);
  };

  const scrollToBottomForce = () => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  const scrollToBottomLock = () => {
    const container = scrollContainerRef.current;
    if (container) {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      // Scroll to bottom only if user is already near the bottom (within 150px threshold)
      if (distanceFromBottom < 150) {
        container.scrollTop = container.scrollHeight;
      }
    }
  };

  // 3. Handle Message Submission and SSE Response Streaming
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || streaming) return;

    const queryText = inputValue.trim();
    setInputValue('');
    setError(null);

    // Append User message locally in UI state first
    const userMessageId = crypto.randomUUID();
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content: queryText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setTimeout(scrollToBottomForce, 20);

    // Setup streaming placeholder Assistant message
    const assistantMessageId = crypto.randomUUID();
    const assistantMessagePlaceholder: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      sources: [],
    };
    
    setMessages((prev) => [...prev, assistantMessagePlaceholder]);
    setStreaming(true);

    try {
      // Initiate Server-Sent Events stream from backend
      const response = await apiService.chat.sendStreamMessage(sessionId, queryText, 5, detailLevel);
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response stream body reader is unavailable.');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      let accumulatedSources: CitationSource[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep partial line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') continue;
            
            try {
              const data = JSON.parse(jsonStr);
              if (data.type === 'sources') {
                accumulatedSources = data.sources;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, sources: accumulatedSources }
                      : msg
                  )
                );
              } else if (data.type === 'token') {
                accumulatedContent += data.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: accumulatedContent }
                      : msg
                  )
                );
                // Apply scroll lock constraints
                scrollToBottomLock();
              } else if (data.type === 'error') {
                setError(data.content);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: `Error: ${data.content}` }
                      : msg
                  )
                );
              }
            } catch (err) {
              console.error('Failed to parse stream event segment', err);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Failed message streaming cycle', err);
      setError(err?.message || 'Error occurred while streaming reasoning response.');
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: 'Failed to obtain response from the reasoning assistant.' }
            : msg
        )
      );
    } finally {
      setStreaming(false);
      setTimeout(scrollToBottomLock, 50);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-950 relative">
      {/* Session Header */}
      <header className="px-6 py-4 border-b border-slate-900/60 bg-slate-950/80 backdrop-blur-md flex items-center justify-between shrink-0 z-10">
        <div>
          <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-400" />
            {sessionTitle}
          </h1>
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Active Retrieval Session
          </span>
        </div>
      </header>

      {/* Messages Canvas */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-6 select-text"
      >
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <Loader2 className="h-6 w-6 animate-spin text-slate-600 mx-auto" />
              <p className="text-xs text-slate-500 font-medium tracking-wide">Syncing conversation logs...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-2 max-w-sm">
              <Sparkles className="h-8 w-8 text-blue-500/30 mx-auto" />
              <p className="text-sm font-bold text-slate-400">Isolated Chat Stream Active</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Submit a prompt to retrieve grounding contexts and synthesize answers.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      {/* Floating snap bottom scroll lock indicator */}
      {showScrollBottomButton && (
        <button
          onClick={scrollToBottomForce}
          className="absolute bottom-24 right-8 p-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-full shadow-2xl z-20 transition-all cursor-pointer"
          title="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}

      {/* Error Alert Bar */}
      {error && (
        <div className="max-w-3xl mx-auto w-full px-6 mb-2">
          <div className="p-3 bg-red-950/20 border border-red-900/40 rounded-xl flex items-center gap-2.5 text-red-200 text-xs">
            <AlertCircle className="h-4.5 w-4.5 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Chat Input Dock */}
      <div className="p-6 border-t border-slate-900/60 bg-slate-950/80 backdrop-blur-md shrink-0 z-10">
        <div className="max-w-3xl mx-auto mb-3 flex items-center justify-between text-xs">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Response Detail Level
          </span>
          <div className="flex bg-slate-900/80 border border-slate-800/85 p-0.5 rounded-lg">
            <button
              type="button"
              onClick={() => setDetailLevel('normal')}
              disabled={loading || streaming}
              className={`px-3 py-1 rounded-md font-semibold text-xs tracking-wide transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                detailLevel === 'normal'
                  ? 'bg-blue-600/20 border border-blue-500/30 text-blue-400 font-bold shadow-sm'
                  : 'border border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => setDetailLevel('descriptive')}
              disabled={loading || streaming}
              className={`px-3 py-1 rounded-md font-semibold text-xs tracking-wide transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                detailLevel === 'descriptive'
                  ? 'bg-blue-600/20 border border-blue-500/30 text-blue-400 font-bold shadow-sm'
                  : 'border border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Descriptive
            </button>
          </div>
        </div>
        <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex items-center gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={loading || streaming}
            placeholder={streaming ? 'Assistant is synthesizing...' : 'Ask a question from your ingested files...'}
            className="flex-1 px-4 py-3 bg-slate-900 border border-slate-800/80 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-700 focus:ring-1 focus:ring-slate-700 transition-all text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || streaming || !inputValue.trim()}
            className="p-3 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-900 text-slate-950 disabled:text-slate-600 rounded-xl transition-all cursor-pointer disabled:cursor-not-allowed border border-transparent disabled:border-slate-800"
          >
            {streaming ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
            ) : (
              <Send className="h-4.5 w-4.5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
