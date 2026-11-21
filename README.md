# What Breaks If I Ship This?

Predicts which user flows a real public GitHub PR breaks and proves each prediction by running the app with parallel Gemini Managed Agents and Decisions API evidence judging.

## Architecture

- **Triage (`gemini-4-hydrogen`)**: Read-only analysis of the PR diff and repository tree to narrow relevant files and subsystems.
- **Parallel Analysis (`gemini-4-carbon` & `gemini-4-argon`)**: Independent read-only predictions with strict Zod schema validation (`.strict()`, unknown fields rejected). Continues in single-analyzer mode if one fails.
- **Flow Merge & Decisions Scoring (`gemini-decision-1`)**: De-duplicates predictions by flow, scores risk in a single Decisions API `noul` request over the diff and predictions, and caps verification at the top 10 risky flows.
- **Verifier Fleet (`antigravity-preview-09-2026` / Hydrogen)**: Up to 6 concurrent sandboxes clone the PR head commit, start the app, drive the flow with Playwright, and save SHA-256 hashed screenshots and logs.
- **Independent Judge & Deterministic Verdicts (`gemini-decision-1` + server rule)**: Judges only the claim, screenshot, and trimmed log (never verifier prose). Confidence `< 0.7` triggers one re-run; persistent uncertainty becomes `unverified`. Verdicts (`confirmed`, `false_alarm`, `unverified`, `low_risk`) are set strictly by server code.

## Setup

1. Configure environment variables (see `.env.example`):
   - `GEMINI_API_KEY` (server-only)
   - `ACCESS_CODE` (required for `POST /api/runs`; if unset in local preview, claim an initial access code via the first-run setup card)
2. Install & run:
   - `npm run dev` — starts Express + Vite middleware on port 3000
   - `npm run build && npm start` — builds UI and runs production Node server
   - `npm test` — runs deterministic unit tests
   - `npm run eval` — runs the held-out evaluation against the Carbon-only baseline

## Known Issues / Smoke Check Notes

- Managed agents and `gemini-4-carbon` / `gemini-4-argon` require a billing-enabled `GEMINI_API_KEY`.
- Repositories that require external databases or unconfigured private services report `unverified` with the specific startup blocker rather than guessing.
