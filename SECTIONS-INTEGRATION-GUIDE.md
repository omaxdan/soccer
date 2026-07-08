# Production-Ready Sections Integration Guide

## Overview
Six complete, drop-in React/Tailwind components addressing specific match intelligence UI improvements.

---

## SECTION 1: Match Details Hero Scoreboard
**File:** `SECTION1-MatchHeroScoreboard.tsx`

### Features
- Rigid 3-column layout (Home 38% | Score 24% | Away 38%)
- Dynamic team font scaling (text-base/lg for mobile)
- Isolated readiness gauges with repositioned labels
- Support for live, finished, and scheduled states

### Integration
```tsx
import MatchHeroScoreboard from '@/components/MatchHeroScoreboard';

<MatchHeroScoreboard
  homeTeam={{ name: 'Manchester City', short_name: 'MCI', readiness: 78 }}
  awayTeam={{ name: 'Liverpool', short_name: 'LIV', readiness: 72 }}
  homeScore={2}
  awayScore={1}
  halfTimeScore={{ home: 1, away: 0 }}
  isLive={true}
  isFinished={false}
/>
```

---

## SECTION 2: Structured Lineups Table
**File:** `SECTION2-LineupsTable.tsx`

### Features
- 4-column grid: Jersey # | Name | Position Tag | Confidence Badge
- Position grouping (GK, DEF, MID, FWD)
- Confidence color-coding
- Thin divider lines between rows

### Integration
```tsx
import LineupsTable from '@/components/LineupsTable';

<LineupsTable
  players={playerArray}
  teamName="Manchester City"
  positionGroups={groupedByPosition}
/>
```

---

## SECTION 3: Restructured Lineups Tab
**File:** `SECTION3-LineupsTabRestructured.tsx`

### Layout Hierarchy
1. Area Versatility (top)
2. Predicted Lineups (team grids)
3. Squad Readiness Impact
4. Position Depth & Metrics (expandable)

### Features
- No predictive signals or betting tips
- Informational-only statistical display
- Expandable detail sections
- Clean typography hierarchy

### Integration
```tsx
import MatchLineupTab from '@/components/MatchLineupTab';

<MatchLineupTab
  matchId="match-123"
  homeTeam={homeTeamData}
  awayTeam={awayTeamData}
  homeLineup={homePlayersArray}
  awayLineup={awayPlayersArray}
  areaVersatility={{ home: 7.2, away: 6.8 }}
  squadReadiness={{ homeBase: 72, awayBase: 68, homeInjuryImpact: -3, awayInjuryImpact: -5 }}
  positionDepth={depthByTeam}
/>
```

---

## SECTION 4: Sub-Navigation Tabs
**File:** `SECTION4-SubNavTabs.tsx`

### Features
- Isolated Readiness tab (marked "New")
- 3-column condensed row: Strength | Venue Impact | Match Risk
- Embedded expandable team metrics (Form, Fixture Load, Squad Stability, Rest Days)
- No Form Battle component

### Integration
```tsx
import SubNavTabs from '@/components/SubNavTabs';

<SubNavTabs
  activeTab={activeTab}
  onTabChange={setActiveTab}
  matchData={{
    readinessGap: 15,
    strength: { home: 78, away: 72 },
    venueImpact: { home: 5, away: -3 },
    matchRisk: 'medium'
  }}
/>
```

---

## SECTION 6: Gap Distribution with Tier Lists
**File:** `SECTION6-GapDistributionTiers.tsx`

### Features
- Expandable tier groups (20+, 10-20, 0-10, Negative)
- Match rows with team abbreviations and gap values
- Tier-specific color coding
- Progress bar visualization
- Summary statistics at bottom

### Integration
```tsx
import GapDistributionTiers from '@/components/GapDistributionTiers';

<GapDistributionTiers
  matches={matchesArray}
  title="Readiness Gap Distribution"
/>
```

### Data Format
```tsx
matches = [
  {
    id: 'match-1',
    home: { short_name: 'MCI', name: 'Manchester City' },
    away: { short_name: 'LIV', name: 'Liverpool' },
    gap: 28
  },
  // ...
]
```

---

## SECTION 7: Mobile Table Optimization
**File:** `SECTION7-MobileTableOptimization.tsx`

### Utilities Exported
- `ResponsiveTableWrapper` — touch-scroll container
- `OptimizedTable` — base table component
- `TeamCell` — 40-45% width team identity cell
- `NumericCell` — right-aligned monospace numbers
- `Badge` — color-coded status badges
- `MatchCenterTableOptimized` — complete example
- `LeagueAnalyticsTableOptimized` — complete example
- `injectTouchScrollCSS()` — CSS initialization

### Integration
```tsx
import {
  ResponsiveTableWrapper,
  OptimizedTable,
  TeamCell,
  NumericCell,
  Badge,
  MatchCenterTableOptimized,
  injectTouchScrollCSS,
} from '@/components/MobileTableOptimization';

// Call once on app init
useEffect(() => {
  injectTouchScrollCSS();
}, []);

// Use prebuilt tables
<MatchCenterTableOptimized matches={matchArray} />

// Or build custom
<ResponsiveTableWrapper>
  <OptimizedTable headers={headerArray} rows={rowArray} />
</ResponsiveTableWrapper>
```

---

## Design Tokens Required
All components use `COLORS` from `/frontend/src/design/tokens.ts`:
- `surface`, `surface2`, `bg`
- `text`, `text2`, `muted`, `dim`
- `border`
- `green`, `amber`, `orange`, `red`, `blue`, `purple`

No new token imports needed.

---

## Tailwind CSS Requirements
- Core utilities: `grid`, `gap`, `px-`, `py-`, `flex`, `text-`, `font-`, `rounded`, `border`, `bg-`
- Custom utilities: `touch-scroll-momentum` (defined in Section 7)
- No plugin or config changes needed

---

## Mobile Responsiveness
All components are:
- ✅ Mobile-first (start at 375px width)
- ✅ Touch-friendly (tap targets ≥44px)
- ✅ Momentum scroll enabled (iOS smooth scrolling)
- ✅ Responsive typography (base → lg scaling)
- ✅ No horizontal overflow beyond viewport

---

## Testing Checklist
- [ ] Section 1: Hero scoreboard — team names don't overlap score on mobile
- [ ] Section 2: Lineups table — all 4 columns visible on 375px width
- [ ] Section 3: Tab — no predictive signals visible, sections reorder correctly
- [ ] Section 4: Sub-nav — 3-column row fits without scroll, team metrics expand/collapse
- [ ] Section 6: Gap tiers — each tier expands to show match list without layout break
- [ ] Section 7: Tables — no horizontal overflow, team column wraps correctly
- [ ] All: Touch scroll active on iOS (swipe momentum continues after lift)
- [ ] All: Colors consistent with existing COLORS token palette

---

## Performance Notes
- All components use React.memo or functional patterns (no unnecessary re-renders)
- Large match lists (100+) in Section 6: consider pagination
- Table optimization reduces cell padding from `10px` to `3px` — tight but still readable at 12px base font

---

## Browser Support
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ iOS Safari 14+
- ✅ Android Chrome latest

---

## Deployment
1. Copy all 6 component files into `/frontend/src/components/`
2. Update import paths in pages/layouts as needed
3. Run `npm run build` to verify no Tailwind conflicts
4. Test on physical mobile device (iOS + Android) for touch scroll momentum
5. Commit with message: "feat: production-ready UI sections 1-7 (hero scoreboard, lineups, tabs, gap distribution, mobile optimization)"

---

## Revert Path
If needed, all old components can coexist — new components have distinct filenames. Import the old or new selectively per page.

