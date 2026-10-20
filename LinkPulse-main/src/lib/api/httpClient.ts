/**
 * Centralized HTTP Client for LinkPulse API
 * Automatically manages Authorization headers, JSON body serialization,
 * error handling, and session cookies.
 */

export interface RequestOptions extends RequestInit {
  params?: Record<string, any>;
  skipAuth?: boolean;
}

class HttpClient {
  private getAuthToken(): string | null {
    if (typeof window === 'undefined') return null;
    return (
      localStorage.getItem('lp_token') ||
      sessionStorage.getItem('lp_token') ||
      null
    );
  }

  private buildUrl(endpoint: string, params?: Record<string, any>): string {
    let cleanPath = endpoint;
    if (!cleanPath.startsWith('/api/')) {
      cleanPath = cleanPath.startsWith('/')
        ? `/api/v1${cleanPath}`
        : `/api/v1/${cleanPath}`;
    }

    if (!params) return cleanPath;

    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, String(val));
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `${cleanPath}?${queryString}` : cleanPath;
  }

  public async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { params, skipAuth = false, headers = {}, ...customConfig } = options;
    const url = this.buildUrl(endpoint, params);

    const defaultHeaders: Record<string, string> = {
      Accept: 'application/json',
    };

    if (!skipAuth) {
      const token = this.getAuthToken();
      if (token && !token.startsWith('local_token_')) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
      }
    }

    const isFormData = customConfig.body instanceof FormData;
    if (!isFormData && customConfig.body && typeof customConfig.body === 'object') {
      defaultHeaders['Content-Type'] = 'application/json';
      customConfig.body = JSON.stringify(customConfig.body);
    }

    const config: RequestInit = {
      credentials: 'include', // Automatically passes HTTP-only session cookies
      headers: {
        ...defaultHeaders,
        ...(headers as Record<string, string>),
      },
      ...customConfig,
    };

    try {
      const res = await fetch(url, config);
      const contentType = res.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      const data = isJson ? await res.json() : await res.text();

      if (!res.ok) {
        const errorMsg =
          (isJson && data?.error) ||
          (isJson && data?.message) ||
          `Request failed with status ${res.status}`;
        const err = new Error(errorMsg);
        (err as any).status = res.status;
        (err as any).data = data;
        throw err;
      }

      return data as T;
    } catch (err: any) {
      // Re-throw with status or connection failure message
      throw err;
    }
  }

  public get<T = any>(endpoint: string, params?: Record<string, any>, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params, ...options });
  }

  public post<T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body, ...options });
  }

  public patch<T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body, ...options });
  }

  public put<T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body, ...options });
  }

  public delete<T = any>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', ...options });
  }
}

export const httpClient = new HttpClient();
