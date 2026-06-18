'use client';

import React from 'react';
import Sidebar from '../../components/sidebar';
import { useAuth } from '../../components/auth-provider';
import { SidebarProvider, useSidebar } from '../../components/sidebar-context';
import { Loader2 } from 'lucide-react';

function ChatLayoutContent({ children }: { children: React.ReactNode }) {
  const { isMobileOpen, setIsMobileOpen } = useSidebar();

  return (
    <div className="flex-1 flex overflow-hidden h-screen max-h-screen relative">
      {/* Mobile Sidebar Backdrop Overlay */}
      {isMobileOpen && (
        <div 
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden transition-opacity duration-300"
        />
      )}
      
      <Sidebar />
      
      <main className="flex-1 flex flex-col h-screen max-h-screen overflow-hidden bg-slate-950">
        {children}
      </main>
    </div>
  );
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useAuth();

  // Fullscreen loader while validating authentication session state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400 mx-auto" />
          <p className="text-sm text-slate-500 font-medium tracking-wide">Validating session...</p>
        </div>
      </div>
    );
  }

  // Loading gate prevents layout flashing before redirect completes
  if (!isAuthenticated) {
    return null;
  }

  return (
    <SidebarProvider>
      <ChatLayoutContent>{children}</ChatLayoutContent>
    </SidebarProvider>
  );
}
