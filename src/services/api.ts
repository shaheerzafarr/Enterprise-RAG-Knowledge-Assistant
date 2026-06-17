import { 
  User, 
  AuthResponse, 
  ChatSession, 
  Message, 
  DocumentUploadStatus, 
  APIErrorResponse 
} from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

/**
 * Custom request wrapper to automatically inject JWT token headers.
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Build headers
  const headers = new Headers(options.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  // Inject token if found in local storage
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorData: APIErrorResponse | null = null;
    try {
      errorData = await response.json();
    } catch {
      // Ignore JSON parsing failures on error responses
    }
    
    const errorMessage = errorData?.detail
      ? typeof errorData.detail === 'string'
        ? errorData.detail
        : JSON.stringify(errorData.detail)
      : `HTTP request failed with status ${response.status}`;
      
    throw new Error(errorMessage);
  }

  // Handle 204 No Content (empty response body)
  if (response.status === 204) {
    return null as unknown as T;
  }

  // If response is text/event-stream, we return the response directly so the caller can handle the stream
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('text/event-stream')) {
    return response as unknown as T;
  }

  return response.json() as Promise<T>;
}

export const apiService = {
  // Authentication
  auth: {
    signup: async (username: string, password: string, turnstileToken?: string): Promise<AuthResponse> => {
      return apiRequest<AuthResponse>('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, turnstile_token: turnstileToken }),
      });
    },

    login: async (username: string, password: string, turnstileToken?: string): Promise<AuthResponse> => {
      return apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, turnstile_token: turnstileToken }),
      });
    },

    getMe: async (): Promise<User> => {
      return apiRequest<User>('/auth/me');
    },
  },

  // Chat Sessions and Messages
  chat: {
    listSessions: async (): Promise<ChatSession[]> => {
      return apiRequest<ChatSession[]>('/chat/sessions');
    },

    createSession: async (title?: string): Promise<ChatSession> => {
      return apiRequest<ChatSession>('/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    },

    getSessionHistory: async (sessionId: string): Promise<Message[]> => {
      return apiRequest<Message[]>(`/chat/session/${sessionId}/history`);
    },

    deleteSession: async (sessionId: string): Promise<void> => {
      return apiRequest<void>(`/chat/session/${sessionId}`, {
        method: 'DELETE',
      });
    },

    /**
     * Submits a chat prompt and returns the raw response stream (EventStream).
     */
    sendStreamMessage: async (
      sessionId: string,
      query: string,
      limit: number = 5,
      detailLevel: 'normal' | 'descriptive' = 'normal'
    ): Promise<Response> => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE_URL}/chat/session/${sessionId}/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, limit, detail_level: detailLevel }),
      });

      if (!response.ok) {
        throw new Error(`Failed to initialize stream: ${response.statusText}`);
      }

      return response;
    },
  },

  // Document Ingestion
  ingestion: {
    ingestText: async (filename: string, content: string): Promise<DocumentUploadStatus> => {
      return apiRequest<DocumentUploadStatus>('/ingestion/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content }),
      });
    },

    ingestFile: async (file: File): Promise<DocumentUploadStatus> => {
      const formData = new FormData();
      formData.append('file', file);

      // Note: We let the browser set the boundary headers for FormData, so we don't set Content-Type
      return apiRequest<DocumentUploadStatus>('/ingestion/file', {
        method: 'POST',
        body: formData,
      });
    },

    getIngestionStatus: async (documentId: string): Promise<DocumentUploadStatus> => {
      return apiRequest<DocumentUploadStatus>(`/ingestion/status/${documentId}`);
    },

    listDocuments: async (): Promise<DocumentUploadStatus[]> => {
      return apiRequest<DocumentUploadStatus[]>('/ingestion');
    },

    deleteDocument: async (documentId: string): Promise<void> => {
      return apiRequest<void>(`/ingestion/${documentId}`, {
        method: 'DELETE',
      });
    },
  },
};
