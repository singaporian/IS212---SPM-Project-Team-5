# US-032 — Review and Process a Change Request: Test Plan

| Item | Value |
| --- | --- |
| Epic | Event Change Requests (Week 4 core feature) |
| User story | US-032 — As an Event Coordinator, I want to review and process change requests for my assigned events, so that approved changes are applied and affected arrangements are reconsidered. |
| Branch | wenxuan/developer/US-032/review-change-request |
| Approach | TDD: every case below was written and run red before the implementation existed |
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

## 2. Design under test

| Layer | Unit under test |
| --- | --- |
| Domain | `ChangeRequest.canBeDecided()`, `ChangeRequest.toEventColumns()`, `ChangeRequest.movesEvent(event)`, `parseChangeRequestDecision(body)` |
| API | `GET /api/events/change-requests/pending`, `PATCH /api/events/change-requests/:id/decision` (event coordinator only) |
| Schema | `event_change_requests.decided_by/decided_at`; `bookings.requires_reconsideration`; `equipment_reservations.requires_reconsideration` |
| UI | `/coordinator/change-requests` (`ChangeRequestReviewView.vue`) |

## 3. Test cases

### Unit — `backend/test/change.request.review.test.js`

| Test case | AC | Scenario | Expected |
| --- | --- | --- | --- |
| TC-US032-UT-01 | 006 | `canBeDecided()` for pending / approved / rejected | Only pending is true |
| TC-US032-UT-02 | 002 | `parseChangeRequestDecision` with `approved`, `rejected`, padded value, `cancelled`, missing, non-object body | Approved/rejected accepted (trimmed); everything else is a 400 error |
| TC-US032-UT-03 | 004 | `toEventColumns()` for each proposed field | Maps to `preferred_start`, `preferred_end`, `expected_attendance`, `venue_layout_preference`, `equipment_requirements`; omitted fields are not touched |
| TC-US032-UT-04 | 005 | `movesEvent()` — new date same length; layout-only; equipment-only; same start/end proposed | Only a different start or end counts as a move |

### Integration — `backend/test/change.request.review.test.js`
Real router, real auth middleware, real SQL against temporary copies of the tables (rolled back after each run), following the US-010 test harness.

| Test case | AC | Scenario | Expected |
| --- | --- | --- | --- |
| TC-US032-IT-01 | 001 | Coordinator A lists pending requests | Only A's events' pending requests; each row has current and proposed values; B's and already-processed requests excluded |
| TC-US032-IT-02 | 001 | Organiser / venue staff call the list or decision endpoints | 403 |
| TC-US032-IT-03 | 002, 004 | A approves a layout + equipment change | 200; event updated; request `approved` with `decided_by`/`decided_at` |
| TC-US032-IT-04 | 002, 003 | A rejects a request | 200; request `rejected`; every event column unchanged |
| TC-US032-IT-05 | 005 | A approves a same-duration move on an event with a confirmed booking and an equipment reservation | Both flagged `requires_reconsideration`; booking status, times and reservation quantity unchanged; nothing deleted; another event's booking not flagged; response lists the flagged arrangements |
| TC-US032-IT-06 | 005 | A approves a layout-only change on an event with bookings | Nothing flagged |
| TC-US032-IT-07 | 006 | Approve or reject an already-approved / already-rejected request | 409; request and event unchanged |
| TC-US032-IT-08 | 001, 006 | Coordinator B decides A's request; unknown id; malformed id | 404; nothing changes |
| TC-US032-IT-09 | 002 | Invalid decision value | 400; nothing changes |
| TC-US032-IT-10 | 007 | Database write fails after the event update (forced failure on the flagging step) | 500 with retry message; event, request, bookings all unchanged; a retry succeeds |

### Frontend logic — `frontend/test/change-request-review.test.cjs`

| Test case | AC | Scenario | Expected |
| --- | --- | --- | --- |
| TC-US032-FE-01 | 001 | Load and render a request moving 09:00 → 14:00 SGT and changing layout | Current and proposed values both rendered, unchanged fields not listed |
| TC-US032-FE-02 | 002, 005 | Approve succeeds and the response lists flagged arrangements | PATCH sent with `{ decision: 'approved' }`; item removed; success message names the arrangements to reconsider |
| TC-US032-FE-03 | 007 | First PATCH fails (500), retry succeeds | Error shown, no success message, request still listed and its pending decision kept; retry sends the same decision and succeeds |

### End-to-end (Playwright) — `e2e/tests/us032-review-change-request.spec.js`
Runs the real backend, Vite frontend and PostgreSQL in Chromium. Fixtures seed an organiser, two coordinators, a planning event with a confirmed booking and an equipment reservation, and pending change requests.

| Test case | AC | Journey | Expected |
| --- | --- | --- | --- |
| TC-US032-E2E-01 | 001, 002, 004, 005 | Coordinator signs in, opens Change Requests, sees current vs proposed time, approves | Request disappears; message lists the venue booking and equipment to reconsider; database shows the new time and both flags |
| TC-US032-E2E-02 | 002, 003 | Coordinator rejects a layout change | Request disappears; event layout unchanged in the database |
| TC-US032-E2E-03 | 007 | First decision request fails (intercepted, 500), then retry | Error shown with request still listed; retry succeeds; exactly one decision recorded |
| TC-US032-E2E-04 | 001 | Coordinator B signs in | A's change requests are not shown |

## 4. Acceptance-criteria traceability

| AC | Unit | Integration | Frontend | E2E |
| --- | --- | --- | --- | --- |
| AC-032-001 | — | IT-01, IT-02, IT-08 | FE-01 | E2E-01, E2E-04 |
| AC-032-002 | UT-02 | IT-03, IT-04, IT-09 | FE-02 | E2E-01, E2E-02 |
| AC-032-003 | — | IT-04 | — | E2E-02 |
| AC-032-004 | UT-03 | IT-03 | — | E2E-01 |
| AC-032-005 | UT-04 | IT-05, IT-06 | FE-02 | E2E-01 |
| AC-032-006 | UT-01 | IT-07, IT-08 | — | — |
| AC-032-007 | — | IT-10 | FE-03 | E2E-03 |

## 5. How to run

```bash
# Backend unit + integration (needs PostgreSQL with schema initialised)
cd backend && npm run init-db && npm test

# Frontend logic tests and build
cd frontend && npm test && npm run build

# End-to-end
cd e2e && npm install && npx playwright install chromium && npm test
```

## 6. Execution log

Results are recorded in section 7 after each phase (red, then green).

## 7. Results

_Pending._
