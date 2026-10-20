# US-021 — Update Venue Preparation Status: Test Plan

| Item | Value |
| --- | --- |
| Epic | Venue preparation (Week 7 #6: events proceed to preparation after the Operational Safety Check) |
| User story | US-021 — As a Venue Staff member, I want to update the preparation status of a venue for a confirmed event, so that the Event Coordinator can monitor outstanding arrangements before the event. |
| Branch | wenxuan/developer/US-021/preparation-status |
| Approach | TDD: every case below was written and run red before the implementation existed |
| Depends on | US-015/US-017 (venue bookings).  |

## 1. Acceptance criteria

| ID | Acceptance criterion | Source |
| --- | --- | --- |
| AC-021-001 | Venue Staff views confirmed upcoming events that have passed the Operational Safety Check, one line per venue booking: Event Name, Venue, Date, Time, current Preparation Status. (updated – CR-03, CR-06) | Week 7 #6 "cannot proceed to preparation until the Safety Officer has approved it"; Week 7 #3 "more than one venue booking"; Week 4 Event Status Management |
| AC-021-002 | Status is set via Not Started / In Progress / Ready; only Venue Staff can do this. | Week 7 #6 ("preparation" stage); Week 4 Authorisation "only … view or modify information appropriate to their role". The three values are a team assumption. |
| AC-021-003 | The assigned Event Coordinator sees the preparation status of each venue for their events; other coordinators do not. | Week 7 #5 "Event Coordinators should only be able to manage events assigned to them"; Week 4 Authorisation |
| AC-021-004 | For a multi-venue event, each venue booking's status is updated independently; changing one does not change the others. (New) | Week 7 #3 "Each venue should be checked independently … Changes … of one venue arrangement should not automatically remove the other venue bookings" |
| AC-021-005 | Preparation status cannot be set for an event whose Operational Safety Check is pending, rejected or changes requested. (added – CR-06) | Week 7 #6 "The event cannot proceed to preparation until the Safety Officer has approved it." |
| AC-021-006 | If a save fails, an error is shown, the previous status stays, and staff can retry. | Week 4 rubric, Working software: "including … failure scenarios" |


## 2. Design under test

| Layer | Unit under test |
| --- | --- |
| Domain | `PREPARATION_STATUSES` (`backend/src/domain/index.js`), `parsePreparationStatus(body)` (`backend/src/preparation.js`) |
| API | `GET /api/preparation/bookings`, `PATCH /api/preparation/bookings/:id` (Venue Staff only); `GET /api/preparation/mine` (Event Coordinator only) |
| Schema | `bookings.preparation_status` (`not_started` / `in_progress` / `ready`, default `not_started`) |
| UI | `PreparationStatusView.vue`: `/venue/preparation` (Venue Staff, can update) and `/coordinator/preparation` (same page with `readOnly`, Event Coordinator) |

## 3. Test cases

### Unit — `backend/test/unit/preparation.status.test.js`

| Test case | AC | Scenario | Expected |
| --- | --- | --- | --- |
| TC-021-UT-01 | 002 | `parsePreparationStatus` with each valid value, an unknown value, a missing value and a non-object body | The three values are accepted; everything else throws a 400 error |

### Integration — `backend/test/integration/preparation.status.test.js`
| Test case | AC | Scenario | Expected |
| --- | --- | --- | --- |
| TC-021-IT-01 | 001 | Venue Staff lists bookings; seed a confirmed future event with two venues, plus a `planning` event, a past confirmed event and a confirmed event whose booking is still `pending` | Exactly the two venue rows of the confirmed future event, each with event title, venue name, start/end time and `not_started` |
| TC-021-IT-02 | 002 | Coordinator and Organiser call the list and save endpoints; Venue Staff saves `in_progress`, then an invalid value | 403 for the other roles; Venue Staff gets 200 and the value is stored; invalid value gives 400; status unchanged after every refused call |
| TC-021-IT-03 | 005 | Save on a booking whose event is `planning` (pending / changes requested) or `rejected`; save on an unknown id | 409 for the not-confirmed events, 404 for the unknown id; nothing changes |
| TC-021-IT-04 | 003, 004 | Two-venue event: Venue Staff saves venue A; Coordinator A and Coordinator B call `GET /mine` | A sees venue A `in_progress` and venue B still `not_started`; B sees none of A's bookings |
| TC-021-IT-05 | 006 | Database update fails (forced failure on the update) | 500 with a retry message; status unchanged; the same request succeeds when retried |

### Frontend unit — `frontend/test/preparation-status.test.cjs`
The page's API calls are replaced by simple stubs.

| Test case | AC | Scenario | Expected |
| --- | --- | --- | --- |
| TC-021-FE-01 | 001 | Load and render two venue bookings of one event | One row per venue with event name, venue, date, time (SGT) and status label |
| TC-021-FE-02 | 006 | First save rejects, second save succeeds | Error shown, current status still the previous one and the chosen value kept; retry saves it and clears the error |

### End-to-end (Playwright) — `e2e/tests/us021-preparation-status.spec.js`

| Test case | AC | Journey | Expected |
| --- | --- | --- | --- |
| TC-021-E2E-01 | 001, 002, 003, 004 | Venue Staff opens Preparation Status, sets venue A of a two-venue confirmed event to In Progress; the assigned Coordinator opens Venue Preparation | Staff sees both venues; after save venue A shows In Progress and venue B Not Started; Coordinator sees the same two statuses; database matches |

## 4. Acceptance-criteria traceability

| AC | Unit | Integration | Frontend | E2E |
| --- | --- | --- | --- | --- |
| AC-021-001 | — | IT-01 | FE-01 | E2E-01 |
| AC-021-002 | UT-01 | IT-02, IT-03 | — | E2E-01 |
| AC-021-003 | — | IT-06 | — | E2E-01 |
| AC-021-004 | — | IT-04 | — | E2E-01 |
| AC-021-005 | — | IT-05 | — | — |
| AC-021-006 | — | IT-07 | FE-02 | — |

## 5. How to run

```bash
# Backend unit + integration (needs PostgreSQL with schema initialised)
cd backend && npm run init-db && npm test

# Frontend unit tests and build
cd frontend && npm test && npm run build

# End-to-end
cd e2e && npm install && npx playwright install chromium && npm test
```

## 6. Execution log

| Phase | Commit | Result |
| --- | --- | --- |
| Red | 2710b80 | All US-021 tests fail for the expected reason: backend unit + integration files fail with `Cannot find module '../../src/preparation'`; frontend test fails with `ENOENT … PreparationStatusView.vue`; E2E-01 times out waiting for the "Preparation Status" link. Other existing tests unaffected. |
| Green | 71807e8 | All US-021 tests pass: UT-01, IT-01 to IT-06, FE-01, FE-02, E2E-01. Backend suite: 332 pass / 0 fail. Frontend suite: 82 pass / 0 fail. |

## 7. Results

Coverage (unit + integration, US-021 tests only, Node 20 `--experimental-test-coverage`):
`backend/src/preparation.js` 92.68% lines, 64.71% branches, 100% functions.
Uncovered: lines 40–42 and 77–79, the `catch` blocks of the two list endpoints (load failure), and the
404 branches for a malformed or unknown booking id. Not covered because they are not in the ACs; the save
failure (AC6) is covered by IT-06. 