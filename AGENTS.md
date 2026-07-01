# AGENTS.md — Backlink_Facelift

parent_governance: github.com/fuzzywigg/agents-governance

## Classification
- Tier: A (Active Strategic — Andrew flagged HIGH PRIORITY)
- Autonomy: L2 (Standard — non-critical infra)

## Purpose
LLM-curated internet radio on CF Workers. Proof of work for public build page.
Domain target: backlink.fuzzywigg.com

## Safe Agent Actions
- Update station genre mappings in `src/index.ts`
- Improve M3U parser in `src/parser.ts`
- Add new endpoints (e.g., `/playlist`, `/now-playing`)
- Update docs and deploy guides
- Bump dependency versions

## Escalate to Human
- Changes to ANTHROPIC_API_KEY handling or any secret management
- Production deploy (first deploy must be HITL)
- Adding new external data sources beyond iptv-org
- Changes to CORS or authentication logic
- Any billing or CF account configuration
