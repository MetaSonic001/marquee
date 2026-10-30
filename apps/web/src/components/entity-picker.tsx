"use client";

import { useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import type { ResolveResult } from "@/lib/types";

export type Picked = { id: string; name: string; type?: string | null; image?: string | null };

/** Type a name -> resolve in Qloo -> confirm. Ambiguous names show candidate chips; nothing is guessed. */
export function EntityPicker({
  type,
  placeholder,
  onPick,
  buttonLabel = "Add",
  disabled,
  testId,
}: {
  type?: string;
  placeholder: string;
  onPick: (p: Picked) => void | Promise<void>;
  buttonLabel?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ResolveResult | null>(null);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setRes(null);
    try {
      const r = await api<ResolveResult>("/resolve", { method: "POST", json: { text: t, type } });
      if (r.status === "resolved" && r.candidates[0]) {
        await onPick(r.candidates[0]);
        setText("");
      } else setRes(r);
    } catch (e) {
      setRes({ status: "error", candidates: [], message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          data-testid={testId}
          className="min-w-0 flex-1 rounded-[5px] border border-rule bg-paper px-3 py-2 text-sm placeholder:text-slate/70"
          aria-label={placeholder}
        />
        <button type="submit" disabled={busy || disabled || !text.trim()} className="inline-flex items-center gap-1.5 rounded-[5px] bg-ink px-3 py-2 text-sm font-medium text-paper hover:bg-stage disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {buttonLabel}
        </button>
      </form>
      {res?.status === "needs_input" && (
        <div className="rounded-[5px] border border-bulb bg-bulb-soft/50 p-2.5" role="group" aria-label="Choose the right match">
          <p className="mb-1.5 text-xs font-medium">Qloo found more than one “{text}”. Which one?</p>
          <div className="flex flex-wrap gap-1.5">
            {res.candidates.map((c) => (
              <button
                key={c.id + (c.type || "")}
                type="button"
                onClick={async () => {
                  await onPick(c);
                  setRes(null);
                  setText("");
                }}
                className="rounded-[4px] border border-rule bg-paper px-2 py-1 text-left text-xs hover:bg-ink hover:text-paper"
                data-testid="candidate-chip"
              >
                <b>{c.name}</b> <span className="font-mono text-[10px] uppercase opacity-70">{c.type}</span>
                {c.release_year ? <span className="opacity-70"> · {c.release_year}</span> : null}
                {c.description && <span className="block max-w-[260px] truncate text-[10px] opacity-70">{c.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {(res?.status === "unmatched" || res?.status === "error") && (
        <p className="text-xs text-slate">{res.status === "error" ? `Qloo error: ${res.message || "try again"}` : `Qloo couldn't match “${text}”. Try the official name.`}</p>
      )}
    </div>
  );
}

export function SignalChip({ label, type, status, onRemove, children }: { label: string; type?: string | null; status: "resolved" | "pending" | "needs_input" | "unmatched"; onRemove?: () => void; children?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-xs",
        status === "resolved" && "border-rule bg-paper",
        status === "pending" && "border-rule bg-paper-2",
        status === "needs_input" && "border-bulb bg-bulb-soft",
        status === "unmatched" && "border-dashed border-slate/50 text-slate line-through decoration-slate/40",
      )}
      data-testid="signal-chip"
      data-status={status}
    >
      {status === "resolved" && <Check size={12} className="text-moss" />}
      {status === "pending" && <Loader2 size={12} className="animate-spin" />}
      <b className="font-medium">{label}</b>
      {type && <span className="font-mono text-[9px] uppercase text-slate">{type}</span>}
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 text-slate hover:text-ink" aria-label={`Remove ${label}`}>
          ×
        </button>
      )}
    </span>
  );
}
