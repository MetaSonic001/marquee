"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import * as Dialog from "@radix-ui/react-dialog";
import { Info, X } from "lucide-react";
import { useState } from "react";
import { cn, GLOSSARY, initials } from "@/lib/format";
import { COMPONENTS, COMPONENT_LABELS } from "@/lib/scoring";
import type { Components } from "@/lib/types";

export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="z-[70] max-w-[280px] rounded-lg border border-rule bg-[#1c1c1f] px-3 py-2 text-xs leading-relaxed text-ink shadow-2xl">
          {content}
          <Tooltip.Arrow className="fill-[#1c1c1f]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function InfoTip({ term, className }: { term: keyof typeof GLOSSARY | string; className?: string }) {
  const g = GLOSSARY[term];
  if (!g) return null;
  return (
    <Tip
      content={
        <span>
          <b className="block text-bulb">{g.title}</b>
          {g.def}
          <span className="mt-1 block text-slate">{g.example}</span>
        </span>
      }
    >
      <button type="button" aria-label={`What is ${g.title}?`} className={cn("inline-flex text-slate hover:text-ink", className)}>
        <Info size={12} strokeWidth={2.2} />
      </button>
    </Tip>
  );
}

export function BrandLogo({ name, src, size = 40, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!src || failed) {
    return (
      <div style={style} className={cn("grid shrink-0 place-items-center rounded-[5px] border border-rule bg-paper-3 font-mono font-bold text-bulb", className)} aria-label={`${name} logo`}>
        <span style={{ fontSize: size * 0.42 }}>{initials(name)}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={style}
      className={cn("shrink-0 rounded-[5px] border border-rule bg-white object-cover", className)}
    />
  );
}

const SEG_COLORS: Record<string, string> = {
  taste: "#EEE9E0",
  overlap: "#FF5A1F",
  local: "#F2C14E",
  momentum: "#5AD19A",
  sponsor: "#6E6A64",
};

export function FitBar({ components, weights, className }: { components: Partial<Components>; weights: Record<string, number | null>; className?: string }) {
  return (
    <Tip
      content={
        <span className="block space-y-1">
          <b className="block text-bulb">How the Fit is built</b>
          {COMPONENTS.map((k) => (
            <span key={k} className="flex items-center justify-between gap-4 font-mono text-[11px]">
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-sm" style={{ background: SEG_COLORS[k] }} />
                {COMPONENT_LABELS[k]}
              </span>
              <span>{components[k] == null ? "n/a" : `${Math.round((components[k] as number) * 100)} × ${weights[k]}%`}</span>
            </span>
          ))}
        </span>
      }
    >
      <div className={cn("flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[2px]", className)} role="img" aria-label="Fit components">
        {COMPONENTS.map((k) => {
          const w = weights[k];
          const v = components[k];
          if (w == null) return <div key={k} className="h-full bg-[repeating-linear-gradient(45deg,#3a3a3f_0_2px,transparent_2px_4px)]" style={{ flex: 4 }} />;
          return (
            <div key={k} className="relative h-full bg-paper-3" style={{ flex: w }}>
              <div className="absolute inset-y-0 left-0" style={{ width: `${Math.round((v ?? 0) * 100)}%`, background: SEG_COLORS[k] }} />
            </div>
          );
        })}
      </div>
    </Tip>
  );
}

export function SourceChip({ label, className }: { label?: string; className?: string }) {
  if (!label) return null;
  const web = label.toLowerCase().startsWith("web");
  return (
    <span className={cn("inline-flex items-center rounded-[3px] border px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-wide whitespace-nowrap", web ? "border-slate/40 text-slate" : "border-bulb/30 bg-bulb/[0.06] text-bulb", className)}>
      {label}
    </span>
  );
}

export function ToolBadge({ tool, className }: { tool: string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border border-bulb/30 bg-bulb/10 px-2 py-[1px] font-mono text-[10px] text-bulb", className)}>{tool}</span>;
}

export function Modal({ open, onOpenChange, title, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/40" />
        <Dialog.Content className={cn("fixed left-1/2 top-1/2 z-[61] max-h-[88vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-rule bg-paper-2 p-6 shadow-2xl", wide ? "max-w-4xl" : "max-w-xl")}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <Dialog.Title className="font-display text-3xl font-extrabold uppercase leading-none tracking-wide">{title}</Dialog.Title>
            <Dialog.Close className="rounded p-1 hover:bg-paper-2" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function HowMarqueeKnows({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="How Marquee knows">
      <div className="space-y-4 text-sm leading-relaxed">
        <p>
          <b>Qloo provides aggregate taste affinities.</b> Qloo&apos;s taste graph links what audiences love across music, film, TV, brands, places and more. Marquee
          asks it what <i>your crowd</i> — described by your lineup — over-indexes on.
        </p>
        <div className="divide-y divide-rule rounded border border-rule bg-paper-2/50">
          {(["taste", "overlap", "local", "momentum", "sponsor", "fit"] as const).map((k) => (
            <div key={k} className="px-3 py-2">
              <b>{GLOSSARY[k].title}.</b> {GLOSSARY[k].def}
            </div>
          ))}
        </div>
        <p>
          <b>Fit means audience alignment, not guaranteed ROI.</b> It tells you who your crowd already loves; it doesn&apos;t predict sales.
        </p>
        <p>
          <b>Web research is cited and may miss private deals.</b> Sponsor-activity chips only appear when a public source backs them.
        </p>
        <p>
          <b>No personal data is sent to Qloo.</b> Marquee sends only public cultural signals (performers, teams, shows) and brand names.
        </p>
        <p className="text-slate">
          Every number on a card comes from a Qloo response or a cited web source. Writing (the “why” bullets) is done by a language model that is only given those numbers and must cite one in every bullet.
        </p>
      </div>
    </Modal>
  );
}

export function Glossary({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Glossary">
      <dl className="space-y-3 text-sm">
        {Object.entries(GLOSSARY).map(([k, g]) => (
          <div key={k}>
            <dt className="font-display text-lg font-bold uppercase tracking-wide">{g.title}</dt>
            <dd>{g.def}</dd>
            <dd className="text-slate">{g.example}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-rule bg-paper-2/40 px-6 py-10 text-center">
      <p className="font-display text-2xl font-bold uppercase tracking-wide">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-slate">{children}</div>}
    </div>
  );
}

export function Button({ variant = "primary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "dark" }) {
  const v = {
    primary: "bg-bulb text-[#0c0c0d] hover:bg-ink border border-transparent",
    dark: "bg-paper-3 text-ink hover:bg-ink hover:text-paper border border-rule",
    outline: "border border-rule bg-transparent hover:border-ink",
    ghost: "hover:bg-paper-2",
  }[variant];
  return (
    <button
      {...props}
      className={cn("inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50", v, className)}
    />
  );
}
