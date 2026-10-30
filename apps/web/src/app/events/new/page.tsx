"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { FileText, ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api, streamSSE } from "@/lib/api";
import { cn } from "@/lib/format";
import type { EventFull, ResolveResult } from "@/lib/types";
import { EntityPicker, SignalChip } from "@/components/entity-picker";
import { Button } from "@/components/ui";

type Sig = { key: string; raw: string; status: "resolved" | "pending" | "needs_input" | "unmatched"; id?: string; name?: string; type?: string | null; image?: string | null; candidates?: ResolveResult["candidates"] };

const TYPES = [
  ["festival", "Festival"],
  ["concert_tour", "Concert tour"],
  ["comedy", "Comedy show or tour"],
  ["sports_fan", "Sports fan event"],
  ["conference", "Conference"],
  ["food_festival", "Food festival"],
  ["college_fest", "College fest"],
  ["club_night", "Club night"],
  ["other", "Other"],
];
const EXCLUDES = ["alcohol", "tobacco", "gambling", "crypto"];
const AGES = ["18-24", "25-34", "35-44", "45-54", "55+"];

function Src({ s }: { s?: string }) {
  if (!s) return null;
  return <span className="ml-1.5 rounded-[3px] bg-bulb-soft px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wide">from {s}</span>;
}

export default function NewEvent() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [reading, setReading] = useState(false);
  const [readLog, setReadLog] = useState<string[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [logos, setLogos] = useState<string[]>([]);

  const [name, setName] = useState("");
  const [type, setType] = useState("festival");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("United States");
  const [dates, setDates] = useState("");
  const [attendance, setAttendance] = useState("");
  const [ages, setAges] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>(["tobacco", "gambling"]);
  const [existing, setExisting] = useState<string[]>([]);
  const [existingText, setExistingText] = useState("");
  const [signals, setSignals] = useState<Sig[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "application/pdf": [".pdf"], "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    onDrop: (acc, rej) => {
      if (rej.length) toast.error("Only PDF and image files");
      const next = [...files, ...acc];
      const pdfs = next.filter((f) => f.type === "application/pdf");
      const imgs = next.filter((f) => f.type !== "application/pdf");
      if (pdfs.length > 3 || imgs.length > 5) toast.error("Up to 3 PDFs and 5 images");
      if (next.some((f) => f.size > 15 * 1024 * 1024)) toast.error("Each file must be under 15 MB");
      setFiles([...pdfs.slice(0, 3), ...imgs.slice(0, 5)].filter((f) => f.size <= 15 * 1024 * 1024));
    },
  });

  const resolveSignal = async (raw: string) => {
    const key = `${raw}-${Date.now()}-${Math.random()}`;
    setSignals((s) => [...s, { key, raw, status: "pending" }]);
    try {
      const r = await api<ResolveResult>("/resolve", { method: "POST", json: { text: raw } });
      setSignals((s) =>
        s.map((x) =>
          x.key !== key
            ? x
            : r.status === "resolved"
              ? { ...x, status: "resolved", id: r.candidates[0].id, name: r.candidates[0].name, type: r.candidates[0].type, image: r.candidates[0].image }
              : r.status === "needs_input"
                ? { ...x, status: "needs_input", candidates: r.candidates }
                : { ...x, status: "unmatched" },
        ),
      );
    } catch {
      setSignals((s) => s.map((x) => (x.key === key ? { ...x, status: "unmatched" } : x)));
    }
  };

  const readEvent = async () => {
    if (!files.length && !url.trim() && !notes.trim()) {
      toast("Add a file, a link or a few lines first");
      return;
    }
    setReading(true);
    setReadLog([]);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    if (url.trim()) fd.append("url", url.trim());
    if (notes.trim()) fd.append("text", notes.trim());
    try {
      await streamSSE(
        "/intake",
        (e) => {
          if (e.kind === "progress" || e.kind === "warning") setReadLog((l) => [...l, (e.kind === "warning" ? "⚠ " : "") + e.summary]);
          if (e.kind === "error") toast.error(e.summary);
          if (e.kind === "result") {
            const b = (e.data || {}) as Record<string, unknown>;
            if (b.name) setName(String(b.name));
            if (b.type && TYPES.some(([k]) => k === b.type)) setType(String(b.type));
            if (b.city) setCity(String(b.city));
            if (b.country) setCountry(String(b.country));
            if (b.dates) setDates(String(b.dates));
            if (b.attendance) setAttendance(String(b.attendance).replace(/[^0-9]/g, ""));
            const fs = (b.field_sources || {}) as Record<string, string>;
            setSources(fs);
            const lg = ((b.logos_seen as string[]) || []).filter(Boolean);
            setLogos(lg);
            setExisting((x) => Array.from(new Set([...x, ...lg])));
            const ex = ((b.exclusion_hints as string[]) || []).filter((x) => EXCLUDES.includes(x));
            if (ex.length) setExclude((x) => Array.from(new Set([...x, ...ex])));
            const perf = ((b.performers as string[]) || []).slice(0, 10);
            const have = new Set(signals.map((s) => s.raw.toLowerCase()));
            perf.filter((p) => !have.has(p.toLowerCase())).forEach((p) => resolveSignal(p));
            setReadLog((l) => [...l, "✓ Brief ready — check the fields below"]);
          }
        },
        { method: "POST", body: fd },
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReading(false);
    }
  };

  const confirmed = signals.filter((s) => s.status === "resolved");
  const submit = async () => {
    if (!name.trim()) return toast.error("Give your event a name");
    if (!confirmed.length) return toast.error("Add at least one performer, team or show that Qloo can match");
    setSubmitting(true);
    try {
      const ev = await api<EventFull>("/events", {
        method: "POST",
        json: {
          name: name.trim(),
          type,
          city: city.trim() || null,
          country: country.trim() || null,
          dates: dates.trim() || null,
          attendance: attendance ? Number(attendance) : null,
          age_bands: ages,
          exclude_categories: exclude,
          existing_sponsors: existing,
          field_sources: sources,
          signals: confirmed.map((s) => ({ raw_text: s.raw, qloo_entity_id: s.id, entity_type: s.type, display_name: s.name, image_url: s.image, status: "resolved" })),
        },
      });
      const r = await api<{ run_id: string }>(`/events/${ev.id}/runs`, { method: "POST" });
      router.push(`/events/${ev.id}/runs/${r.run_id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setSubmitting(false);
    }
  };

  const input = "w-full rounded-[5px] border border-rule bg-paper px-3 py-2 text-sm";
  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-20 pt-8 sm:px-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate">Add your event</p>
      <h1 className="font-display text-5xl font-black uppercase leading-none tracking-wide sm:text-6xl">Tell us about your event</h1>
      <p className="mt-2 max-w-2xl text-slate">Drop in whatever you already have. Marquee reads it, fills the brief, and matches your lineup in Qloo. You stay in control of every field.</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        {/* Zone A */}
        <section className="rounded-md border border-rule bg-paper p-5">
          <h2 className="font-display text-2xl font-black uppercase tracking-wide">A · Drop anything about your event</h2>
          <div {...getRootProps()} className={cn("mt-3 cursor-pointer rounded-md border-2 border-dashed p-6 text-center transition-colors", isDragActive ? "border-rule bg-bulb-soft" : "border-rule hover:border-rule")} data-testid="dropzone">
            <input {...getInputProps()} data-testid="file-input" />
            <Upload className="mx-auto" size={22} />
            <p className="mt-2 text-sm font-medium">Deck, brochure, poster or stage photos</p>
            <p className="text-xs text-slate">Up to 3 PDFs and 5 images · 15 MB each</p>
          </div>
          {files.length > 0 && (
            <ul className="mt-3 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded border border-rule px-2 py-1 text-sm">
                  {f.type === "application/pdf" ? <FileText size={14} /> : <ImageIcon size={14} />}
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="font-mono text-[10px] text-slate">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-4 block text-xs font-medium">
            Website
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourfestival.com" className={cn(input, "mt-1")} />
          </label>
          <label className="mt-3 block text-xs font-medium">
            Or just tell us
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="e.g. A 3-day indie festival in Austin, ~20k a day. Lineup: Khruangbin, Japanese Breakfast…" className={cn(input, "mt-1")} />
          </label>
          <Button className="mt-4 w-full" onClick={readEvent} disabled={reading} data-testid="read-event">
            {reading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {reading ? "Reading your event…" : "Read my event"}
          </Button>
          {readLog.length > 0 && (
            <div className="mt-3 rounded bg-night p-3 font-mono text-[11px] text-ink" aria-live="polite">
              {readLog.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          )}
          {logos.length > 0 && (
            <div className="mt-3 rounded border border-rule p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate">Sponsors already on your materials</p>
              <p className="mt-1">{logos.join(", ")} — marked “Existing”, not recommended as new.</p>
            </div>
          )}
        </section>

        {/* Zone B */}
        <section className="rounded-md border border-rule bg-paper p-5">
          <h2 className="font-display text-2xl font-black uppercase tracking-wide">B · Event brief</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium sm:col-span-2">
              Event name <Src s={sources.name} />
              <input value={name} onChange={(e) => setName(e.target.value)} className={cn(input, "mt-1")} data-testid="event-name" />
            </label>
            <label className="block text-xs font-medium">
              Type <Src s={sources.type} />
              <select value={type} onChange={(e) => setType(e.target.value)} className={cn(input, "mt-1")}>
                {TYPES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Expected attendance <Src s={sources.attendance} />
              <input value={attendance} onChange={(e) => setAttendance(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={cn(input, "mt-1")} />
            </label>
            <label className="block text-xs font-medium">
              City <Src s={sources.city} />
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Austin" className={cn(input, "mt-1")} data-testid="event-city" />
            </label>
            <label className="block text-xs font-medium">
              Country <Src s={sources.country} />
              <input value={country} onChange={(e) => setCountry(e.target.value)} className={cn(input, "mt-1")} />
            </label>
            <label className="block text-xs font-medium sm:col-span-2">
              Dates <Src s={sources.dates} />
              <input value={dates} onChange={(e) => setDates(e.target.value)} className={cn(input, "mt-1")} />
            </label>
          </div>

          <div className="mt-5">
            <p className="text-xs font-medium">
              Crowd signals — performers, teams, shows <Src s={sources.performers} />
            </p>
            <p className="mb-2 text-[11px] text-slate">Each one is matched live in Qloo. Only confirmed matches are used.</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {signals.map((s) => (
                <span key={s.key} className="inline-flex flex-col gap-1">
                  <SignalChip label={s.name || s.raw} type={s.type} status={s.status} onRemove={() => setSignals((x) => x.filter((y) => y.key !== s.key))}>
                    {s.status === "unmatched" && <span className="text-[10px] no-underline">Qloo couldn&apos;t match this</span>}
                  </SignalChip>
                  {s.status === "needs_input" && (
                    <span className="flex flex-wrap gap-1 rounded border border-bulb bg-bulb-soft/50 p-1.5">
                      <span className="w-full text-[10px]">Which “{s.raw}”?</span>
                      {s.candidates?.map((c) => (
                        <button
                          key={c.id + c.type}
                          className="rounded border border-rule bg-paper px-1.5 py-0.5 text-[11px] hover:bg-ink hover:text-paper"
                          data-testid="candidate-chip"
                          onClick={() => setSignals((x) => x.map((y) => (y.key === s.key ? { ...y, status: "resolved", id: c.id, name: c.name, type: c.type } : y)))}
                        >
                          {c.name} <span className="font-mono text-[9px] uppercase opacity-70">{c.type}</span>
                          {c.release_year ? ` · ${c.release_year}` : ""}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              ))}
            </div>
            <EntityPicker placeholder="Add a performer, team or show" testId="signal-input" onPick={(p) => setSignals((x) => [...x, { key: p.id + Date.now(), raw: p.name, status: "resolved", id: p.id, name: p.name, type: p.type, image: p.image }])} />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-1 text-xs font-medium">Age bands (optional)</legend>
              <div className="flex flex-wrap gap-1.5">
                {AGES.map((a) => (
                  <button key={a} type="button" aria-pressed={ages.includes(a)} onClick={() => setAges((x) => (x.includes(a) ? x.filter((y) => y !== a) : [...x, a]))} className={cn("rounded border border-rule px-2 py-0.5 text-xs", ages.includes(a) && "bg-ink text-paper")}>
                    {a}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-xs font-medium">Categories to exclude</legend>
              <div className="flex flex-wrap gap-1.5">
                {EXCLUDES.map((a) => (
                  <button key={a} type="button" aria-pressed={exclude.includes(a)} onClick={() => setExclude((x) => (x.includes(a) ? x.filter((y) => y !== a) : [...x, a]))} className={cn("rounded border border-rule px-2 py-0.5 text-xs capitalize", exclude.includes(a) && "bg-stage text-paper border-stage")}>
                    {a}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <label className="mt-4 block text-xs font-medium">
            Existing sponsors (excluded from new recommendations)
            <div className="mt-1 flex flex-wrap gap-1.5">
              {existing.map((x) => (
                <span key={x} className="inline-flex items-center gap-1 rounded border border-rule px-2 py-0.5 text-xs">
                  {x}
                  <button type="button" onClick={() => setExisting((e) => e.filter((y) => y !== x))} aria-label={`Remove ${x}`}>
                    ×
                  </button>
                </span>
              ))}
              <input
                value={existingText}
                onChange={(e) => setExistingText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && existingText.trim()) {
                    e.preventDefault();
                    setExisting((x) => Array.from(new Set([...x, existingText.trim()])));
                    setExistingText("");
                  }
                }}
                placeholder="Type and press Enter"
                className="min-w-[160px] flex-1 rounded border border-rule bg-paper px-2 py-0.5 text-xs"
              />
            </div>
          </label>

          <Button className="mt-6 w-full py-3 text-base" onClick={submit} disabled={submitting} data-testid="find-sponsors">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null} Find my sponsors
          </Button>
          <p className="mt-2 text-center text-[11px] text-slate">No personal data is sent to Qloo — only public cultural signals.</p>
        </section>
      </div>
    </div>
  );
}
