# US-018 — Add Notes to a Confirmed Booking

Branch: `yuhui/developer/US-018/add-notes-confirmed-booking`.
Base: `origin/main` at `f3d807a0e589a31fb49e1b148ff1bc0b5b3f4ec8`.
Approach: tests added alongside implementation; no claim of a historical red-first TDD sequence.

## Acceptance criteria

| AC | Requirement |
|---|---|
| AC1 | Venue Staff add free-text notes to confirmed bookings for authorised venues. |
| AC2 | Notes retain authenticated author and server-generated timestamp. |
| AC3 | Notes display oldest first. |
| AC4 | Notes are visible only to Venue Staff. |
| AC5 | Only the creator edits/deletes a note. |

## Architecture and scope decisions

Inspected booking schema/statuses, domain `Booking.isConfirmed()`, calendar, authentication, venue APIs, preparation/safety workflows and existing tests before implementation. There was no booking-note implementation to reuse.

**Venue scope:** current venue calendar/configuration/review APIs authorise all Venue Staff by role. There is no staff-to-venue ownership/assignment table or service. US-018 reuses that scope rather than inventing a second permissions model. A booking must join an existing venue. Missing/orphaned venue references are inaccessible. A separate test for a staff account assigned to another venue is not representable in the current model. If a future requirement introduces per-venue assignments, the note routes must adopt that shared check before claiming assignment-level isolation.

**Booking eligibility follows the existing venue-reservation policy:** `approved` and `confirmed` bookings support notes. Venue Staff approval already reserves the arrangement, and the normal workflow has no separate booking-confirmation action. Pending, rejected, alternative_suggested and cancelled bookings cannot list/add/edit/delete notes. Overall event status is not substituted for booking status. The calendar labels approved rows "Approved — venue reserved" and confirmed rows "Confirmed"; notes mount only in expanded eligible rows. Approval and event lifecycle transitions are unchanged.

No note notifications are added. Notes live in a separate table, never a booking/event JSON property. Organiser, Coordinator, Attendee, Safety Officer, Lead and Technical Support roles are denied at the note API. Normal booking responses remain unchanged.

## Model and API

`booking_notes`: UUID `id`, booking FK `booking_id`, `note_text`, user FK `created_by`, server-generated `created_at`/`updated_at`. Booking deletion cascades to its notes. Author deletion cannot silently remove attribution. Chronological index: `(booking_id, created_at, id)`.

Text must be non-empty after trimming. The existing project's 10,000-character text safeguard is reused. Creator and timestamps cannot be supplied by the caller. Edits change only text and updated timestamp. No new sorting helper: chronological ordering is tested against PostgreSQL `ORDER BY created_at ASC, id ASC`.

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/bookings/:bookingId/notes` | Venue Staff-only chronological notes with author names; no-store response. |
| POST | `/api/bookings/:bookingId/notes` | Add `{ noteText }`; 201 and persisted metadata. |
| PATCH | `/api/bookings/:bookingId/notes/:noteId` | Creator-only text change; original attribution/time retained. |
| DELETE | `/api/bookings/:bookingId/notes/:noteId` | Creator-only deletion; 204. |

Mutations use a transaction. Booking/venue shared locks guard eligibility, while edits/deletes lock the selected note. Role checks apply only to note paths, preserving other booking routes. Failed writes roll back; a failed operation cannot produce a success response. Notes from another booking cannot be addressed using a mismatched parent URL.

## Code under test

| Layer | File | Responsibility |
|---|---|---|
| Schema | `backend/sql/schema.sql` | Persistent notes and relationships/index. |
| Backend | `backend/src/bookingNotes.js` | Text/ownership helpers, role checks, eligible booking, CRUD/transactions. |
| Routing | `backend/src/index.js` | Mount notes on existing booking API. |
| Service | `frontend/src/services/bookingNotes.js` | Authenticated JSON requests and DELETE 204 handling. |
| Component | `frontend/src/components/BookingNotes.vue` | Internal notes, attribution/time, add/edit/delete, retained input and retry. |
| Calendar | `frontend/src/views/VenueBookingsCalendarView.vue` | Mount component on expanded confirmed-booking details. |

## Test traceability

IDs grouped in a single test prove related behaviour without creating duplicate cases. Results below are automated only; manual execution is pending.

| Test ID | Level | AC | Scenario | Expected Result | Result |
|---|---|---|---|---|---|
| UT-01 | UT | AC1 | Valid multiline free text | Trim outer whitespace and preserve content. | PASS |
| UT-02 | UT | AC1 | Missing/empty/non-text input | 400 validation error. | PASS |
| UT-03 | UT | AC1 | Whitespace-only input | 400 validation error. | PASS |
| UT-04 | UT | AC5 | Creator ownership | True for matching recorded creator. | PASS |
| UT-05 | UT | AC5 | Different user/missing attribution | False. | PASS |
| UT-06 | UT | Technical safeguard | 10,000/10,001 characters | Boundary accepted/exceeded rejected. | PASS |
| IT-01/02/03 | IT | AC1, AC2 | Add note; forged metadata sent | Persist correct text, trusted creator and server time. | PASS |
| IT-04/05 | IT | AC2, AC3, AC4 | Another Venue Staff reads two notes | Real author names, oldest first, independent of update time. | PASS |
| IT-06/07/08 | IT | AC4 | Other roles request every operation | 403; missing authentication 401; Coordinator booking response contains no note data. | PASS |
| IT-09/10 | IT | AC5 | Creator edits; another staff tries | Creator succeeds, other denied; created_by/created_at unchanged; chronology stable. | PASS |
| IT-11/12 | IT | AC5 | Creator deletes; another staff tries | Creator succeeds, other denied; other notes remain unchanged. | PASS |
| IT-13/14 | IT | AC1 | Unreserved booking operations | 409 for pending/rejected/alternative_suggested/cancelled; no note changed. | PASS |
| IT-15 | IT | AC1, AC4; technical IDs | Missing venue/booking and invalid note IDs | Missing/inaccessible resources 404; malformed IDs 400. Per-venue assignment test unavailable under existing model. | PASS for current scope |
| IT-16 | IT | AC1, AC5; failure safety | Invalid input and forced DB insert/update failure | No partial record or changed note; retry succeeds. | PASS |
| Cascade regression | IT | Relationship integrity | Delete booking | Its notes are removed by real foreign key cascade. | PASS |
| FE-01/02 | FE | AC2, AC3, AC4, AC5 | Render fetched notes | Ordered content, author/time; one set of own-note controls. | PASS |
| FE-03 | FE | AC1, AC2 | Add note | Request sent; returned server metadata displayed. | PASS |
| FE-04 | FE | AC5 | Edit own note | Text changes; author, creation time and position retained. | PASS |
| FE-05 | FE | AC5 | Confirm deletion | Requested note removed, other note remains. | PASS |
| FE-06 | FE | Failure safety | Add/edit/delete failure and retry | No false success; text/confirmation/data retained. | PASS |
| FE-07 | FE | AC4 | Non-Venue-Staff component access | No note rendering or request. | PASS |
| FE-08 | FE | AC1; duplicate-click safeguard | Empty input/in-flight action | No empty POST or duplicate action. | PASS |
| FE-09 | FE | AC1 | Calendar status integration | Notes mount on expanded approved/confirmed entries with distinct status labels; collapsed entries hide notes. | PASS |
| FE-10 | FE | AC4; transport | Service URL/auth/error/204 | Encoded IDs, auth headers, errors surfaced, empty delete handled. | PASS |
| Manual-01 to Manual-10 | Manual | AC1-AC5 | Browser acceptance steps below | Actual end-user workflow. | Not Executed |

Unit tests use `node:test`, `node:assert/strict`, CommonJS and direct helper calls; no HTTP/DB access. Integration tests use an isolated random PostgreSQL schema, real HTTP and explicit note foreign keys (LIKE alone does not copy FKs). Frontend tests stub API calls and render Vue components. Tests are grouped by level, not one file per case.

## Manual browser cases

Use two existing/provisioned Venue Staff test accounts and a booking whose stored status is approved or confirmed. The overall event need not be confirmed.

| ID | Steps | Expected | Actual | Status |
|---|---|---|---|---|
| Manual-01 | Venue Staff A -> Dashboard -> Upcoming Bookings -> expand a confirmed booking -> add 'Keep ramp clear.' | Note saved and displayed. | | Not Executed |
| Manual-02 | Inspect that note. | Correct staff author and current Singapore date/time. | | Not Executed |
| Manual-03 | Add 'Use rear entrance.' | Appears after the first note. | | Not Executed |
| Manual-04 | Sign in as Venue Staff B; open same booking. | Both notes visible; no Edit/Delete on A's notes. | | Not Executed |
| Manual-05 | Sign back in as A; edit first note. | Updated text; original author/time; unchanged order. | | Not Executed |
| Manual-06 | A deletes first note and confirms. | First note removed; second remains. | | Not Executed |
| Manual-07 | Coordinator opens their booking request; attempt direct note API with their session. | No note section/data; API denies access. | | Not Executed |
| Manual-08 | Organiser opens event details; attempt note API. | No internal notes; API denies access. | | Not Executed |
| Manual-09 | Attendee opens event/calendar; attempt note API. | No internal notes; API denies access. | | Not Executed |
| Manual-10 | Open a pending/rejected booking or attempt its note API; interrupt backend during a separate confirmed-booking save. | Unreserved booking notes denied; failed save retains input and supports retry without false success. | | Not Executed |

Also check keyboard/narrow-screen use and multiline/long-text wrapping. There is no browser screen for individual venue assignments because that model does not exist.

## Commands and results — 26 October 2026

From backend:
```powershell
npm run init-db
node --test test/unit/booking.notes.test.js test/integration/booking.notes.test.js
npm run test:unit
npm run test:integration
npm test
```

From frontend:
```powershell
node --test test/booking-notes.test.cjs
npm test
npm run build
```

Root: `git diff --check`; `git diff --cached --check`.

| Check | Result |
|---|---|
| init-db | PASS |
| US-018 focused backend | 16 passed / 0 failed (6 unit; 10 integration including parent) |
| All backend test:unit | 165 passed / 0 failed (existing mixed unit-folder HTTP tests included) |
| All backend test:integration | 199 passed / 0 failed |
| Full backend | 364 passed / 0 failed |
| US-018 focused frontend | 9 passed / 0 failed |
| Full frontend | 108 passed / 0 failed |
| Production build | PASS; existing Vite CJS deprecation warning |
| Diff checks | PASS |

Existing US-019/US-020/US-035/US-038 and main booking/authentication suites remain intact. US-033 was pushed separately as c06849c6b109ebb8f0babc96f015e5ae7c1e0d2d and has not been merged; its full combined-branch workflow is not falsely claimed as tested in this main-based US-018 branch. The notes router is scoped to note URLs and cannot impose Venue Staff-only access on other booking endpoints.

Original implementation was committed as 798008a. The subsequent eligibility correction follows the existing approved-as-reserved policy; no new status transition is introduced. Stashes remain untouched. Recheck the normal approval-to-notes browser flow after this correction.

## Approval-to-notes integration correction

IT-17 verifies approved bookings can create/read/edit/delete notes, other staff cannot edit/delete them, and booking/event statuses stay unchanged. FE-09 verifies approved/confirmed labels, eligible note rendering and collapsed/ineligible exclusion. Previous results above describe the original verification; rerun results for this correction are reported separately.

Correction verification — 30 October 2026: focused backend 17 passed; full backend 365 passed; full frontend 108 passed (including all 9 notes tests); production build PASS; git diff --check PASS. Manual recheck: open an approved booking such as AI Fair, confirm the Approved — venue reserved label, add/reload/edit/delete a note; open a confirmed demo booking and confirm its Confirmed label and notes remain available.
