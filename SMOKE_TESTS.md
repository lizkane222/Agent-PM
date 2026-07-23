# SMOKE_TESTS.md — Manual Verification Checklists

These are per-pass manual checks that supplement the automated test suite. They cover things automation can't easily verify: visual layout, feel, end-to-end flow against a running backend, and integration points that span multiple system layers.

Run each checklist after the automated tests for that pass pass clean. A pass is NOT complete if any item here is marked failing.

---

## Before you start

- Run the app locally against the same backend (staging or local Django server).
- Open browser devtools → Network tab → filter for `XHR/Fetch` so you can confirm which API calls fire.
- Open browser devtools → Console tab → confirm no new errors appear after any action.

---

## Pass 0 — Scaffold

Goal: verify that no visible behavior has changed. The app should look and feel identical to the original.

- [ ] App starts without build or runtime errors (`npm run dev` exits clean; no console errors on initial load).
- [ ] `npm run build` completes with no TypeScript errors (`tsc --noEmit` clean).
- [ ] `npm run test` (Vitest) runs and all tests pass.
- [ ] `python manage.py test core` runs and all tests pass.
- [ ] Navigate to every in-scope route — confirm each page loads without blank screens or console errors:
  - [ ] `/reminders`
  - [ ] `/team`
  - [ ] `/discover`
  - [ ] `/logs`
- [ ] SVG icons and illustrations still render (confirm the asset folder rename did not break any visible image).
- [ ] Any route that previously pointed at `EditPreviewPage` now lands on the correct page without a 404 or blank render.
- [ ] Backend: spot-check one API call in Network tab — confirm `_staff_sees_all` centralization did not change any response (create a staff user and a non-staff user; fetch `/api/accounts/` as each; confirm staff sees all, non-staff sees their own).

---

## Pass 1 — RemindersPage

Goal: RemindersPage is visually and functionally identical. All reminder CRUD flows work.

- [ ] Navigate to `/reminders`. List loads within ~2s. No console errors.
- [ ] Loading spinner / skeleton is visible briefly before the list appears (confirms `loading=true` state renders correctly).
- [ ] If there are no reminders: an empty-state message is shown (not a blank page).
- [ ] Tab filters ("Pending", "Completed", etc.) switch the displayed list. Switching tabs fires a new API call (visible in Network tab).
- [ ] **Create:** Click "Add Reminder" (or equivalent). Fill in a title and due date. Submit. The new reminder appears in the list. No page reload required.
- [ ] **Edit:** Click edit on an existing reminder. Change the title. Save. The updated title appears in the list.
- [ ] **Dismiss:** Click dismiss on a pending reminder. The reminder moves to the dismissed/completed state (or disappears from the "pending" tab).
- [ ] **Delete:** Click delete on an existing reminder. Confirm the prompt (if any). The reminder is removed from the list.
- [ ] Export basket integration: if RemindersPage has an "Export to Chat" checkbox or button, selecting reminders and exporting them still works.
- [ ] Voice input: if RemindersPage has a Twilio Voice input field for dictating reminders, confirm it still accepts voice input (the voiceText state is in the page component, not the hook — this must be untouched).
- [ ] No regressions in unrelated pages (navigate to `/team` and `/discover` — both still load correctly).

---

## Pass 2 — TeamPage

Goal: TeamPage renders team members correctly. Any existing write flows work.

- [ ] Navigate to `/team`. Member list loads without errors.
- [ ] Each team member card shows correct name, role, and any avatar/photo.
- [ ] Search or filter (if present) narrows the member list in real time.
- [ ] **Edit member** (if this action exists in the original page): change a field (e.g. role or department). Save. Updated value persists on refresh.
- [ ] **Invite / add member** (if this action exists): the flow completes and the new member appears.
- [ ] **Remove member** (if this action exists): member is removed from the list.
- [ ] CurrentUserContext integration: if the page shows "You" indicator or highlights the current user, confirm it still highlights correctly.
- [ ] No regressions: RemindersPage still works end-to-end.

---

## Pass 3 — DiscoverPage

Goal: DiscoverPage applet grid works. Create/edit/delete flows work.

- [ ] Navigate to `/discover`. Applet grid loads without errors.
- [ ] Loading skeleton / spinner is visible before applets appear.
- [ ] If there are no applets: empty-state message shown.
- [ ] **Create applet:** Click "Add" or equivalent. Confirm the `author` field is pre-filled with the current user's name (from `CurrentUserContext`). Fill in all required fields. Submit. New applet appears in the grid.
- [ ] **Edit applet:** Click edit on an existing applet. Change the description. Save. Updated description is visible in the grid.
- [ ] **Delete applet:** Click delete. Applet is removed from the grid.
- [ ] URL validation: entering an invalid URL in the URL field shows a validation error (the `UrlStatus` state).
- [ ] Category and type dropdowns are populated correctly.
- [ ] Author-name autocomplete or team-member picker (if present) still works — it relies on `useTeam` data loaded from Pass 2.
- [ ] Tag input (if present) accepts comma-separated values and displays them.
- [ ] No regressions: Reminders and Team pages still work.

---

## Pass 4 — LogsPage

Goal: All log sections in LogsPage render their data. No blank sections.

- [ ] Navigate to `/logs`. Page loads without errors.
- [ ] **Each log section** renders either: data rows, a loading state, or an explicit "no entries" message. No section should be silently blank (which would indicate a hook is not returning data correctly).
  - [ ] Calendar events log section
  - [ ] Comments log section
  - [ ] Reminders log section
  - [ ] Feedback items log section
  - [ ] Agent sessions / skills log section
  - [ ] Local app-log section (the `getLogs()` in-memory log)
- [ ] Date range or filter controls (if present) update the displayed entries when changed.
- [ ] Clicking on a log entry (if it expands or navigates) still works.
- [ ] Log sections with 0 records show a "No entries" message rather than blank whitespace.
- [ ] Network tab: confirm each log section's API call fires on page mount. Confirm no duplicate API calls.
- [ ] No regressions: Reminders, Team, and Discover pages all still work.

---

## Full regression check (run after Pass 4)

Spot-check the out-of-scope pages to confirm they were not inadvertently broken by the type-split or import updates:

- [ ] `/accounts` (AccountsPage) — loads, list renders.
- [ ] `/calendar` (CalendarPage) — loads, events render.
- [ ] `/action-items` (ActionItemsPage) — loads, items render.
- [ ] `/chat` (ChatPage) — loads, send a test message if safe to do so.
- [ ] `/settings` (SettingsPage) — loads, no broken fields.
- [ ] `npm run build` exits clean (no TypeScript errors) on the final codebase.
- [ ] `npm run test` — full Vitest run — all tests pass.
- [ ] `python manage.py test` — full Django test run — all tests pass.
