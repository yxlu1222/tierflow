# CLAUDE.md — Project Conventions for new-api

## Overview

This is an AI API gateway/proxy built with Go. It aggregates 40+ upstream AI providers (OpenAI, Claude, Gemini, Azure, AWS Bedrock, etc.) behind a unified API, with user management, billing, rate limiting, and an admin dashboard.

## Tech Stack

- **Backend**: Go 1.22+, Gin web framework, GORM v2 ORM
- **Frontend**: React 19, TypeScript, Rsbuild, Base UI, Tailwind CSS
- **Databases**: SQLite, MySQL, PostgreSQL (all three must be supported)
- **Cache**: Redis (go-redis) + in-memory cache
- **Auth**: JWT, WebAuthn/Passkeys, OAuth (GitHub, Discord, OIDC, etc.)
- **Frontend package manager**: Bun (preferred over npm/yarn/pnpm)

## Architecture

Layered architecture: Router -> Controller -> Service -> Model

```
router/        — HTTP routing (API, relay, dashboard, web)
controller/    — Request handlers
service/       — Business logic
model/         — Data models and DB access (GORM)
relay/         — AI API relay/proxy with provider adapters
  relay/channel/ — Provider-specific adapters (openai/, claude/, gemini/, aws/, etc.)
middleware/    — Auth, rate limiting, CORS, logging, distribution
setting/       — Configuration management (ratio, model, operation, system, performance)
common/        — Shared utilities (JSON, crypto, Redis, env, rate-limit, etc.)
dto/           — Data transfer objects (request/response structs)
constant/      — Constants (API types, channel types, context keys)
types/         — Type definitions (relay formats, file sources, errors)
i18n/          — Backend internationalization (go-i18n, en/zh)
oauth/         — OAuth provider implementations
pkg/           — Internal packages (cachex)
web/             — Frontend workspace (single frontend)
  web/default/   — Frontend (React 19, Rsbuild, Base UI, Tailwind)
  web/default/src/i18n/ — Frontend internationalization (i18next, zh/en)
```

## Internationalization (i18n)

### Backend (`i18n/`)
- Library: `nicksnyder/go-i18n/v2`
- Languages: en, zh

### Frontend (`web/default/src/i18n/`)
- Library: `i18next` + `react-i18next` + `i18next-browser-languagedetector`
- Languages: en (base), zh (fallback)
- Translation files: `web/default/src/i18n/locales/{lang}.json` — flat JSON, keys are English source strings
- Usage: `useTranslation()` hook, call `t('English key')` in components
- CLI tools: `bun run i18n:sync` (from `web/default/`)

## Rules

### Rule 1: JSON Package — Use `common/json.go`

All JSON marshal/unmarshal operations MUST use the wrapper functions in `common/json.go`:

- `common.Marshal(v any) ([]byte, error)`
- `common.Unmarshal(data []byte, v any) error`
- `common.UnmarshalJsonStr(data string, v any) error`
- `common.DecodeJson(reader io.Reader, v any) error`
- `common.GetJsonType(data json.RawMessage) string`

Do NOT directly import or call `encoding/json` in business code. These wrappers exist for consistency and future extensibility (e.g., swapping to a faster JSON library).

Note: `json.RawMessage`, `json.Number`, and other type definitions from `encoding/json` may still be referenced as types, but actual marshal/unmarshal calls must go through `common.*`.

### Rule 2: Database Compatibility — SQLite, MySQL >= 5.7.8, PostgreSQL >= 9.6

All database code MUST be fully compatible with all three databases simultaneously.

**Use GORM abstractions:**
- Prefer GORM methods (`Create`, `Find`, `Where`, `Updates`, etc.) over raw SQL.
- Let GORM handle primary key generation — do not use `AUTO_INCREMENT` or `SERIAL` directly.

**When raw SQL is unavoidable:**
- Column quoting differs: PostgreSQL uses `"column"`, MySQL/SQLite uses `` `column` ``.
- Use `commonGroupCol`, `commonKeyCol` variables from `model/main.go` for reserved-word columns like `group` and `key`.
- Boolean values differ: PostgreSQL uses `true`/`false`, MySQL/SQLite uses `1`/`0`. Use `commonTrueVal`/`commonFalseVal`.
- Use `common.UsingPostgreSQL`, `common.UsingSQLite`, `common.UsingMySQL` flags to branch DB-specific logic.

**Forbidden without cross-DB fallback:**
- MySQL-only functions (e.g., `GROUP_CONCAT` without PostgreSQL `STRING_AGG` equivalent)
- PostgreSQL-only operators (e.g., `@>`, `?`, `JSONB` operators)
- `ALTER COLUMN` in SQLite (unsupported — use column-add workaround)
- Database-specific column types without fallback — use `TEXT` instead of `JSONB` for JSON storage

**Migrations:**
- Ensure all migrations work on all three databases.
- For SQLite, use `ALTER TABLE ... ADD COLUMN` instead of `ALTER COLUMN` (see `model/main.go` for patterns).

### Rule 3: Frontend — Prefer Bun

Use `bun` as the preferred package manager and script runner for the frontend (`web/default/` directory):
- `bun install` for dependency installation
- `bun run dev` for development server
- `bun run build` for production build
- `bun run i18n:*` for i18n tooling

### Rule 4: New Channel StreamOptions Support

When implementing a new channel:
- Confirm whether the provider supports `StreamOptions`.
- If supported, add the channel to `streamSupportedChannels`.

### Rule 5: Upstream Relay Request DTOs — Preserve Explicit Zero Values

For request structs that are parsed from client JSON and then re-marshaled to upstream providers (especially relay/convert paths):

- Optional scalar fields MUST use pointer types with `omitempty` (e.g. `*int`, `*uint`, `*float64`, `*bool`), not non-pointer scalars.
- Semantics MUST be:
  - field absent in client JSON => `nil` => omitted on marshal;
  - field explicitly set to zero/false => non-`nil` pointer => must still be sent upstream.
- Avoid using non-pointer scalars with `omitempty` for optional request parameters, because zero values (`0`, `0.0`, `false`) will be silently dropped during marshal.

### Rule 6: Billing Expression System — Read `pkg/billingexpr/expr.md`

When working on tiered/dynamic billing (expression-based pricing), you MUST read `pkg/billingexpr/expr.md` first. It documents the design philosophy, expression language (variables, functions, examples), full system architecture (editor → storage → pre-consume → settlement → log display), token normalization rules (`p`/`c` auto-exclusion), quota conversion, and expression versioning. All code changes to the billing expression system must follow the patterns described in that document.

### Rule 7: Typography — No Monospace Font (Frontend `web/default/`)

The app uses a single typeface everywhere: **MiSans** (loaded via `public/fonts/misans.css`). Both the serif font axis and monospace are **intentionally disabled project-wide** — deliberate design decisions, not oversights.

- `--font-body` is set to `var(--font-sans)` (MiSans) in `src/styles/theme.css`. The theme-preset system (`theme-presets.css`, `data-theme-preset` / `data-theme-font` / `data-theme-scale`) and the `--font-serif` token have been **deleted** — there is no font axis left to override, so tables, prose, and everything else render in MiSans, full stop.
- `--font-mono` is aliased to `var(--font-body)` in `src/styles/theme.css`, and the landing page's `--tf-mono` to `var(--tf-body)` in `src/styles/index.css`, so every Tailwind `font-mono` utility (and any `var(--font-mono)`) also renders in MiSans.
- Do **NOT** reintroduce a monospace typeface anywhere, including code blocks, terminals, keys/URLs, or JSON viewers. The `font-mono` utility class may remain in markup (it now resolves to MiSans); prefer not to add new ones.
- `font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`) is fine and encouraged for aligning digits — it changes figure spacing, not the typeface.

### Rule 8: Currency — RMB (¥) Only, No Multi-Currency

All money in this project is **RMB (人民币, ¥)**. This is a single-currency deployment — multi-currency is forbidden.

- Every money-denominated value — selling prices (per-token, per-request, billing expression coefficients), upstream provider costs, recharge amounts, subscription plan prices, margin/revenue reporting — is in ¥. Expression coefficients are ¥ per 1M tokens; `QuotaPerUnit` maps ¥1 to quota units (`USDExchangeRate` is pinned to 1 so the internal quota anchor IS ¥1 — see `docs/subscription-gap-analysis.md` §D1, the authoritative currency decision).
- UI MUST always label money as ¥ / 人民币 / CNY. Do NOT display or label anything as `$`, USD, dollars, or any other currency, and do NOT add currency-switching or exchange-rate conversion UI.
- Where legacy code or docs (e.g. `pkg/billingexpr/expr.md`) mention `$`/USD, read them as ¥; new code and docs must write ¥.
- When entering upstream costs for providers that publish USD prices, the admin converts to ¥ before entry; the system itself never converts.
