# Backlink — Deployment Guide

## Prerequisites
- Cloudflare account with Workers enabled
- `wrangler` CLI installed (`npm i -g wrangler`)
- Anthropic API key
- Node.js 18+

## Steps

### 1. Install dependencies
```bash
npm install
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Create the KV namespace
```bash
wrangler kv namespace create CATALOG_CACHE
```
Copy the `id` from the output and paste it into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "CATALOG_CACHE"
id = "your-kv-id-here"  # ← replace this
```

### 4. Set the Anthropic API key as a secret
```bash
wrangler secret put ANTHROPIC_API_KEY
# Paste your key when prompted
```

### 5. Deploy
```bash
wrangler deploy
```

### 6. Add custom domain
1. CF Dashboard → Workers & Pages → backlink → Settings → Domains & Routes
2. Add custom domain: `backlink.fuzzywigg.com`
3. Ensure `fuzzywigg.com` is on Cloudflare DNS

## Cost Estimate
- **CF Workers free tier:** 100,000 requests/day — sufficient for demo
- **CF KV:** 100,000 reads/day free — M3U parses cached 1h, minimal writes
- **Claude Haiku:** ~$0.25/1M input tokens, ~$1.25/1M output tokens
  - Each curation request ≈ 2,000 input tokens + 200 output tokens
  - ≈ $0.00075 per request → **$0.75 per 1,000 curation requests**

## Local dev
```bash
npm run dev
# Worker available at http://localhost:8787
```

## HITL Required
- ⚠️ First production deploy must be reviewed by Andrew
- ⚠️ Any changes to ANTHROPIC_API_KEY handling require approval
- ⚠️ Adding new external data sources requires approval
