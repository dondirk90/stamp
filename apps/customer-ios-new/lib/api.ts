import { apiBaseUrl } from "@/lib/config";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message?: string) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const code =
      data && typeof data.error === "string"
        ? data.error
        : `http_${response.status}`;
    throw new ApiError(code, response.status);
  }

  return data as T;
}
