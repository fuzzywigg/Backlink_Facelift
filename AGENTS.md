# AGENTS.md — Backlink_Facelift

parent_governance: github.com/fuzzywigg/agents-governance

## Classification
- Tier: A (Active Strategic — Andrew flagged HIGH PRIORITY)
- Autonomy: L2 (Standard — non-critical infra)

## Purpose
LLM-curated internet radio on CF Workers. Proof of work for public build page.
Domain target: backlink.fuzzywigg.com

## Safe Agent Actions
- Update station genre mappings in `src/genres.ts` (wired from `src/index.ts`)
- Improve M3U parser in `src/parser.ts`
- Add / extend unit tests under `test/` for existing behavior
- Add new endpoints (e.g., `/playlist`, `/now-playing`)
- Update docs and deploy guides
- Bump dependency versions

## Verify
```bash
npm ci
npm run typecheck
npm test
```

## Escalate to Human
- Changes to GEMINI_API_KEY handling or any secret management
- Production deploy (first deploy must be HITL)
- Adding new external data sources beyond iptv-org
- Changes to CORS or authentication logic
- Any billing or CF account configuration
