'use client';

interface Props {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

/** Generic tab bar — was previously hand-rolled inline on the match page
 *  (MARKET_TABS.map(...) with inline border-bottom styling) with no
 *  shared implementation for any other page to reuse. Mobile-first:
 *  horizontally scrollable (.rip-tabs has overflow-x: auto) rather than
 *  wrapping to a second line, which is what a fixed-width tab bar does
 *  on a narrow screen once there are more than 2-3 tabs. */
export default function Tabs({ tabs, active, onChange }: Props) {
  return (
    <div className="rip-tabs">
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`rip-tab${t === active ? ' active' : ''}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
