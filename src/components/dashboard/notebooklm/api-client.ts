"use client";

export class NotebookApiError extends Error {
  status: number;
  detail: string;
  code?: string;

  constructor(status: number, message: string, detail: string, code?: string) {
    super(message);
    this.name = "NotebookApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

type ErrorPayload = {
  error?: string;
  detail?: string;
  code?: string;
};

export async function parseErrorResponse(
  res: Response,
  fallback = "Request failed",
): Promise<NotebookApiError> {
  let payload: ErrorPayload | null = null;
  try {
    payload = (await res.json()) as ErrorPayload;
  } catch {
    payload = null;
  }
  const detail = payload?.detail ?? payload?.error ?? res.statusText ?? fallback;
  const message = payload?.error ?? payload?.detail ?? fallback;
  return new NotebookApiError(res.status, message, detail, payload?.code);
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw await parseErrorResponse(res, "NotebookLM request failed");
  }
  return (await res.json()) as T;
}
