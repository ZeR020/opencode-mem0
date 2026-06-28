# src/web/

## Purpose

Static assets for the Memory Explorer Web UI — a single-page application served by `services/web-server.ts` at `http://127.0.0.1:4747` (default). Lets users browse, search, and manage stored memories, transcripts, conflicts, and the user profile.

## Ownership

- `index.html` — SPA shell. Loads CDN scripts (lucide icons, marked, DOMPurify, jsonrepair) and local `i18n.js`. Renders the header, stats bar, and view containers
- `app.js` — SPA application logic (~1800 lines). Manages UI state (memories, tags, pagination, search, selected set, auto-refresh, user profile, conflicts, transcripts), talks to the REST API (relative `API_BASE`), renders markdown via marked + DOMPurify
- `styles.css` — UI styles
- `i18n.js` — Internationalization (`getLanguage`/`setLanguage`/`t`), toggled via the in-app language button
- `favicon.ico` — Icon

## Local Contracts

- These assets are copied verbatim from `src/web/` to `dist/web/` by `scripts/build.mjs`. No compilation step — edits land as-is in the published package
- The SPA calls the REST API served by `services/api-handlers.ts` via a relative `API_BASE` (same origin). API key, if configured (`webServerApiKey`), is stored client-side under `opencodeMemApiKey`
- Markdown rendering must go through `marked` + `DOMPurify` (XSS boundary) — never inject unescaped memory content into the DOM
- CDN dependencies (lucide, marked, DOMPurify, jsonrepair) are dev-tool dependencies with floating versions and no SRI, annotated `NOSONAR` in `index.html` — preserve that annotation if touching the script tags

## Work Guidance

- UI iteration: edit here, run `bun run build` to copy to `dist/web/`, restart OpenCode. No TypeScript applies to these assets
- New API endpoints consumed by the UI require a matching handler in `services/api-handlers.ts` (see `src/services/AGENTS.md`)
- Keep the SPA dependency-free at build time — CDN scripts only, no npm deps for the UI

## Verification

- `tests/web-server.test.ts` and `tests/web-server-routes.test.ts` verify the server that serves these assets and its routes
- No automated UI test exists; manual verification at `http://127.0.0.1:4747` after `bun run build`

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
