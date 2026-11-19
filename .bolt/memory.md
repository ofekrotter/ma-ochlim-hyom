# Project memory

## Product intent & audience

- Restaurant-decision app named **"Ma Ochlim Hayom"** (Hebrew: "What are we eating today").
- Helps users decide where to eat; supports solo mode and friend/group mode.
- Core mechanics: swipe-to-choose, area filters, cuisine filters.
- Presumed primary audience: Hebrew-speaking users (based on app name).

## Brand personality & voice

- Casual, social, gamified tone implied by swipe interaction and "what are we eating" framing.

## Visual design & UX direction

- Card-based swipe-to-choose UX (Tinder-like) as the primary decision surface.
- Filter UI for geographic area and cuisine type.
- Backend: Supabase; exact data models and schema not yet reviewed.

## Decisions, constraints & rationale

- Tech stack includes Supabase for backend (database/auth/realtime assumed).
- Dependency install and production build pass cleanly in this environment.
- Dev server runs automatically via environment preview; no need to launch manually from shell.

## Open questions & assumptions

- UI language: is the full app in Hebrew, or bilingual?
- Friend mode specifics: how are groups formed, how are matches resolved, is real-time sync used?
- Auth model (Supabase auth? anonymous? phone/email?) not yet confirmed.
- Restaurant data source: user-generated, curated, or external API?
- Any design system, color palette, or typography preferences not yet expressed.