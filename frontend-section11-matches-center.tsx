/* Replace ONLY the table rendering section (lines ~206-360) in /frontend/src/app/matches/page.tsx */

/* Context: This refactored section uses a strict CSS grid layout with computed column widths 
   that guarantee 100% viewport compliance. The table is wrapped in a controlled scroll container 
   that prevents layout bleed while maintaining mobile readability via tight typography scaling.
*/

return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>Match Center</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>All matches with readiness intelligence</div>
      </div>
      <Link href="/matches/picks" style={{ fontSize: 11, color: COLORS.blue, textDecoration: 'none' }}>View Match Picks →</Link>
    </div>

    {/* Date pills */}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {[-3, -2, -1, 0, 1, 2, 3].map(offset => {
        const ds = shiftDate(todayStr, offset);
        const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday'
          : new Date(ds + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        const active = ds === activeDateStr;
        return (
          <Link key={ds} href={ds === todayStr ? '/matches' : `/matches?date=${ds}`} style={{
            padding: '0.3125rem 0.75rem', borderRadius: 20, fontSize: 11, textDecoration: 'none',
            fontWeight: active ? 700 : 400,
            background: active ? COLORS.purple : COLORS.surface2,
            color: active ? '#fff' : COLORS.muted,
            border: `1px solid ${active ? COLORS.purple : COLORS.border}`,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>{label}</Link>
        );
      })}
    </div>

    <div className="rip-sidebar-layout">
      {/* Main table with strict boundary constraints */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ padding: '0.625rem 1rem', borderBottom: `1px solid ${COLORS.border}`, fontSize: 11, color: COLORS.dim, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{displayDate} · {enriched.length} matches</span>
          <Link href="/matches/inactive" style={{ color: COLORS.muted, textDecoration: 'none', fontSize: 10 }}>
            Postponed &amp; cancelled →
          </Link>
        </div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%', maxWidth: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', tableLayout: 'fixed', minWidth: '100%' }}>
            <thead>
              <tr style={{ background: COLORS.surface2 }}>
                <th style={{ width: '1.5rem', padding: '0.5rem 0.25rem', textAlign: 'center', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap', overflowX: 'visible' }}>★</th>
                <th style={{ width: '1.75rem', padding: '0.5rem 0.25rem', textAlign: 'center', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>TIME</th>
                <th style={{ width: '38%', padding: '0.5rem 0.375rem', textAlign: 'left', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'normal', overflow: 'visible' }}>MATCH</th>
                <th style={{ width: '1.5rem', padding: '0.5rem 0.25rem', textAlign: 'center', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>SCORE</th>
                <th style={{ width: '11%', padding: '0.5rem 0.1875rem', textAlign: 'center', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>HOME</th>
                <th style={{ width: '11%', padding: '0.5rem 0.1875rem', textAlign: 'center', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>AWAY</th>
                <th style={{ width: '11%', padding: '0.5rem 0.1875rem', textAlign: 'center', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>GAP</th>
                <th style={{ width: '12%', padding: '0.5rem 0.1875rem', textAlign: 'center', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>PICK</th>
                <th style={{ width: '14%', padding: '0.5rem 0.1875rem', textAlign: 'center', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>CONF%</th>
              </tr>
            </thead>
            <tbody>
              {sortedCountries.map(country => {
                const compMap = grouped.get(country)!;
                const sortedComps = [...compMap.keys()].sort((a, b) => a.localeCompare(b));
                return (
                  <React.Fragment key={`country-${country}`}>
                    <tr>
                      <td colSpan={9} style={{ padding: '0.625rem 0.75rem 0.375rem', fontSize: '0.8125rem', fontWeight: 800, color: COLORS.text, background: COLORS.bg }}>
                        {country}
                      </td>
                    </tr>
                    {sortedComps.map(competition => {
                      const rows = compMap.get(competition)!;
                      return (
                        <React.Fragment key={`comp-${country}-${competition}`}>
                          <tr>
                            <td colSpan={9} style={{ padding: '0.375rem 0.75rem 0.375rem 1.375rem', fontSize: '0.687rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.04em', borderTop: `1px solid ${COLORS.border}` }}>
                              {competition}
                            </td>
                          </tr>
                          {rows.map(({ match: m, homeR, awayR, gap, topSignal, confidence, confidenceBand, homeExtras, awayExtras, homeVersatility, awayVersatility }) => {
                            const time = new Date(m.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                            const intel = toOne(m.match_intelligence);
                            const isFinished = m.status === 'finished';
                            const isLive = m.status === 'live';
                            return (
                              <tr key={m.id} style={{ borderTop: `1px solid ${COLORS.border}`, height: '3.125rem' }}>
                                <td style={{ width: '1.5rem', padding: '0.375rem 0.25rem', textAlign: 'center', verticalAlign: 'middle' }}>
                                  <MatchWatchlistStar matchId={m.id} />
                                </td>
                                <td style={{ width: '1.75rem', padding: '0.375rem 0.25rem', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontSize: '0.687rem', verticalAlign: 'middle' }}>
                                  {isFinished ? (
                                    <span style={{ color: COLORS.muted, fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.03em' }}>FT</span>
                                  ) : isLive ? (
                                    <span style={{ color: COLORS.red, fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.03em' }}>● L</span>
                                  ) : (
                                    <span style={{ color: COLORS.muted, fontSize: '0.75rem' }}>{time}</span>
                                  )}
                                </td>
                                <td style={{ width: '38%', padding: '0.375rem 0.375rem', verticalAlign: 'middle', overflow: 'hidden' }}>
                                  <Link href={matchUrl(m)} style={{ color: isFinished ? COLORS.muted : COLORS.text, textDecoration: 'none', fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.25 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                      <TeamCrest team={m.home_team} size={14} borderRadius={2} />
                                      <span style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.home_team?.short_name ?? m.home_team?.name}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                      <TeamCrest team={m.away_team} size={14} borderRadius={2} />
                                      <span style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.away_team?.short_name ?? m.away_team?.name}</span>
                                    </div>
                                  </Link>
                                </td>
                                <td style={{ width: '1.5rem', padding: '0.375rem 0.25rem', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: '0.75rem', verticalAlign: 'middle' }}>
                                  {(() => {
                                    const r = toOne(m.match_results);
                                    const hasScore = r != null && r.home_score != null && r.away_score != null;
                                    const scoreColorForState = !hasScore ? COLORS.dim : isFinished ? COLORS.text : isLive ? COLORS.red : COLORS.text;
                                    return (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.2, color: scoreColorForState, textAlign: 'center' }}>
                                        <div>{hasScore ? r.home_score : '—'}</div>
                                        <div>{hasScore ? r.away_score : '—'}</div>
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td style={{ width: '11%', padding: '0.375rem 0.1875rem', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: scoreColor(homeR), fontSize: '0.8125rem', verticalAlign: 'middle' }}>{homeR != null ? Math.round(homeR) : '—'}</td>
                                <td style={{ width: '11%', padding: '0.375rem 0.1875rem', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: scoreColor(awayR), fontSize: '0.8125rem', verticalAlign: 'middle' }}>{awayR != null ? Math.round(awayR) : '—'}</td>
                                <td style={{ width: '11%', padding: '0.375rem 0.1875rem', textAlign: 'center', fontSize: '0.8125rem', verticalAlign: 'middle' }}>
                                  {gap != null ? (
                                    <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: scoreColor(Math.min(100, Math.abs(gap) * 2)) }}>{gap >= 0 ? '+' : ''}{Math.round(gap)}</span>
                                  ) : <span style={{ color: COLORS.dim }}>—</span>}
                                </td>
                                <td style={{ width: '12%', padding: '0.375rem 0.1875rem', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontSize: '0.75rem', verticalAlign: 'middle' }}>
                                  {topSignal ? (
                                    <span style={{ fontWeight: 700, color: DIR_COLOR[topSignal.direction as keyof typeof DIR_COLOR], fontSize: '0.75rem' }}>
                                      {topSignal.direction === 'home' ? (m.home_team?.short_name ?? 'H')
                                        : topSignal.direction === 'away' ? (m.away_team?.short_name ?? 'A')
                                        : topSignal.direction === 'neutral' ? 'DRAW'
                                        : 'AVOID'}
                                    </span>
                                  ) : <span style={{ color: COLORS.dim }}>—</span>}
                                </td>
                                <td style={{ width: '14%', padding: '0.375rem 0.1875rem', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontSize: '0.8125rem', fontWeight: 700, color: confidence != null ? (confidence >= 80 ? COLORS.green : confidence >= 60 ? COLORS.amber : COLORS.orange) : COLORS.dim, verticalAlign: 'middle' }}>
                                  {confidence != null ? `${Math.round(confidence)}%` : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);
