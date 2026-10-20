# US-038 — Manage Tentative Venue Holds

## Authoritative scope
Use only the final eight acceptance criteria supplied on 11 October 2026.
Story: As a Venue Staff member, I want tentative venue holds to expire after a specified date and time, so that venues are not reserved indefinitely while event arrangements are being finalised.

Extend, release and confirm actions, their notifications, and expiry-before-setup-start validation are NOT requirements. Their UI, APIs, tests and mutation logic were removed. Confirmation is not a dependency or completion blocker.

## Implementation
Venue Staff place a hold using an existing pending booking request to identify its event, venue, requested slot and recorded buffers. No duplicate booking is created. Staff can view holds; Coordinators see only currently assigned events; other roles cannot access them. Current staff access follows the project's role-wide venue access (there is no staff-to-venue mapping).

Expiry is a valid timestamp with timezone, later than the database current time. It may be at or after the occupied/event start. Native inputs use Singapore time; displayed times use AM/PM.

An unresolved hold blocks precisely while status is active AND expiry_at > clock_timestamp(). At equality it is expired, independent of a scheduler or notification success. The stored active status may remain unchanged; reads derive expired from the deadline. Legacy released records remain nonblocking; no release action is exposed.

Conflict integration remains in date/time venue search, US-019 inbox/detail, and current main's approval transaction. Shared holdConflicts and activeHoldSql are reusable by US-033. Strict effective-interval overlap preserves the existing exact-touch convention. Expired holds never create/confirm bookings. Other reservations/unavailability may still make a venue unavailable after one hold expires.

## AC6 — expiry notification
The earlier implementation was missing expiry notification. processHoldExpiries now detects unresolved expired holds and inserts the existing in-app notification for the current assigned Event Coordinator. A single PostgreSQL statement updates expiry_notified_at and inserts the notification atomically. Concurrent processing rechecks the marker and does not duplicate delivery. Notification failure rolls back the marker so later detection retries.

Processing entry points:
- Coordinator GET /api/notifications, scoped to that Coordinator's current assignments;
- hold-list retrieval;
- venue search;
- shared hold conflict checks used by review, placement and approval;
- an open holds page refreshes when its timer detects a newly expired hold.

This is lazy detection, explicitly allowed by the corrected request. It does not promise background delivery at the exact wall-clock deadline while nobody accesses the application. Expired holds cease blocking by timestamp regardless. Once a relevant request detects expiry, the notification is persisted. If no Coordinator is assigned, no recipient is invented and the marker remains unset; processing can notify after assignment. The notification is an in-app notification, not an email/push system.

## Schema and preservation
venue_holds keeps arrangement, creator/time and expiry metadata and adds expiry_notified_at. init-db removes the verified old venue_holds_check1 constraint, which imposed expiry before setup-adjusted start. No hold rows are deleted.

The earlier venue_hold_actions table is no longer created or used by the implementation. An already-applied local table/history is deliberately not dropped. Legacy status/actor columns remain compatible with existing data; no old actions are exposed.

US-033 and US-039 stashes remain untouched. US-035 venue configuration is not implemented: use recorded booking buffers for now. The future venue-level buffer source/snapshot policy must be integrated with the shared occupied interval and SQL predicates. US-033 should reuse holdConflicts inside its approval transaction with the same locking; do not bypass expiry checks.

## Final acceptance traceability
| Test Case | AC | Scenario | Expected Result | Automated/Manual | Result |
|---|---|---|---|---|---|
| TC-US038-01 | AC1 | Venue Staff place tentative hold | Linked event/venue/slot saved; no duplicate booking | Backend + frontend; manual | Automated PASS |
| TC-US038-02 | AC2 | Store expiry; reject malformed/past timestamp | Valid future expiry saved, including after event start | Backend + frontend; manual | Automated PASS |
| TC-US038-03 | AC3 | Active conflicting hold | Venue excluded from slot search; review labels hold; approval blocked; buffers included | Backend + frontend; manual | Automated PASS |
| TC-US038-04 | AC4 | Deadline reached | Derived status expired at equality; open page processes detected expiry | Backend + frontend; manual | Automated PASS |
| TC-US038-05 | AC5 | Expired hold | No longer blocks; new overlapping hold can be placed if otherwise available | Backend; manual | Automated PASS |
| TC-US038-06 | AC6 | Expiry notification | Current Coordinator notified once on detection; concurrent checks deduplicated; failed delivery retried | Backend + frontend; manual | Automated PASS |
| TC-US038-07 | AC7 | Expired hold classification | Expired tentative hold; underlying pending booking is not confirmed | Backend + frontend; manual | Automated PASS |
| TC-US038-08 | AC8 | Failed hold save/expiry processing | No false success or partial persistence; input retained; retry works | Backend + frontend; manual | Automated PASS |

Additional technical regressions: role authorization/assignment changes; removed action endpoints return 404; competing placement/approval; current booking/unavailability conflicts; no notification before expiry; unassigned events; historical resolved rows excluded; notification marker rollback. These are not additional customer ACs.

Automated evidence: backend/test/integration/venue-holds.test.js, frontend/test/venue-holds.test.cjs, and US-038 hold display case in frontend/test/booking-review.test.cjs. Backend tests use isolated PostgreSQL schemas and real concurrent connections.

## Manual browser checks still required
1. Log in as Venue Staff → Dashboard → Tentative venue holds. Pick a pending request and save a hold with a future expiry. Verify saved arrangement and AM/PM expiry; no extend/release/confirm controls.
2. Use an expiry after the booking start to verify no old setup-adjusted deadline restriction remains. A missing/past expiry must fail with input retained.
3. As the assigned Coordinator, view the read-only hold. Another Coordinator must not see it; Organiser must not see a confirmed booking created from it.
4. Before expiry, search the overlapping venue/date/time: venue excluded. Review must show a tentative-hold warning; overlapping approval must fail.
5. For a separate hold with a near-future expiry, leave the hold page open until expiry or refresh the Coordinator's notifications after the deadline. Verify expired display and one expiry notification. Repeat refresh several times: no duplicates.
6. Search again after expiry: the hold no longer blocks (other availability rules still apply). Verify the booking has not become confirmed.
7. Disconnect the backend during placement; verify no false success and retained input. Reconnect and retry. Check narrow-screen layout and keyboard use.

## Commands
Backend: node --test test/unit/venue-holds.test.js; npm run test:unit; node --test test/integration/venue-holds.test.js; npm run test:integration; npm test.
Frontend: node --test test/venue-holds.test.cjs test/booking-review.test.cjs; npm test; npm run build.
Root: git diff --check; git diff --cached --check.

Manual browser execution is pending. No commit or push is authorised.

## Final verification — 11 October 2026
- Backend focused: 16 passed / 0 failed (14 hold tests including integration parent, plus 2 demo-data tests).
- Backend full: 140 passed / 0 failed.
- Frontend focused (holds + review integration): 15 passed / 0 failed; holds file contributes 8 tests.
- Frontend full: 74 passed / 0 failed.
- Production build: PASS; existing Vite CJS deprecation notice only.
- init-db: PASS twice; seed-demo: PASS. Demo idempotency is also covered by the isolated database test.
- git diff --check and git diff --cached --check: PASS. Existing partial staging was preserved; this review did not stage, commit or push.

## Demo-data verification
backend/src/seed-demo.js uses backend/src/demoVenueScenarios.js to create six stable-ID fixtures relative to the current Singapore date: active, short-expiry and expired holds, plus three pending decision scenarios. The latter are demo data only, not the stashed US-033 implementation. Event and booking slots match, a Coordinator is assigned, and recorded booking buffers are 30 minutes each. Reseeding resets these fixtures without multiplying them; production validation is unchanged. backend/test/integration/demo-venue-scenarios.test.js verifies date rollover, stable IDs, repeat seeding, coherent data and preservation of unrelated records.

Use the named US-038 Demo fixtures for manual testing. The primary active hold expires two hours after seeding; the short-expiry hold expires after five minutes. Rerun seed-demo when fresh deadlines are needed. Old manually created records are preserved.

## Final changed-file manifest
- backend/sql/schema.sql
- backend/src/bookingReview.js
- backend/src/index.js
- backend/src/venueOccupancy.js
- backend/src/holdAvailability.js
- backend/src/venueHolds.js
- backend/test/integration/booking.review.test.js
- backend/test/integration/venue-holds.test.js
- frontend/src/components/BookingReview.vue
- frontend/src/router/index.js
- frontend/src/views/HomePage.vue
- frontend/src/views/PendingBookingRequestsView.vue
- frontend/src/views/VenueHoldsView.vue
- frontend/test/booking-review.test.cjs
- frontend/test/venue-holds.test.cjs
- docs/testing/US-038-test-plan.md
- backend/src/seed-demo.js
- backend/src/demoVenueScenarios.js
- backend/test/integration/demo-venue-scenarios.test.js


## Dedicated unit coverage — 18 October 2026

Integrated origin/main b7ca024 by fast-forward, without conflicts. New file: backend/test/unit/venue-holds.test.js. Style matches recent US-021/US-032: CommonJS, node:test, node:assert/strict, top-level [UT-xx] names, fixed timestamps and real exported helpers. No database queries, HTTP/server startup, external services or mocks. validateExpiry is imported from its existing router module, as teammate parser tests do; no route is invoked. Production code and existing integration/frontend tests are unchanged.

The original evidence above is retained as historical evidence. This section adds function-level checks; it does not claim pure helpers prove SQL filtering, notifications, authorization or transaction behaviour.

| Test ID | Level | AC | Scenario | Expected Result | Result |
|---|---|---|---|---|---|
| UT-01 | UT | AC3 | effectiveHoldStatus before expiry | active one millisecond before deadline | PASS |
| UT-02 | UT | AC4 | effectiveHoldStatus exactly at expiry | expired at equality | PASS |
| UT-03 | UT | AC4, AC7 | effectiveHoldStatus after expiry | expired, not confirmed | PASS |
| UT-04 | UT | AC4, AC7; compatibility | Historical non-active status | released/expired preserved; no new transition invented | PASS |
| UT-05 | UT | AC3; recorded-buffer support | Setup calculation | Start moves earlier by recorded setup only | PASS |
| UT-06 | UT | AC3; recorded-buffer support | Turnaround calculation | End moves later by recorded turnaround only | PASS |
| UT-07 | UT | AC3; recorded-buffer support | Zero/null/missing buffers | Original interval retained; no default invented | PASS |
| UT-08 | UT | AC3; recorded-buffer support | Midnight crossings | Correct occupied interval on adjoining Singapore dates | PASS |
| UT-09 | UT | AC3; overlap support | Intersecting/contained intervals | True in either order | PASS |
| UT-10 | UT | AC3; overlap support | Separated intervals | False in either order | PASS |
| UT-11 | UT | AC3; technical convention only | Exact touching | False under existing strict-overlap convention | PASS |
| UT-12 | UT | AC3; recorded-buffer support | Touching event slots with setup/turnaround | Effective occupied intervals overlap | PASS |
| UT-13 | UT | AC2 | Future expiry with explicit timezone | Accepted and normalised to ISO UTC | PASS |
| UT-14 | UT | AC2; existing technical validation | Expiry at/before current time | 400 error; future expiry required | PASS |
| UT-15 | UT | AC2; existing technical validation | Malformed/missing-timezone/invalid-clock input | 400 error matching current implementation | PASS |

Exact touching is an implementation convention, not a newly confirmed customer rule. Future expiry validation adds no expiry-before-event-start rule. Existing integration coverage continues to explicitly accept expiry after booking start.

### Preserved levels and traceability
The following IDs are documentation aliases for existing coverage, not renamed or newly created tests. Original TC-US038 names remain unchanged.

| Test ID | Level | AC | Scenario | Expected Result | Result |
|---|---|---|---|---|---|
| IT-01 (TC-US038-01/02) | IT | AC1, AC2 | Create through API | Persist linked arrangement, actor and expiry without duplicate booking | PASS |
| IT-02 (TC-US038-03) | IT | AC3 | Real search/review/approval with active hold | Overlapping venue use blocked, including buffers | PASS |
| IT-03 (TC-US038-04/05/07) | IT | AC4, AC5, AC7 | Real database expiry exclusion | Expired hold stops blocking and does not confirm request | PASS |
| IT-04 (TC-US038-06) | IT | AC6 | Notification recipient, deduplication and concurrency | Current Coordinator notified once on lazy detection; failure retryable | PASS |
| IT-05 (TC-US038-08) | IT | AC8 | Persistence failure and competing operations | Rollback, no false success; safe retry/concurrency | PASS |
| IT-DEMO | IT | Supporting fixture evidence | Repeat demo seed | Stable coherent fixtures and unrelated records preserved | PASS |
| FE-01 (existing holds/review suites) | FE | AC1-AC4, AC6-AC8 | Component rendering and stubbed requests | Correct display, placement, read-only access, expiry detection and retry | PASS |
| Manual-01 (steps 1-7 above) | Manual | AC1-AC8 | Browser acceptance flow | Actual role navigation, notifications, expiry, errors and responsive layout | Pending execution |

Unit checks support AC2/3/4/7; AC1/5/6/8 depend on preserved API/database/frontend evidence. In particular, expired hold exclusion from availability is tested with PostgreSQL, not inferred solely from effectiveHoldStatus or an SQL-string assertion.

### Current verification
- Dedicated US-038 unit: 15 passed / 0 failed.
- All backend tests selected by test:unit: 101 passed / 0 failed. This existing script also includes US-034 HTTP tests housed under unit; the new US-038 file is fully isolated.
- Existing US-038 integration: 14 passed / 0 failed.
- All backend integration: 146 passed / 0 failed.
- Full backend: 247 passed / 0 failed.
- Relevant frontend holds/review: 20 passed / 0 failed.
- Full frontend: 82 passed / 0 failed.
- Production build: PASS; existing Vite CJS deprecation warning. Existing US-021 frontend tests emit Vue component/property warnings while passing.
- Initial full integration failed because the local database lacked US-021 preparation_status. Applied main's existing npm run init-db migration without editing schema or production files; integration rerun passed.
- git diff --check and git diff --cached --check: PASS.

Commands are listed above. No existing tests moved, removed or weakened. No commit or push performed. Manual browser execution remains pending; adding unit tests is not new evidence of browser acceptance or a replacement for integration coverage.
