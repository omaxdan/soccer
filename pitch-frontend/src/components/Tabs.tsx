"use client";

import { useState, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

// Sticky, horizontally-scrollable segmented tab bar. Server-rendered panel
// content is passed in as `content` so each tab stays a server component.
export function Tabs({ items, initial }: { items: TabItem[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? items[0]?.id);
  const current = items.find((t) => t.id === active) ?? items[0];

  return (
    <div>
      <div className="sticky top-14 z-20 -mx-4 border-b border-line bg-ink/90 px-4 backdrop-blur">
        <div
          role="tablist"
          className="no-scrollbar flex gap-1 overflow-x-auto py-2"
        >
          {items.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={on}
                onClick={() => setActive(t.id)}
                className="mono relative shrink-0 rounded-md px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-wide transition-colors"
                style={{
                  color: on ? "var(--ink)" : "var(--muted)",
                  background: on ? "var(--amber)" : "transparent",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="pt-4 animate-fade-up" key={current?.id}>
        {current?.content}
      </div>
    </div>
  );
}
