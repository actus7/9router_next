/**
 * API utility functions for making HTTP requests
 */

export interface ApiError extends Error {
  status: number;
  data: unknown;
}

export interface RequestOptions extends Omit<RequestInit, "method" | "body"> {
  headers?: Record<string, string>;
}

const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

/**
 * Make a GET request
 */
export async function get<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse<T>(response);
}

/**
 * Make a POST request
 */
export async function post<T = unknown>(url: string, data: unknown, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    body: JSON.stringify(data),
    ...options,
  });
  return handleResponse<T>(response);
}

/**
 * Make a PUT request
 */
export async function put<T = unknown>(url: string, data: unknown, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    body: JSON.stringify(data),
    ...options,
  });
  return handleResponse<T>(response);
}

/**
 * Make a DELETE request
 */
export async function del<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse<T>(response);
}

/**
 * Handle API response
 */
async function handleResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();

  if (!response.ok) {
    const error = new Error(
      (data as { error?: string })?.error || "An error occurred"
    ) as ApiError;
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data as T;
}

const api = { get, post, put, del };
export default api;
