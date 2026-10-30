"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

/** The free backend sleeps when idle. Show a friendly state while it wakes, never a blank error. */
export function WakeGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "waking" | "ok" | "down">("checking");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const ping = async () => {
      slowTimer = setTimeout(() => !cancelled && setState((s) => (s === "checking" ? "waking" : s)), 1500);
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 70_000);
        const r = await fetch(`${API_BASE}/health`, { signal: ctl.signal, cache: "no-store" });
        clearTimeout(t);
        if (!cancelled) setState(r.ok ? "ok" : "down");
      } catch {
        if (!cancelled) setState("down");
      } finally {
        clearTimeout(slowTimer);
      }
    };
    ping();
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [tries]);

  if (state === "ok" || state === "checking") return <>{children}</>;
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3 no-print" role="status" aria-live="polite">
        <div className="flex items-center gap-3 rounded-md border border-rule bg-night px-4 py-2.5 text-ink shadow-lg">
          {state === "waking" ? (
            <>
              <span className="live-dot" aria-hidden />
              <span className="text-sm">
                <b className="font-display text-base tracking-wide">Waking up the stage…</b> the free backend naps when idle — about a minute.
              </span>
            </>
          ) : (
            <>
              <span className="text-sm">The backend didn&apos;t answer. It may still be starting.</span>
              <button className="rounded border border-bulb px-2 py-1 text-xs font-medium text-bulb hover:bg-bulb hover:text-ink" onClick={() => { setState("waking"); setTries((n) => n + 1); }}>
                Retry
              </button>
            </>
          )}
        </div>
      </div>
      {children}
    </>
  );
}
