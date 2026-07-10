/**
 * BRAND — white-label configuration (single source of truth).
 * pitchterminal.com is the default identity; NinetyData RiP via env.
 * Rule: no component hard-codes a brand string — import BRAND instead;
 * one stray literal breaks the white-label mechanism.
 */
export const BRAND = {
  name:    process.env.NEXT_PUBLIC_BRAND_NAME    ?? 'Pitch Terminal',
  short:   process.env.NEXT_PUBLIC_BRAND_SHORT   ?? 'PT',
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE ?? 'Football Availability Intelligence',
  domain:  process.env.NEXT_PUBLIC_BRAND_DOMAIN  ?? 'pitchterminal.com',
} as const;
