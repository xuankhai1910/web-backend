# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NestJS 11 backend for an IT-focused recruitment / ATS platform (Vietnamese product). MongoDB via Mongoose, JWT auth (access in body + refresh in HttpOnly cookie), Socket.IO realtime notifications, and a Gemini-powered CV analysis + job recommendation pipeline.

## Commands

```bash
npm run start:dev        # dev with watch
npm run start:debug      # dev with --inspect
npm run start:prod       # node dist/main (after build)
npm run build            # nest build → dist/
npm run lint             # eslint --fix on src, apps, libs, test
npm run format           # prettier --write
npm test                 # jest unit (testRegex .*\.spec\.ts$, rootDir=src)
npm test -- path/to.spec.ts            # run a single spec
npm test -- -t "name fragment"         # run a single test by name
npm run test:e2e         # jest with test/jest-e2e.json
npm run test:cov         # coverage → ../coverage
npm run seed:kaggle      # one-off CSV seed (see below)
```

Docker: `docker compose up --build` runs the prod image; volumes persist `public/images` and `upload/`. Healthcheck hits `/api/v1/health`.

Standalone TS scripts live in [src/databases/](src/databases/) and are run via `ts-node -r tsconfig-paths/register`:
- `seed-kaggle.ts` — bulk-import jobs+companies from CSV (`--csv`, `--companies`, `--jobs`, `--embed`, `--reset`).
- `generate-jd.ts` — Gemini-generated JDs for existing jobs, resumable cache at `data/jd-generated.json` (`--limit`, `--dry-run`, `--reembed`, `--force`, `--concurrency`).
- `reembed-stale-jobs.ts` — refresh job embeddings when content hash changes.
- `enrich-topcv.ts`, `jd-sync-cache.ts`, `seed-audit-all.ts`, `seed-progress.ts` — see file headers.

## Cross-cutting framework wiring

All globally applied in [src/main.ts](src/main.ts) / [src/app.module.ts](src/app.module.ts) — when you add a controller, these already apply, do not re-register them per-module:

- **Global prefix + versioning**: every route is `/api/v1/...` (URI versioning, default `'1'`).
- **`JwtAuthGuard` (global)** at [src/auth/jwt-auth.guard.ts](src/auth/jwt-auth.guard.ts) does **two** things: JWT validation **and** permission check against `user.permissions[]` (matched by HTTP `method` + Express `route.path`). Routes under `/api/v1/auth` always bypass the permission check. To opt out, use the decorators in [src/decorators/customize.ts](src/decorators/customize.ts):
  - `@Public()` — skip JWT entirely (login, register, public listings).
  - `@SkipCheckPermission()` — require a valid JWT but skip the permission lookup (use for endpoints any authenticated user may call).
  - `@User()` param decorator — inject the authenticated `IUser` (see [src/users/users.interface.ts](src/users/users.interface.ts)).
- **`TransformInterceptor` (global)** at [src/core/transform.interceptor.ts](src/core/transform.interceptor.ts) wraps every response as `{ statusCode, message, data }`. Set `message` per-handler with `@ResponseMessage('...')`; otherwise it's empty. Returning `data` directly from controllers is the convention — do not pre-wrap.
- **`ValidationPipe` (global)** with `whitelist: true` — properties not on the DTO are stripped. Add `class-validator` decorators on DTOs.
- **`ThrottlerGuard` (global)**, default 50 req / 60 s. Tighten per-endpoint with `@Throttle({ default: { limit: N, ttl: ms } })` (e.g. login is 5/min, CV analyze is 5/min).
- **`mongoose-delete` global plugin** (registered in `MongooseModule.forRootAsync`'s `connectionFactory`): every model gets `deletedAt` + soft-delete methods. Type model fields as `SoftDeleteModel<XxxDocument>` from `mongoose-delete` to access them.
- **Swagger** at `/swagger` with persisted bearer token (`addBearerAuth` under name `'token'`). The `@nestjs/swagger` plugin in [nest-cli.json](nest-cli.json) introspects DTO comments — add Swagger-friendly JSDoc rather than `@ApiProperty` where possible.
- **Helmet** has CSP **disabled** intentionally so Swagger UI inline scripts/styles aren't blocked. Don't re-enable CSP without also configuring Swagger.
- **CORS** is driven by `CORS_ORIGINS` (comma-separated). Empty value → reflect any origin. Credentials are enabled (refresh-token cookie depends on this).

## Module layout

App is split into ~20 feature modules under [src/](src/), each following the Nest convention: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `schemas/`. The notable ones beyond standard CRUD:

- **[src/auth/](src/auth/)** — Passport local + JWT (passport strategies under [src/auth/passport/](src/auth/passport/)). Login issues an access token in the response body and sets `refresh_token` as HttpOnly cookie. In production the cookie is `secure: true, sameSite: 'none'`; in dev it's `lax` (see [auth.service.ts:60-68](src/auth/auth.service.ts#L60-L68)). On validate, `auth.service.validateUser` re-fetches role permissions and attaches them to the user object — these flow into the JWT payload consumers via the JWT strategy.
- **[src/cv-analysis/](src/cv-analysis/)** — CV pipeline. Composed of:
  - `CvExtractionService` (PDF → text via `pdf-parse`)
  - `CvEmbeddingService` (768-dim Gemini `text-embedding-004`; `EMBEDDING_DIMS` and `EMBEDDING_MODEL` are exported)
  - `CvScoringService` (cosine-similarity matching of CV vs job embeddings)
  - `GeminiKeyRotator` ([gemini-key-rotator.service.ts](src/cv-analysis/gemini-key-rotator.service.ts)) — multi-key round-robin with per-`(key|model)` 429 cooldown buckets. Keys come from `GEMINI_API_KEYS` (comma-separated, preferred) or `GEMINI_API_KEY`. **Treat the rotator as the only entrypoint to Gemini** — do not instantiate `GoogleGenAI` directly elsewhere; the cooldown logic is only correct if all calls go through it.
- **[src/jobs/](src/jobs/)** — `Job` schema ([job.schema.ts](src/jobs/schemas/job.schema.ts)) carries an `embedding: number[]` plus `embeddingHash` so re-embedding can be skipped when source text is unchanged. Compound indexes are defined at the bottom of the file for the public filter sidebar (`isActive+endDate`, `category+isActive`, `specialization+isActive`, `jobType+workMode`, `salary.min+salary.max`, `skills`). Category / specialization / level / etc. are constrained by enums in [jobs.constants.ts](src/jobs/jobs.constants.ts) and the `SPECIALIZATIONS_BY_CATEGORY` map — keep these in sync with the FE filter taxonomy when editing.
- **[src/job-recommendations/](src/job-recommendations/)** — recommends jobs from a user profile embedding; uses `CvEmbeddingService` and the indexed `skills` / `isActive+endDate` filters.
- **[src/user-profiles/](src/user-profiles/)** — separate from `users`; stores candidate-facing profile data plus its own embedding via `ProfileEmbeddingService`.
- **[src/notifications/](src/notifications/)** — REST controller for read/list/delete + Socket.IO gateway at namespace `/notifications` ([notifications.gateway.ts](src/notifications/notifications.gateway.ts)). Clients pass JWT in `socket.handshake.auth.token` (or `?token=` fallback) and are auto-joined to room `user:<userId>`; emit with `server.to('user:'+id).emit(...)`. All **writes** go through REST; the gateway only pushes — this is intentional, don't add write handlers to the gateway.
- **[src/mail/](src/mail/)** — `@nestjs-modules/mailer` with Handlebars templates in [src/mail/templates/](src/mail/templates/). Templates are **not** TS, so they're copied to `dist/mail/templates` via the `assets` entry in [nest-cli.json](nest-cli.json) **and** explicitly in the [Dockerfile](Dockerfile) — touch both when adding template directories.
- **[src/databases/](src/databases/)** — `DatabasesService.onModuleInit` seeds `INIT_PERMISSIONS`, two roles (`ADMIN`, `USER`) and three users when `SHOULD_INIT=true` **and** the collections are empty. After first boot in any env, flip `SHOULD_INIT=false`. `INIT_PERMISSIONS` in [src/databases/sample.ts](src/databases/sample.ts) is the canonical permissions list — when you add a controller route that needs to be assignable to a role, add it here.
- **[src/files/](src/files/)** — disk-storage Multer to `public/images` / `upload/` (volumes in compose). See [src/files/multer.config.ts](src/files/multer.config.ts).
- **[src/health/](src/health/)** — `@nestjs/terminus` Mongoose ping at `GET /api/v1/health`; consumed by the Docker healthcheck.

## Conventions to follow

- **Response shape is fixed** by the global interceptor. Controllers return raw data; use `@ResponseMessage('...')` to set the `message` field rather than returning `{ message, data }` yourself.
- **Auth opt-outs are explicit.** A new endpoint is locked behind JWT **and** permission check by default. If it's user-callable but not admin-managed, add `@SkipCheckPermission()`. If it's truly public, add `@Public()`. Don't bypass by editing the guard.
- **Permission entries are by `(method, apiPath)`** where `apiPath` is the Express route pattern (e.g. `/api/v1/users/:id`), not the resolved URL. When adding routes, add the matching permission to `INIT_PERMISSIONS` in [src/databases/sample.ts](src/databases/sample.ts).
- **Embedding writes must update both `embedding` and `embeddingHash`** (hash of the source text). The re-embed scripts skip rows where the hash already matches.
- **Soft-delete is the default** — prefer `model.delete(...)` / `model.findWithDeleted(...)` from `mongoose-delete` over hard `deleteOne`.
- **Code style**: ESLint + Prettier (`singleQuote`, `trailingComma: all`). A few older files use tabs — when editing one of those, keep its style; otherwise use the Prettier defaults. There is a `biome.json` but Biome is not wired into npm scripts; ESLint is the source of truth.
- **Path alias `src/...`** works thanks to `tsconfig-paths`. Prefer `src/users/...` imports over deep relative paths.

## Environment

Required env (see [.env.example](.env.example)): `MONGODB_URI`, `JWT_ACCESS_TOKEN_SECRET`, `JWT_ACCESS_EXPIRE`, `JWT_REFRESH_TOKEN_SECRET`, `JWT_REFRESH_EXPIRE`, `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `SHOULD_INIT`, `INIT_PASSWORD`, `EMAIL_HOST`/`EMAIL_AUTH_USER`/`EMAIL_AUTH_PASSWORD`/`EMAIL_PREVIEW`, `GEMINI_API_KEY` (or `GEMINI_API_KEYS` for the rotator).

`NODE_ENV=production` is what flips the refresh-token cookie into `secure + sameSite=none` mode — without it, cross-site refresh from a deployed FE will silently fail.
