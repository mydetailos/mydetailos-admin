/**
 * Typed API client for the MY DETAIL OS backend.
 * Reads the base URL from NEXT_PUBLIC_API_URL.
 * Attaches the stored Bearer token on every request.
 */

import type { ApiResponse } from "@/types";

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("admin_token");
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = RequestInit & {
  /** When true, do not attach the stored Bearer token (e.g. login). */
  skipAuth?: boolean;
};

async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipAuth, ...init } = options;
  const token = skipAuth ? null : getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;

  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    const code = json?.error?.code;
    throw new ApiError(res.status, msg, code);
  }

  // If backend returned an error object even with 2xx status
  if (json && typeof json === "object" && "error" in json && json.error) {
    const msg = json.error.message ?? `HTTP ${res.status}`;
    const code = json.error.code;
    throw new ApiError(res.status || 400, msg, code);
  }

  // Backend wrapped in { data: ... }
  if (json && typeof json === "object" && "data" in json) {
    return json.data as T;
  }

  // Direct unwrapped payload (e.g. { tickets, total }, { payments }, etc.)
  return json as unknown as T;
}

export const apiClient = {
  get: <T>(path: string, opts?: { skipAuth?: boolean }) =>
    request<T>(path, { method: "GET", skipAuth: opts?.skipAuth }),
  post: <T>(path: string, body?: unknown, opts?: { skipAuth?: boolean }) =>
    request<T>(path, {
      method: "POST",
      body: body != null ? JSON.stringify(body) : undefined,
      skipAuth: opts?.skipAuth,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body != null ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body != null ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
