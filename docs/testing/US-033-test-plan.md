# US-033 — Respond to a Venue Booking Request

## Current implementation — 25 October 2026
Branch: yuhui/developer/US-033/respond-to-venue-booking-request.
Base: origin/main f3d807a0e589a31fb49e1b148ff1bc0b5b3f4ec8, including merged US-035/US-038 and current readiness/unavailability workflows. Main fast-forwarded without conflicts; applying the latest preserved US-033 stash required semantic resolutions in index.js, BookingReview.vue, router/index.js and BookingRequestsView.vue. All stashes retained, including US-039. No commit or push.

### Confirmed buffer policy (user clarification, 25 October)
For a new request: explicit value -> current venue default -> existing fallback. US-035 parseBookingInput resolves this and persists bookings.setup_minutes/turnaround_minutes. Those recorded values remain applicable after creation. Updating venue defaults affects subsequent requests; it does not retroactively replace recorded booking values or hold snapshots. Existing conflicting bookings are retained and identified, not deleted. This clarification supersedes the dependency/blocker statements in the historical record below.

US-033 reuses occupiedInterval/reviewConflicts from the existing occupancy/review modules, findUnavailability from venueAvailability.js and holdConflicts from holdAvailability.js. It introduces no second buffer calculation or hold expiry policy. US-035 configuration API/UI, venue search policy, and all US-038 production logic remain unchanged.

### Decision transaction and UI
Only Venue Staff may decide pending requests. Approval locks bookings, venue_unavailabilities and venue_holds before rereading current rows. It rejects approved/confirmed booking overlaps, recorded unavailability and active unexpired holds using recorded occupied intervals. Pending requests do not reserve; expired holds do not block or confirm. Strict exact touching retains the shared technical convention.

The existing booking is updated with decision, actor, time, reason/comment and alternative timestamps. Optional rejection information follows AC4. Alternatives must contain valid ordered times. Decision and existing Coordinator notification commit together; failure rolls back. Main's promoteEventIfReady and Safety Officer notification are preserved inside the transaction: overall event promotion still occurs only when main's venue/technical readiness conditions are met, not unconditionally on venue approval.

The dedicated US-019 page now owns all three US-033 controls and confirmation/retry state. Main's partial two-button panel was consolidated into it to avoid duplicate decision forms. The review component keeps all informational sections and can be disabled during saving. Pending/Reviewed navigation, current decision author/time and Coordinator receipt information remain available. Dashboard retains main's Pending Venue Booking Requests, Holds, Upcoming Bookings and setup configuration links.

### Production files
- backend/src/bookingDecisions.js: small pure parser extracted for unit tests; no database/time/conflict policy.
- backend/src/index.js: pending-only transaction, current shared availability checks, atomic save/notifications, Reviewed endpoint.
- backend/src/bookingReview.js: expose stored decision author on the existing read endpoint.
- frontend/src/components/BookingReview.vue: informational review, display synchronisation, no duplicate action form.
- frontend/src/router/index.js: retain main routes and add Reviewed route.
- frontend/src/views/BookingRequestsView.vue: clear approved-reservation label, preserve main safety/reconsideration features.
- frontend/src/views/PendingBookingRequestsView.vue: Pending/Reviewed navigation and dedicated review links.
- frontend/src/views/VenueBookingReviewView.vue: all three actions, confirmation, input retention, receipt refresh and reviewed details.

### Current traceability
Existing TC-US033 names are retained. IT aliases below identify grouped evidence rather than creating duplicate tests per acceptance row.

| Test ID | Level | AC | Scenario | Expected Result | Result |
|---|---|---|---|---|---|
| UT-01 | UT | AC1, AC4 | Parse approval/rejection with optional text | Valid decision and trimmed information | PASS |
| UT-02 | UT | AC1 | Unsupported/missing decision | 400 error | PASS |
| UT-03 | UT | AC5 | Alternative with explicit Singapore times/comment | Same moments and comment preserved | PASS |
| UT-04 | UT | AC5 | Missing/invalid/equal/reversed alternative | Rejected without persistence | PASS |
| UT-05 | UT | AC4, AC5 | Non-text reason/comment | 400 error | PASS |
| IT-01/12 (TC-US033-01/10/12) | IT | AC1, AC6 | Approve available pending request; Coordinator and Reviewed retrieval | Same booking, actor/time, visible outcome; repeat decision rejected | PASS |
| IT-02/03/12 (TC-US033-02/03/10) | IT | AC1, AC4-AC6 | Rejection and alternative with comment | Persisted and returned in Coordinator receipt | PASS |
| IT-04/14 (TC-US033-04/13) | IT | AC2 | Approved/confirmed booking added after clear review | Approval blocked; request remains pending | PASS |
| IT-05 (TC-US033-05) | IT | AC2 | Recorded unavailable period | Approval blocked | PASS |
| IT-06/14 (TC-US033-07/13/14) | IT | AC2 | New active hold after review; turnaround-only overlap | Shared hold-conflict output returned; no decision saved | PASS |
| IT-07/08 (TC-US033-08/09) | IT | AC3 | Expired hold; venue defaults subsequently changed | Approval succeeds if otherwise clear; held booking remains pending; snapshot unchanged | PASS |
| IT-09/10/11 | IT | AC2 | Configure venue; create requests; change defaults; add buffer-only conflict | New defaults and overrides resolved correctly; saved buffers govern review/approval; existing booking retained | PASS |
| IT-13 (TC-US033-11) | IT | AC7 | Notification persistence fails | Decision and notification unchanged; retry succeeds | PASS |
| IT-14 | IT | AC2 | Unavailability added after clear review | Current database state blocks approval | PASS |
| IT-04 boundary | IT | AC2 | Occupied intervals exactly touch; overlapping pending request exists | Existing strict-overlap convention allows approval | PASS |
| Readiness regression | IT | Integration preservation | Main venue/technical prerequisites are satisfied | Existing event-readiness promotion retained | PASS |
| FE-01 (TC-US033-01/02/03) | FE | AC1, AC4, AC5 | Dedicated pending page controls and confirmation fields | All three actions; optional reason and alternative inputs | PASS |
| FE-02 (TC-US033-11) | FE | AC7 | Rejection save failure and retry | Reason/comment retained, no false success; saved result survives refresh failure | PASS |
| FE-03/05 (TC-US033-04/13, TC-US033-07) | FE | AC2, AC7 | Server rejects conflicting approval | Pending state, error and entered comment retained | PASS |
| FE-04 (TC-US033-03) | FE | AC5 | Submit alternative | Singapore timestamps and comment sent | PASS |
| FE-06 | FE | AC5, AC7 | Failed alternative save then retry | Both dates/comment retained; successful retry | PASS |
| FE-07 | FE | AC6 | Reviewed detail | Decision author/time; no further mutation controls | PASS |
| FE-08 | FE | AC5, AC6 | Coordinator receives decision record | Reason, alternative and comment rendered | PASS |
| Dashboard/review regressions | FE | AC1, AC6 | Pending link, inbox detail route, review page | Correct navigation; retained Holds/Upcoming Bookings and role visibility | PASS |
| Manual-01 | Manual | AC1-AC7 | Browser steps below | Actual user workflow verified | Pending execution |

UTs are isolated parser calls using node:test, node:assert/strict, CommonJS and [UT-xx] names. DB-only conditions (pending status, SQL hold filtering, conflicts, rollback) intentionally stay in integration tests. Existing US-038 unit tests additionally exercise occupiedInterval/overlaps/effective expiry without duplicating them here. Integration uses temporary PostgreSQL tables and HTTP, rolled back per scenario. Frontend/component tests stub fetch and render Vue components.

Files: backend/test/unit/booking.decisions.test.js; backend/test/integration/booking.decisions.test.js; frontend/test/booking-decisions.test.cjs; frontend/test/booking-review.test.cjs; frontend/test/home-refresh.test.cjs.

### Manual browser checks still required
1. Staff Dashboard -> Pending Venue Booking Requests -> Review Request. Verify one decision panel with Approve, Reject, Suggest Alternative.
2. Approve an available request; inspect Reviewed entry, author/time and Coordinator outcome.
3. Reject with information; suggest alternative with Singapore timestamps/comment; inspect both Coordinator receipts.
4. Open a clear review, then introduce a conflicting reservation, unavailable period or active hold; approval must fail. Retry after hold expiry when otherwise available; expiry must not confirm the held booking.
5. Configure venue buffers, create a request, then change defaults. Existing request/hold retains recorded values; a new request uses new defaults; explicit override remains applicable. Verify buffer-only conflict is identified and no existing booking disappears.
6. Interrupt saving; entered reason/comment/alternative remains and no success appears. Restore backend and retry. Check desktop/mobile layout, keyboard access and Pending/Reviewed navigation.

### Commands
From backend: node --test test/unit/booking.decisions.test.js test/integration/booking.decisions.test.js; npm run test:unit; npm run test:integration; npm test.
From frontend: node --test test/booking-decisions.test.cjs test/booking-review.test.cjs test/home-refresh.test.cjs test/venue-holds.test.cjs; npm test; npm run build.
Root: git diff --check; git diff --cached --check.
Existing root backend/test-us035.js is a separate live-server/data-mutating script, not part of npm test. The new recorded-buffer integration scenarios exercise the actual configuration and creation APIs without modifying public demo records.

### Verification results
- Main schema applied with npm run init-db: PASS.
- Focused US-033 backend: 20 passed / 0 failed (5 unit + 15 integration, including parent). Final combined decisions/review/holds regression: 46 passed / 0 failed.
- Backend test:unit: 164 passed / 0 failed (includes existing HTTP tests housed under unit).
- Backend test:integration: 204 passed / 0 failed.
- Full backend: 368 passed / 0 failed.
- Focused frontend decisions/review/dashboard/holds: 31 passed / 0 failed.
- Full frontend: 108 passed / 0 failed.
- Frontend production build: PASS; existing Vite CJS deprecation warning.
- Both diff checks: PASS. Manual verification remains pending; no commit or push.

US-033 now satisfies AC1-AC7 for the confirmed recorded-buffer policy and can be marked Done after final manual verification. There is no remaining US-035 precedence blocker under this policy.

---

## Historical implementation evidence — superseded where noted above
The following record preserves the earlier test evidence and the dependency status as understood on 11 October. Its outstanding-US-035 statements are historical and no longer apply after the explicit 25 October clarification.

# US-033 — Respond to a Venue Booking Request

Branch: yuhui/developer/US-033/respond-to-venue-booking-request
Base: main edcc26c, including merged US-038. Original US-033 stash retained.

## Scope and integration
The existing booking row receives approved, rejected or alternative_suggested. Overall event status is unchanged; no reservation row is duplicated. Venue Staff actions live on the dedicated US-019 review page. Pending/Reviewed navigation, decision author/time and Coordinator receipts are retained. Rejection information is optional under AC4. Alternative times must be valid and ordered; accompanying comments are preserved.

Approval begins a transaction and locks bookings, venue_unavailabilities and venue_holds in SHARE ROW EXCLUSIVE mode before re-reading the request and checking pending status. It queries current reservations and unavailable periods through reviewConflicts and calls the unchanged US-038 holdConflicts(client, booking) from backend/src/holdAvailability.js. No hold expiry/overlap policy is duplicated. Active holds block approval, including the request's own active hold; expired holds are ignored and never converted to confirmed bookings. A stale review cannot bypass these checks. Decision and existing Coordinator notification commit atomically; failure rolls back. The current assigned Coordinator remains the notification recipient under US-034.

US-038 UI, shared module, schema and seed data remain unchanged from main. US-039 remains stashed. No commit or push performed.

## Final acceptance traceability
| AC | Tests | Evidence/status |
|---|---|---|
| AC1 approve/reject/suggest alternative | TC-US033-01/02/03 | PASS: API persistence and dedicated-page controls |
| AC2 unavailable slot cannot be approved; applicable buffers included | TC-US033-04/05/06/07/13/14 | PASS for current booking-level buffers and shared holds; US-035 integration outstanding |
| AC3 expired hold does not block or confirm | TC-US033-08/09 | PASS: separate held request remains pending while another is approved |
| AC4 rejection information | TC-US033-02 | PASS: reason/comment persisted |
| AC5 alternative arrangement/comment | TC-US033-03 | PASS: Singapore timestamps and comment persisted |
| AC6 Coordinator sees outcome | TC-US033-10 | PASS: Coordinator receipt returns decisions and details |
| AC7 failed save retains input and permits retry | TC-US033-11 | PASS: database rollback and frontend failure/retry |

TC-US033-12 checks non-pending repeat rejection; TC-US033-13 adds conflicts after a clear review; TC-US033-14 compares approval hold-conflict output with the shared helper's output. Cases are grouped into meaningful automated tests rather than duplicated one per ID.

Automated evidence: backend/test/booking.decisions.test.js and frontend/test/booking-decisions.test.cjs. Existing backend/test/venue-holds.test.js also covers concurrent placement versus approval, expiry notification retry/deduplication and role access. Existing frontend review/hold suites verify preservation of US-019 and US-038.

## US-035 dependency — do not mark fully Done
Current sources are bookings.setup_minutes/turnaround_minutes and hold snapshots. backend/src/venueOccupancy.js occupiedInterval(), backend/src/bookingReview.js reviewConflicts(), and backend/src/holdAvailability.js holdConflicts() use those recorded values. Once US-035 is ready, agree and integrate how venue-configured buffers feed existing requests, current reservations and hold snapshots, consistently with search/review/approval. Do not invent defaults or implement venue configuration here. Final venue-level acceptance and manual integration remain outstanding.

## Verification — 11 October 2026
- Backend focused: node --test test/booking.decisions.test.js test/venue-holds.test.js — 24 passed, 0 failed (10 US-033 including parent; 14 US-038).
- Backend full npm test — 150 passed, 0 failed.
- Frontend focused: node --test test/booking-decisions.test.cjs test/booking-review.test.cjs test/venue-holds.test.cjs — 25 passed, 0 failed (5 US-033).
- Frontend full npm test — 84 passed, 0 failed.
- Frontend npm run build — PASS; existing Vite CJS deprecation warning.
- git diff --check and git diff --cached --check — PASS.

## Manual browser verification still required
1. Venue Staff: open Pending, choose Review Request, approve an available request. Verify Reviewed navigation, Approved — venue reserved, decision author/time, same booking ID and unchanged overall event status.
2. Assigned Coordinator: view decision; repeat with rejection reason/comment and suggested alternative start/end/comment.
3. Open a clear review; add a conflicting approved/confirmed booking or unavailable period in test data before confirming approval. Approval must fail and retain pending state. Repeat with buffer-only overlap.
4. Approve a request overlapping an active tentative hold: blocked. After expiry, retry when otherwise available: succeeds; the separate held request is not confirmed by expiry.
5. Interrupt the backend during decision saving: no false success, entered values remain, retry works. A saved decision must remain successful if the subsequent review refresh fails.
6. Confirm non-pending requests have no decision controls; check keyboard/mobile layout, detailed review information and unchanged Active/Expired hold filters.

US-033 is implementation-complete for the current integrated scope, including US-038 tentative-hold handling; final completion remains dependent on US-035 venue-level setup/turnaround integration.
