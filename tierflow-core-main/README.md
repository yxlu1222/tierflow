<div align="center">

# TierFlow

🚀 **A unified AI API gateway — the token optimization engine for the agent era.**

</div>

TierFlow aggregates 40+ leading AI providers (OpenAI, Claude, Gemini, Azure, AWS
Bedrock, and more) behind a single, OpenAI‑compatible API — with intelligent
routing, tiered billing, real‑time usage analytics, and team management.

## Features

- **Multi‑provider aggregation** — one unified, OpenAI‑compatible API in front of
  40+ upstream providers and protocols.
- **Intelligent routing** — route each request to the best model/channel by
  difficulty, modality, and per‑profile policy.
- **Tiered billing** — expression‑based dynamic pricing: one expression defines a
  model's full billing logic (see `pkg/billingexpr/expr.md`).
- **Usage analytics** — dashboards for requests, spend, and per‑model breakdowns.
- **Team & access management** — users, tokens, quotas, rate limiting, and an
  admin console.

## Tech stack

- **Backend** — Go, Gin, GORM (SQLite / MySQL / PostgreSQL), Redis + in‑memory cache
- **Frontend** — React 19, Rsbuild, Base UI, Tailwind CSS
- **Auth** — JWT, WebAuthn/Passkeys, OAuth (GitHub, Discord, OIDC, …)

## Quick start

```bash
# Using the bundled compose file
cp .env.tierflow.example .env   # edit as needed
docker compose -f docker-compose.tierflow.yml up -d
```

Then open the console in your browser and complete the setup wizard.

For local development, see `makefile` (`make dev` runs the backend + frontend
dev servers) and `CLAUDE.md` for project conventions.

## License

© 2026 TierFlow. All rights reserved.
