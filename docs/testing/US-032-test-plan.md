# US-032 — Review and Process a Change Request: Test Plan

| Item | Value |
| --- | --- |
| Epic | Event Change Requests (Week 4 core feature) |
| User story | US-032 — As an Event Coordinator, I want to review and process change requests for my assigned events, so that approved changes are applied and affected arrangements are reconsidered. |
| Branch | wenxuan/developer/US-032/review-change-request |
| Pull request | #31 |
| Approach | TDD: tests written and run red before the implementation existed |
| Depends on | US-008 (organiser submits change request), US-010 (major changes are cancel-and-resubmit, never reach this story) |

## 1. Acceptance criteria

| ID | Acceptance criterion |
| --- | --- |
| AC-032-001 | An Event Coordinator can view pending change requests for events assigned to them, with each proposed value shown alongside the current value. |
| AC-032-002 | The Event Coordinator can process a pending change request by approving or rejecting it. |
| AC-032-003 | If the change request is rejected, the event details remain unchanged. |
| AC-032-004 | If the change request is approved, the event is updated with the approved values. |
| AC-032-005 | If an approved change moves the event's date or time, the event's existing venue bookings and equipment reservations are identified for reconsideration rather than silently cancelled or modified. |
| AC-032-006 | Only pending change requests can be processed, and a change request that has already been approved or rejected cannot be processed again. |
| AC-032-007 | If the decision cannot be saved, neither the event nor the change request is partially updated, no false successful outcome is recorded, and the Event Coordinator can retry without losing entered decision information. |

### Scope notes and sources

- Week 4 *Event Change Requests*: coordinators "review and process" change requests; date/time, attendance, venue and equipment changes "may require existing arrangements to be reconsidered".
- G7 Clarifications: pax/duration are big changes, "cancel and rerequest". US-010 already enforces this: those changes are rejected at submission (HTTP 422) and handled by cancel-and-resubmit. US-032 therefore only ever sees: same-duration date/time moves, venue layout text and equipment text.
- Week 7 #1/#2: affected arrangements are identified, not silently removed. AC-032-005 flags them; booking and reservation status are not changed.
- Out of scope (not raised by the customer for this story): mandatory rejection reason, history of previous values, organiser notification of the outcome (Notification System story).

## 2. Code under test

| Layer | Code |
| --- | --- |
| Domain | `ChangeRequest.canBeDecided()`, `ChangeRequest.toEventColumns()`, `ChangeRequest.movesEvent(event)` in `backend/src/domain/index.js`; `parseChangeRequestDecision(body)` in `backend/src/changeRequests.js` |
| API | `GET /api/events/change-requests/pending`, `PATCH /api/events/change-requests/:id/decision` (event coordinator only) in `backend/src/changeRequests.js` |
| Schema | `event_change_requests.decided_by/decided_at`; `bookings.requires_reconsideration`; `equipment_reservations.requires_reconsideration` |
| Reused | `applyChangesToDraft()` from US-010, to keep `events.draft_data` (read by the organiser's detail page) in step on approval |
| UI | `/coordinator/change-requests` (`frontend/src/views/ChangeRequestReviewView.vue`) |

## 3. Test cases

Unit and integration tests are written against a **function or endpoint**; their AC link is recorded here. Only the E2E (functional) tests are named after ACs. Ids are kept from the original TDD red run, so gaps show tests removed in the refactor (section 6).

### Unit — `backend/test/unit/change.request.review.test.js`
No database, server or test doubles.

| Test case | Function | Cases | Expected | AC |
| --- | --- | --- | --- | --- |
| UT-02 | `parseChangeRequestDecision(body)` | `approved`, ` rejected ` (padded), `cancelled`, empty, missing body, `null`, array, number | approved/rejected accepted and trimmed; everything else throws a 400 error | 002 |
| UT-04 | `ChangeRequest.movesEvent(event)` | new date; same day later; no times; same times; same times where the event holds Date objects (as PostgreSQL returns) | true only when the start or end is a different moment | 005 |

### Integration — `backend/test/integration/change.request.review.test.js`
Real router, auth middleware and SQL against temporary copies of the tables inside a transaction that is rolled back (same harness as US-010). IT-10 makes one SQL statement fail on purpose.

| Test case | Endpoint | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| IT-01 | `GET /change-requests/pending` | Coordinator A lists; data includes B's event and already-processed requests | Only A's pending requests, each with current and proposed values | 001 |
| IT-03 | `PATCH …/decision` | Approve a layout + equipment change | Event columns updated, and the organiser's form copy (`draft_data`) too; request `approved` with `decided_by`/`decided_at` | 002, 004 |
| IT-04 | `PATCH …/decision` | Reject a time + layout change | Whole event row unchanged; request `rejected` | 002, 003 |
| IT-05 | `PATCH …/decision` | Approve a layout-only change, then a same-length time move, on an event with a booking and a reservation | Layout-only flags nothing; the move flags both, with status, times and quantity unchanged; another event not flagged; response lists the flagged arrangements | 005 |
| IT-07 | `PATCH …/decision` | Decide an already approved / rejected request | 409; request and event unchanged | 006 |
| IT-08 | `PATCH …/decision` | Coordinator B decides A's request | 404; nothing changes | 001 |
| IT-10 | `PATCH …/decision` | Database fails on the bookings update, after the event and request were updated | 500 with retry message; event, request and booking unchanged; a retry succeeds | 007 |

### Frontend unit — `frontend/test/change-request-review.test.cjs`
The page's API call is replaced by a stub that returns one sample request.

| Test case | Function | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| FE-01 | `ChangeRequestReviewView.vue` `load()`, `changes()`, time formatting | Request moving 1 Mar 9:00–12:00 to 5 Mar 2:00–5:00 PM and changing layout | Both time ranges and both layouts shown, in Singapore time; attendance and equipment rows not shown | 001 |

### End-to-end (functional, Playwright) — `e2e/tests/us032-review-change-request.spec.js`
Real browser, frontend, backend and PostgreSQL. Fixtures seed an organiser, a coordinator, a planning event with a confirmed booking and an equipment reservation, and a pending change request.

| Test case | Journey | Expected | AC |
| --- | --- | --- | --- |
| E2E-01 | Coordinator signs in, opens Review Change Requests, sees current vs proposed time, approves | Card disappears; message lists the booking and equipment to reconsider; database shows the new time and both flags | 001, 002, 004, 005 |


## 4. Acceptance-criteria traceability

| AC | Unit | Integration | Frontend | E2E |
| --- | --- | --- | --- | --- |
| AC-032-001 | — | IT-01, IT-08 | FE-01 | E2E-01 |
| AC-032-002 | UT-02 | IT-03, IT-04 | — | E2E-01 |
| AC-032-003 | — | IT-04 | — | — |
| AC-032-004 | — | IT-03 | — | E2E-01 |
| AC-032-005 | UT-04 | IT-05 | — | E2E-01 |
| AC-032-006 | — | IT-07 | — | — |
| AC-032-007 | — | IT-10 | — | — |

## 5. How to run

```bash
# Backend unit + integration (needs PostgreSQL with schema initialised)
cd backend && npm run init-db && npm test
# On Node 20 or older (Windows): node --test test/unit test/integration

# Frontend logic tests and build
cd frontend && npm test && npm run build

# End-to-end
cd e2e && npm install && npx playwright install chromium && npm test
```

## 6. Test pruning: tests removed after green

The red run had 21 tests. After the feature passed, tests were trimmed to remove redundancy. Every AC is still covered (section 4). 

| Removed | Reason |
| --- | --- |
| UT-01 `canBeDecided()` | One-line status check; IT-07 proves the rule through the API |
| UT-03 `toEventColumns()` | Simple field mapping; IT-03 proves the values land in the event |
| IT-02 role checks | Tests the shared `requireRoles` middleware, not US-032 code |
| IT-06 non-move flags nothing | Folded into IT-05 as its first step |
| IT-08 unknown / malformed ids (trimmed) | Not in the ACs; kept only the other-coordinator case |
| IT-09 invalid decision | Covered directly by UT-02 |
| FE-02 success message | E2E-01 checks the same message in a real browser |
| FE-03 retry on the page | IT-10 proves nothing is half-saved and retry succeeds; the retry button was checked manually |
| E2E-02 reject journey | IT-04 proves AC3 |
| E2E-03 failed save + retry journey | AC7's core (nothing half-saved, no false success) is proven by IT-10; retry button checked manually |
| E2E-04 other coordinator's view | IT-01 proves the same rule |

The backend tests also moved from one file (`backend/test/change.request.review.test.js`) into `backend/test/unit/` and `backend/test/integration/`, the team layout since PR #32, so `npm test` and CI run them.

Result: 11 tests (unit 2, integration 7, frontend 1, E2E 1), plus the integration wrapper.

## 7. Bugs found by the tests

| Bug | Found by | Fix |
| --- | --- | --- |
| Approval returned 200 but updated no event rows: the event was looked up with the change request's id | IT-03, IT-05, IT-10 (red after `feat`) | Build the event from `event_id` (`fix(US-032): update the event, not the change request id`) |
| Approval updated the event columns but not `draft_data`, so the organiser's detail page kept showing old values | Manual check of the organiser page; IT-03 extended first (red) | Update `draft_data` with `applyChangesToDraft()` in the same statement (`fix(US-032): keep the organiser's view in sync`) |

## 8. Results

| Stage | Commit | Backend | Frontend | E2E |
| --- | --- | --- | --- | --- |
| Red (tests only) | `4f171ca` | 0/15 | 0/3 | 0/4 |
| Green (after feat) | `5727f70` | 15/15 | 3/3 | 4/4 |
| Test pruning (split and trimmed) | `799cb0d` | IT-03 red  | 1/1 | 1/1 |
| Green  |3254855  | all pass | 1/1 | 1/1 |
| Refactor codes | <-> | all pass | 1/1 | 1/1 |
| CI on PR #31 | `3254855` | ✅ | ✅ | ✅ |