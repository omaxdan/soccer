"use client";

import { useState } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

// Small "ⓘ" trigger that expands into What/Why/Question — the three
// things every metric in this product must be able to answer. Collapsed
// by default per the mobile-first rule: metric + icon, not a wall of text.
export function Explain({ metric, className = "" }: { metric: GlossaryKey; className?: string }) {
  const [open, setOpen] = useState(false);
  const entry = GLOSSARY[metric];
  if (!entry) return null;
  return (
    <span className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Explain ${entry.label}`}
        className="mono ml-1 inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-line text-[0.55rem] text-faint transition-colors hover:border-amber hover:text-amber"
      >
        i
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-20 w-64 rounded-term border border-line bg-raised p-3 text-left shadow-lg">
          <p className="mono mb-1.5 text-[0.6rem] font-semibold uppercase tracking-wide text-amber">{entry.label}</p>
          <p className="mb-2 text-[0.72rem] leading-relaxed text-text">{entry.what}</p>
          <p className="mb-2 text-[0.7rem] leading-relaxed text-muted"><span className="text-faint">Why it matters — </span>{entry.why}</p>
          <p className="mono border-t border-line pt-2 text-[0.62rem] italic leading-relaxed text-faint">{entry.question}</p>
        </div>
      )}
    </span>
  );
}

// A single computed metric with its own evidence lines built from REAL
// data already on the page (not the static glossary) — for scores that
// decompose into visible sub-components, e.g. readiness -> form/venue/
// rest/stability deltas. Collapsed by default; tap to expand.
export function EvidenceDisclosure({
  label,
  lines,
  facts,
}: {
  label: string;
  lines: { text: string; positive?: boolean }[];
  // Real, individually-sourced numbers shown below the evidence list —
  // never a derived summary sentence like "N of 6 streams agree", since
  // that implies a countable list the user can verify against and none
  // exists. Each fact is its own real column, labeled as what it is.
  facts?: { label: string; value: string; explain?: GlossaryKey }[];
}) {
  const [open, setOpen] = useState(false);
  if (lines.length === 0) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mono flex items-center gap-1 text-[0.62rem] text-faint transition-colors hover:text-amber"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        Why {label.toLowerCase()}?
      </button>
      {open && (
        <div className="mt-1.5 rounded-term border border-line bg-raised p-2.5">
          <ul className="space-y-1">
            {lines.map((l, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[0.7rem] leading-snug">
                <span className={l.positive === false ? "text-risk" : "text-edge"}>{l.positive === false ? "✗" : "✓"}</span>
                <span className="text-muted">{l.text}</span>
              </li>
            ))}
          </ul>
          {facts && facts.length > 0 && (
            <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-[0.62rem] text-muted">
              {facts.map((f, i) => (
                <span key={i} className="flex items-center">
                  {f.label} <span className="ml-1 font-semibold text-text">{f.value}</span>
                  {f.explain && <Explain metric={f.explain} />}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
