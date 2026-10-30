"use client";

import type { RunEvt } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "marquee.ws";

let tokenPromise: Promise<string> | null = null;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function workspaceToken(): Promise<string> {
  const t = readToken();
  if (t) return t;
  if (!tokenPromise) {
    tokenPromise = fetch(`${API_BASE}/workspace`, { method: "POST" })
      .then((r) => {
        if (!r.ok) throw new Error("workspace");
        return r.json();
      })
      .then((d: { token: string }) => {
        try {
          localStorage.setItem(TOKEN_KEY, d.token);
        } catch {}
        return d.token;
      })
      .finally(() => {
        tokenPromise = null;
      });
  }
  return tokenPromise;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = await workspaceToken().catch(() => "");
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers["X-Workspace"] = token;
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const r = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const d = await r.json();
      msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail ?? d);
    } catch {}
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

/** Stream SSE over fetch (works for GET replay streams and POST task streams).
 * Reconnects GET streams from the last seq seen. */
export async function streamSSE(
  path: string,
  onEvent: (e: RunEvt) => void,
  opts: { method?: "GET" | "POST"; json?: unknown; body?: BodyInit; signal?: AbortSignal; reconnect?: boolean } = {},
): Promise<void> {
  const token = await workspaceToken().catch(() => "");
  let last = 0;
  let attempts = 0;
  for (;;) {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) headers["X-Workspace"] = token;
    let body = opts.body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    const url = opts.method === "POST" ? `${API_BASE}${path}` : `${API_BASE}${path}${path.includes("?") ? "&" : "?"}after=${last}`;
    let finished = false;
    try {
      const r = await fetch(url, { method: opts.method || "GET", headers, body, signal: opts.signal });
      if (!r.ok || !r.body) {
        let msg = r.statusText;
        try {
          const d = await r.json();
          msg = d.detail || msg;
        } catch {}
        throw new ApiError(r.status, msg);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
          let evName = "message";
          const data: string[] = [];
          for (const line of chunk.split(/\r?\n/)) {
            if (line.startsWith("event:")) evName = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (evName === "ping" || !data.length) continue;
          try {
            const ev = JSON.parse(data.join("\n")) as RunEvt;
            if (ev.seq) last = Math.max(last, ev.seq);
            onEvent(ev);
            if (ev.kind === "done" || ev.kind === "result" || (ev.kind === "error" && (ev.stage === 0 || opts.method === "POST"))) finished = true;
          } catch {}
        }
      }
      if (finished || opts.method === "POST" || !opts.reconnect) return;
      return;
    } catch (e) {
      if (opts.signal?.aborted) return;
      if (e instanceof ApiError && e.status < 500) throw e;
      if (!opts.reconnect || opts.method === "POST" || attempts >= 5) throw e;
      attempts += 1;
      await new Promise((res) => setTimeout(res, 1000 * attempts));
    }
  }
}

export async function downloadCsv(eventId: string, query: string, filename: string): Promise<string> {
  const r = await fetch(`${API_BASE}/events/${eventId}/export.csv?${query}`);
  if (!r.ok) throw new Error("Export failed");
  const text = await r.text();
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return text;
}
