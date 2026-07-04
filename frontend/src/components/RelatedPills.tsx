'use client';
import Link from 'next/link';
import { COLORS } from '@/design/tokens';

export interface RelatedPillItem {
  href: string;
  label: string;
  /** Optional small value shown after the label, e.g. a readiness score
   *  or a date — colored if scoreColor is provided. */
  value?: string | number | null;
  valueColor?: string;
}

interface Props {
  items: RelatedPillItem[];
}

/** The "Related stocks" row from a stock quote page — small, horizontally
 *  scrollable, tappable chips that let you pivot to a comparable/related
 *  entity (next opponent, similar-readiness team) without leaving the
 *  current page's mental model or navigating through a full list first. */
export default function RelatedPills({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="rip-pills">
      {items.map((item, i) => (
        <Link key={i} href={item.href} className="rip-pill">
          <span>{item.label}</span>
          {item.value != null && (
            <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: item.valueColor ?? COLORS.text }}>
              {item.value}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
