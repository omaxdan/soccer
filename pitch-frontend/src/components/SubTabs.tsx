"use client";

import { useState, type ReactNode } from "react";

export interface SubTabItem {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

// Lightweight secondary tab strip for use *inside* an already-active primary
// tab (e.g. the Signals tab's Match Result / Half-Time / Goals & Cards /
// Competition categories). Not sticky — the primary Tabs bar owns that role.
export function SubTabs({ items, initial }: { items: SubTabItem[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? items[0]?.id);
  const current = items.find((t) => t.id === active) ?? items[0];

  return (
    <div>
      <div role="tablist" className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto">
        {items.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t.id)}
              className="mono flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.65rem] font-semibold tracking-wide transition-colors"
              style={{
                color: on ? "var(--ink)" : "var(--muted)",
                background: on ? "var(--amber)" : "var(--panel)",
                borderColor: on ? "var(--amber)" : "var(--line)",
              }}
            >
              {t.label}
              {t.count != null && (
                <span
                  className="rounded-full px-1.5 text-[0.55rem]"
                  style={{ background: on ? "rgba(0,0,0,0.15)" : "var(--raised)", color: on ? "var(--ink)" : "var(--faint)" }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div key={current?.id} className="animate-fade-up">{current?.content}</div>
    </div>
  );
}
