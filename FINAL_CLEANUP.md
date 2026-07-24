# Final Cleanup List

Items to address after smoke tests are complete. Ordered by category.

---

## Bundle optimization

- [ ] **Fix mixed dynamic/static import for `analytics.ts`**
  `api.ts` dynamically imports it (intending a lazy chunk) but `App.tsx`, `CurrentUserContext.tsx`, and `auth.ts` statically import it — the dynamic import has no effect. Either make all imports static (simplest) or remove the static imports and lazy-load everywhere consistently.

- [ ] **Fix mixed dynamic/static import for `appLog.ts`**
  `useConvert.ts` dynamically imports it twice, but 8+ files statically import it (`ActivityLogSection`, `ExportBar`, all major pages). Same fix: pick one strategy — static everywhere is the pragmatic choice since `appLog.ts` is used on nearly every page.

- [ ] **Reduce chunk sizes (> 500 kB after minification)**
  Root cause: `AccountDetailPage` (~7,230 lines) and `CalendarPage` (~5,549 lines) are in the main bundle. Fix options:
  - Add `React.lazy()` + `Suspense` for route-level code splitting on the large pages
  - Or configure `build.rollupOptions.output.manualChunks` in `vite.config.ts` to split by route
  - Note: this should be done as part of (or after) the AccountDetailPage and CalendarPage migration passes, since those pages will be restructured anyway

---

## Future migration passes (out of scope for current plan)

- [ ] **AccountDetailPage.tsx (~7,230 lines)** — ~14 entity types, ~30 inlined sub-components. Needs its own PLAN.md-style design pass before execution.

- [ ] **CalendarPage.tsx (~5,549 lines)** — Real-time WebSocket + Google Calendar OAuth + Salesforce sync. High complexity; deserves dedicated planning.

- [ ] **ActionItemsPage.tsx — local-draft optimistic-ID flow** — The `local-*` prefix optimistic ID protocol spans render, sync, and Airtable write-back. Simpler CRUD in that page may be a candidate for a standard `useResource` pass first.

- [ ] **`useComments` migration** — Currently in `components/comments/useComments.ts`. Migration path documented in `HOOK_SPEC.md §5`. Cross-cutting; defer until after the large page passes.

---

## Smoke test blockers (add any issues found during smoke testing here)

_None yet — smoke tests in progress._
