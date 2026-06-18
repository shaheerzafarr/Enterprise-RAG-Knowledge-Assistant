'use client';

import React, { useState, useEffect, useRef } from 'react';
import { apiService } from '../../../services/api';
import { DocumentUploadStatus } from '../../../types';
import { useSidebar } from '../../../components/sidebar-context';
import { 
  UploadCloud, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  AlertCircle,
  FileCode,
  Trash2,
  Menu
} from 'lucide-react';

interface ActivePollingItem {
  docId: string;
  intervalId: NodeJS.Timeout;
}

export default function DocumentUploadPage() {
  const { toggleMobileOpen } = useSidebar();
  const [dragActive, setDragActive] = useState(false);
  const [uploads, setUploads] = useState<DocumentUploadStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isListLoading, setIsListLoading] = useState<boolean>(true);
  
  // Track active intervals to clear them on unmount
  const activePollers = useRef<ActivePollingItem[]>([]);

  useEffect(() => {
    async function loadIndexedDocuments() {
      try {
        const docs = await apiService.ingestion.listDocuments();
        setUploads(docs);
        
        // Auto-resume polling for pending/processing documents
        docs.forEach((doc) => {
          if (doc.status === 'pending' || doc.status === 'processing') {
            startPollingStatus(doc.id);
          }
        });
      } catch (err: any) {
        console.error('Failed to load ingested documents', err);
        setError('Failed to load historical ingestion logs.');
      } finally {
        setIsListLoading(false);
      }
    }

    loadIndexedDocuments();

    // Cleanup polling intervals on unmount
    return () => {
      activePollers.current.forEach((poller) => clearInterval(poller.intervalId));
    };
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setError(null);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await processUpload(files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = e.target.files;
    if (files && files.length > 0) {
      await processUpload(files[0]);
    }
  };

  // 1. Submit file to FastAPI backend
  const processUpload = async (file: File) => {
    const filename = file.name;
    const allowedExtensions = ['.txt', '.md', '.json', '.pdf'];
    const isAllowed = allowedExtensions.some(ext => filename.toLowerCase().endsWith(ext));

    if (!isAllowed) {
      setError('Unsupported file type. Only text, MD, JSON, and PDF files (.txt, .md, .json, .pdf) are allowed.');
      return;
    }

    // Add immediate local uploading status
    const tempDocId = crypto.randomUUID();
    const initialUpload: DocumentUploadStatus = {
      id: tempDocId,
      filename: file.name,
      file_size: file.size,
      chunk_count: 0,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    
    setUploads(prev => [initialUpload, ...prev]);

    try {
      const resultDoc = await apiService.ingestion.ingestFile(file);
      
      // Update with the actual backend document record details and start polling
      setUploads(prev => prev.map(u => u.id === tempDocId ? resultDoc : u));
      
      if (resultDoc.status === 'pending' || resultDoc.status === 'processing') {
        startPollingStatus(resultDoc.id);
      }
    } catch (err: any) {
      console.error('Failed to upload file', err);
      setUploads(prev => prev.map(u => u.id === tempDocId ? { 
        ...u, 
        status: 'failed', 
        error_message: err?.message || 'Ingestion failed.' 
      } : u));
    }
  };

  // 2. Poll Status Endpoint (/ingestion/status/{id}) every 2 seconds
  function startPollingStatus(docId: string) {
    // Prevent duplicate pollers
    if (activePollers.current.some(p => p.docId === docId)) return;

    const intervalId = setInterval(async () => {
      try {
        const docStatus = await apiService.ingestion.getIngestionStatus(docId);
        
        // Update local status list
        setUploads(prev => prev.map(u => u.id === docId ? docStatus : u));

        // Stop polling if completed or failed
        if (docStatus.status === 'completed' || docStatus.status === 'failed') {
          stopPolling(docId);
        }
      } catch (err) {
        console.error(`Error polling status for document ${docId}`, err);
        setUploads(prev => prev.map(u => u.id === docId ? { 
          ...u, 
          status: 'failed', 
          error_message: 'Failed to sync processing status.' 
        } : u));
        stopPolling(docId);
      }
    }, 2000);

    activePollers.current.push({ docId, intervalId });
  }

  function stopPolling(docId: string) {
    const index = activePollers.current.findIndex(p => p.docId === docId);
    if (index !== -1) {
      clearInterval(activePollers.current[index].intervalId);
      activePollers.current.splice(index, 1);
    }
  }

  const handleDeleteDocument = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document? This will permanently remove its indexed vector points from Qdrant.')) {
      return;
    }

    try {
      await apiService.ingestion.deleteDocument(documentId);
      setUploads((prev) => prev.filter((doc) => doc.id !== documentId));
    } catch (err: any) {
      console.error('Failed to delete document', err);
      alert(err?.message || 'Failed to delete this document.');
    }
  };

  // Helper to format byte counts
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

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
            <UploadCloud className="h-4 w-4 text-blue-400" />
            Document Ingestion Zone
          </h1>
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Index Documents Into Qdrant
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 relative">
        <div className="max-w-3xl mx-auto w-full space-y-8">
          
          {/* Page Info */}
          <div className="bg-slate-900/30 backdrop-blur-sm border border-slate-900 p-4 rounded-xl">
            <p className="text-xs text-slate-400 leading-relaxed">
              Upload text specifications or data documents. Uploaded text is chunked, converted to vector embeddings, and indexed into Qdrant in the background.
            </p>
          </div>

        {/* Global Error Banner */}
        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/40 rounded-xl flex items-center gap-3 text-red-200 text-sm">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Drag and Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center transition-all ${
            dragActive 
              ? 'border-blue-500 bg-blue-500/5' 
              : 'border-slate-800 hover:border-slate-700 bg-slate-900/10'
          }`}
        >
          <input
            type="file"
            id="file-upload"
            multiple={false}
            accept=".txt,.md,.json,.pdf"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl mb-4">
            <UploadCloud className="h-8 w-8 text-slate-400" />
          </div>

          <label htmlFor="file-upload" className="cursor-pointer">
            <span className="text-sm font-bold text-slate-200 hover:text-slate-100 underline decoration-slate-400">
              Click to upload
            </span>
            <span className="text-sm text-slate-400"> or drag and drop</span>
          </label>
          
          <p className="text-[10px] text-slate-600 font-bold uppercase mt-2 tracking-wider">
            TXT, MD, JSON, or PDF files only (Max 10MB)
          </p>
        </div>

        {/* Uploads Progress List */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ingestion Activity Log</h2>
          
          <div className="space-y-3">
            {isListLoading ? (
              <div className="text-center py-10 bg-slate-900/10 border border-slate-900 rounded-2xl text-xs text-slate-500 font-medium flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                <span>Syncing ingestion history...</span>
              </div>
            ) : uploads.length === 0 ? (
              <div className="text-center py-10 bg-slate-900/10 border border-slate-900 rounded-2xl text-xs text-slate-600 font-medium">
                No active uploads or ingestion sessions logged
              </div>
            ) : (
              uploads.map((upload) => (
                <div 
                  key={upload.id} 
                  className="p-4 bg-slate-900/25 border border-slate-900/80 rounded-2xl flex items-center justify-between gap-4"
                >
                  {/* File Metadata */}
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="p-2.5 bg-slate-950 border border-slate-900 rounded-xl">
                      {upload.filename.endsWith('.json') ? (
                        <FileCode className="h-5 w-5 text-indigo-400" />
                      ) : upload.filename.endsWith('.pdf') ? (
                        <FileText className="h-5 w-5 text-rose-500" />
                      ) : (
                        <FileText className="h-5 w-5 text-blue-400" />
                      )}
                    </div>
                    <div className="overflow-hidden">
                      <div className="text-xs font-semibold text-slate-200 truncate" title={upload.filename}>
                        {upload.filename}
                      </div>
                      <div className="text-[10px] text-slate-500 font-medium mt-0.5">
                        Size: {formatBytes(upload.file_size)} • Chunks: {upload.chunk_count}
                      </div>
                    </div>
                  </div>

                  {/* Realtime Ingestion Status Block */}
                  <div className="flex items-center gap-3">
                    {upload.status === 'pending' && (
                      <div className="flex items-center gap-2 text-[10px] font-bold text-yellow-500 bg-yellow-500/5 border border-yellow-500/15 px-3 py-1 rounded-full uppercase tracking-wider">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Uploading...</span>
                      </div>
                    )}
                    
                    {upload.status === 'processing' && (
                      <div className="flex items-center gap-2 text-[10px] font-bold text-blue-400 bg-blue-500/5 border border-blue-500/15 px-3 py-1 rounded-full uppercase tracking-wider">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Generating Vectors...</span>
                      </div>
                    )}

                    {upload.status === 'completed' && (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/5 border border-emerald-500/15 px-3 py-1 rounded-full uppercase tracking-wider">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Indexed</span>
                      </div>
                    )}

                    {upload.status === 'failed' && (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-400 bg-red-500/5 border border-red-500/15 px-3 py-1 rounded-full uppercase tracking-wider" title={upload.error_message || 'Unknown error'}>
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Failed</span>
                      </div>
                    )}

                    <button
                      onClick={() => handleDeleteDocument(upload.id)}
                      title="Delete Document"
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-900 border border-transparent hover:border-slate-850 rounded-xl transition-all cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
    </div>
  );
}
