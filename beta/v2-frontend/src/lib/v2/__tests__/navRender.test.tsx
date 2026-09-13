// SHELL NAVIGATION RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Verifies the continuity components render honest, namespace-neutral navigation:
// primary nav points at the real index pages, breadcrumb marks the current page,
// match prev/next preserves slug links and never fabricates a link for a missing
// neighbour, and no /pitch (or betting) language is introduced anywhere.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { PrimaryNav, Breadcrumb, MatchNav } from '@/components/v2/nav';
import type { ApiEditionFixture } from '@/lib/v2/types';

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}
function text(node: React.ReactElement): string {
  return html(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const NEXT_FX: ApiEditionFixture = {
  fixtureId: '1385', kickoffAt: '2026-09-20T18:00:00.000Z', status: 'SCHEDULED',
  homeTeam: { id: '10', name: 'Palmeiras', slug: 'palmeiras-10' },
  awayTeam: { id: '11', name: 'Santos', slug: 'santos-11' },
  score: null,
};

describe('PrimaryNav', () => {
  const markup = html(<PrimaryNav />);
  test('links to the real index pages, all under /v2, none to /pitch', () => {
    assert.match(markup, /href="\/v2"/);         // Leagues
    assert.match(markup, /href="\/v2\/teams"/);
    assert.match(markup, /href="\/v2\/players"/);
    assert.equal(markup.includes('/pitch'), false);
  });
});

describe('Breadcrumb', () => {
  const markup = html(
    <Breadcrumb items={[{ label: 'Leagues', href: '/v2' }, { label: 'Série A · 2026', href: '/v2/editions/88' }, { label: 'Flamengo v Botafogo' }]} />,
  );
  test('renders links for ancestors and marks the current (last) page', () => {
    assert.match(markup, /href="\/v2"/);
    assert.match(markup, /href="\/v2\/editions\/88"/);
    assert.match(markup, /aria-current="page"/);          // last crumb is current
    assert.match(text(<Breadcrumb items={[{ label: 'Leagues', href: '/v2' }, { label: 'Flamengo v Botafogo' }]} />), /Flamengo v Botafogo/);
    assert.equal(markup.includes('/pitch'), false);
  });
});

describe('MatchNav', () => {
  test('renders a slug-preserving link for a real neighbour', () => {
    const markup = html(<MatchNav prev={null} next={NEXT_FX} editionId="88" competitionName="Série A" />);
    assert.match(markup, /href="\/v2\/matches\/palmeiras-vs-santos-1385"/); // canonical slug
    assert.match(markup, /href="\/v2\/editions\/88"/);                      // all-fixtures link
    assert.match(text(<MatchNav prev={null} next={NEXT_FX} editionId="88" competitionName="Série A" />), /Next/);
    assert.equal(markup.includes('/pitch'), false);
  });
  test('no neighbour -> no fabricated match link (honest empty), only the list link', () => {
    const markup = html(<MatchNav prev={null} next={null} editionId="88" competitionName="Série A" />);
    assert.equal(markup.includes('/v2/matches/'), false); // never invents a neighbour link
    assert.match(markup, /href="\/v2\/editions\/88"/);
  });
  test('no neighbours and no edition -> renders nothing at all', () => {
    assert.equal(html(<MatchNav prev={null} next={null} editionId={null} competitionName={null} />), '');
  });
});

describe('no betting language in shell navigation', () => {
  test('primary nav + a populated match nav carry no betting/odds lexicon', () => {
    const all = `${text(<PrimaryNav />)} ${text(<MatchNav prev={NEXT_FX} next={NEXT_FX} editionId="88" competitionName="Série A" />)}`.toLowerCase();
    for (const term of ['odds', 'bookmaker', 'stake', 'wager', 'accumulator', 'payout', 'betting']) {
      assert.equal(all.includes(term), false, `nav must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
