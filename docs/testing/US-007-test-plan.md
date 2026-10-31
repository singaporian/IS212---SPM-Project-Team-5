# US-007 — View Confirmed Venue Details: Test Plan

| Item | Value |
| --- | --- |
| User story | US-007 — As an Event Organiser, I want to view the confirmed venue details for my event, so that I know where and when my event will be held. |
| Owner | Wen Xuan |
| Branch | wenxuan/developer/US-007/view-venue-details |
| Pull request | #— |
| Approach | TDD (tests written and run red before the code) |
| Depends on | US-009 (Organiser request page), US-020 (mark venue unavailable), Venue Staff booking approval |

## 1. Acceptance criteria

| ID | Acceptance criterion | Source |
| --- | --- | --- |
| AC-007-001 | A "Venue Details" section is accessible from the event view page. | Week 4 instructions, Event Information Management: authorised users can view relevant event information. |
| AC-007-002 | Once one or more venues are confirmed, the Organiser can view all confirmed venues associated with the event, including each venue's name, location, and booking date and time. [Modified] | Week 4 instructions, Event Status Management; Week 7 changes #3 (Multiple Venues for One Event). |
| AC-007-003 | If no venue is confirmed yet, the section shows "Venue is still being arranged". | Week 4 instructions, Event Status Management: users understand the event's current stage. |
| AC-007-004 | All venue fields are read-only to the Organiser. | Week 4 instructions, Event Change Requests: Organisers change events through change requests. |
| AC-007-005 | If a confirmed venue is marked unavailable, the original venue stays visible, labelled "Venue being re-arranged", and the event remains active. | Week 7 changes #2 (Venue Becomes Unavailable After Booking): the event is not cancelled and the original information is preserved. |

A confirmed venue is a booking with status `approved` or `confirmed` (the same rule as `eventReadiness.js`). A venue is marked unavailable when a recorded unavailability period overlaps the booking, including its setup and turnaround time (the same rule as `GET /api/bookings/affected`). The time shown is the event's booking start and end. A replacement venue, once approved, is listed as its own confirmed venue; the original stays listed with its label.

**Out of scope:** facilities, capacity, layouts and setup/turnaround minutes (not requested); notifying the Organiser when a venue becomes unavailable (Week 7 #2 only requires informing Event Coordinators); choosing or requesting a replacement venue (Coordinator's task); equipment.

## 2. Code under test

| Layer | File | Function / endpoint / page |
| --- | --- | --- |
| Domain / logic | — | — (the logic is one SQL query) |
| API | `backend/src/submissions.js` | `GET /api/requests/:id` (new `venues` field) |
| Schema | `backend/sql/schema.sql` | — |
| UI | `frontend/src/views/SubmittedRequestsView.vue` | `/requests/submitted/:id`, "Venue Details" section |

## 3. Test cases

### Unit — `backend/test/unit/`
None: there is no pure function in this story; the logic is a SQL query, tested at integration level.

### Integration — `backend/test/integration/venue.details.test.js`
Full app and real SQL on temporary tables, rolled back after the run.

| ID | Endpoint | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| IT-01 | `GET /api/requests/:id` | Event with one `approved` and one `confirmed` booking at two venues | 200; `venues` lists both with name, location, start and end time, `being_rearranged: false` | AC-007-002 |
| IT-02 | `GET /api/requests/:id` | Event with only `pending`, `rejected` and `alternative_suggested` bookings | 200; `venues` is `[]` | AC-007-002, AC-007-003 |
| IT-03 | `POST /api/venues/:id/unavailability` then `GET /api/requests/:id` | Venue Staff mark the booked venue unavailable over the event time | Venue still listed with `being_rearranged: true`; event status still `confirmed` | AC-007-005 |

### Frontend — `frontend/test/venue-details.test.cjs`
API call replaced by a stub returning one confirmed request with the given `venues`.

| ID | Page / method | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| FE-01 | `SubmittedRequestsView.vue` | `venues: []` | "Venue Details" section shows "Venue is still being arranged"; no input, select, textarea or button in it | AC-007-001, AC-007-003, AC-007-004 |
| FE-02 | `SubmittedRequestsView.vue` | Two venues, one with `being_rearranged: true` | Both names, locations and dates shown; "Venue being re-arranged" shown once | AC-007-002, AC-007-004, AC-007-005 |

### End-to-end (functional) — `e2e/tests/`
None for this story (agreed: integration and frontend tests cover every AC).

## 4. Traceability

| AC | Unit | Integration | Frontend | E2E / Manual |
| --- | --- | --- | --- | --- |
| AC-007-001 | — | — | FE-01 | Manual check |
| AC-007-002 | — | IT-01, IT-02 | FE-02 | Manual check |
| AC-007-003 | — | IT-02 | FE-01 | — |
| AC-007-004 | — | — | FE-01, FE-02 | — |
| AC-007-005 | — | IT-03 | FE-02 | — |

## 5. How to run

```bash
docker compose up -d db                                # PostgreSQL
cd backend && npm run init-db && node --test test/integration/venue.details.test.js
cd ../frontend && node --test test/venue-details.test.cjs
```

## 6. Bugs found by the tests

| Bug | Found by (test, red) | Fix | Commit |
| --- | --- | --- | --- |
| None | — | — | — |

Refactorings for this story are logged in [`docs/refactoring-log.md`](../refactoring-log.md), not here.

## 7. Results and evidence

Screenshots go in `docs/testing/evidence/US-007/`.

| Stage | Commit | Backend | Frontend | E2E | Evidence |
| --- | --- | --- | --- | --- | --- |
| Red (tests only) | `<hash>` | 0/3 | 0/2 | — | [01-red.png](evidence/US-007/01-red.png) |
| Green (after code) | `<hash>` | 3/3 | 2/2 | — | [02-green.png](evidence/US-007/02-green.png) |
| After refactor | `<hash>` | 3/3 | 2/2 | — | [03-refactor-green.png](evidence/US-007/03-refactor-green.png) |
| CI on PR | — | ✅ | ✅ | — | [04-ci-green.png](evidence/US-007/04-ci-green.png) |

Coverage (unit + integration): `backend/src/submissions.js` <xx>% lines. Uncovered: <lines> because <reason>.

### Manual check

| Step | Expected | Actual | Pass/Fail | Tester | Date |
| --- | --- | --- | --- | --- | --- |
| Log in as organiser@connectsphere.local, open a confirmed demo event | "Venue Details" lists its approved venue with name, location and time | — | — | Wen Xuan | — |
