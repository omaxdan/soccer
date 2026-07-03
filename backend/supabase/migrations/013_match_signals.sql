-- ─── MIGRATION 013 — Match Signals Precomputation ────────────────────────────
-- Converts computeMatchSignals() from a live-in-the-browser function (was in
-- frontend/src/lib/signals.ts, computed fresh on every match page load) into
-- a precomputed table, matching this project's core architecture principle:
-- zero runtime calculations, frontend reads only.
--
-- Also a prerequisite for any future signal-accuracy tracking — you can't
-- check whether a signal was "right" after the fact unless the signal
-- itself was persisted with a timestamp when it was generated, not
-- recomputed fresh (and silently different, as underlying data changes)
-- on every page load.

CREATE TABLE IF NOT EXISTS public.match_signals (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  match_id bigint NOT NULL,
  market text NOT NULL,
  signal_group text NOT NULL,
  signal_text text NOT NULL,
  direction text NOT NULL,
  strength integer NOT NULL,
  drivers text,
  data_source text,
  locked boolean DEFAULT false,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT match_signals_pkey PRIMARY KEY (id),
  CONSTRAINT match_signals_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id),
  CONSTRAINT match_signals_match_market_unique UNIQUE (match_id, market)
);

CREATE INDEX IF NOT EXISTS idx_match_signals_match_id ON public.match_signals(match_id);
