# US-031 — Edit a Submitted Request Before Approval: Test Plan

| Item | Value |
| --- | --- |
| User story | US-031 — As an Event Organiser, I want to edit my request while it is Submitted or returned for clarification, so that the Coordinator reviews the correct details before approving it. |
| Owner | Wenxuan |
| Branch | wenxuan/developer/US-031/edit-before-approval |
| Pull request | #<number> |
| Approach | Tests written before the code (no red-run evidence required from Sprint 4) |
| Depends on | US-006 (submission and its validation), US-008 (change requests after approval), US-012 (Coordinator's assigned requests) |

## 1. Acceptance criteria

| ID | Acceptance criterion | Source |
| --- | --- | --- |
| AC-031-001 | The Organiser can edit any field while the request is Submitted or returned for clarification, but not once it has been approved. | G7 clarifications: an external Organiser can modify a request after it is submitted but before the Coordinator approves it ("yes they can"). |
| AC-031-002 | Edits use the same validation as US-006. Invalid edits are rejected with the affected fields shown, and the saved values stay unchanged. | Team decision: reuses US-006 `validateSubmission()`. |
| AC-031-003 | A valid edit applies immediately and does not count as a change request. | Same G7 answer as AC-031-001; change requests (US-008) only start after approval. |
| AC-031-004 | The assigned Coordinator is notified and sees an "Updated" indicator and the change history. | **Parked**: moved to US-002. |
| AC-031-005 | There is no limit on edits or on how many times a request is returned. Resubmitting a returned request sets it back to Submitted. | G7 clarifications: no limit to the number of changes; no limit to how many times a request can be returned. |
| AC-031-006 | A returned request shows the status "Returned for clarification" and the Coordinator's note to the Organiser. | Week 4, Event Review and Approval: Coordinators can request clarification or amendments, and the outcome is visible to the relevant users. |

**Out of scope:** AC-031-004 (moved to US-002); edits after approval (US-008, US-010); Coordinator assignment (US-034). The Coordinator's note is optional because no customer document makes it mandatory.

### Status flow used by this story

Statuses come from `EVENT_STATUS` in `backend/src/domain/index.js`, not the G7 summary list.

| Status | Organiser can… |
| --- | --- |
| `submitted`, `clarification_requested` | edit the request directly (this story) |
| `approved`, `planning`, `confirmed` | send a change request (US-008) |
| `draft`, `rejected`, `cancelled`, `completed` | neither |

## 2. Code under test

| Layer | File | Function / endpoint / page |
| --- | --- | --- |
| Domain / logic | `backend/src/domain/index.js` | `EventRequest.canEdit()`, `EventRequest.canRequestChanges()` |
| API | `backend/src/submissions.js` | `PUT /api/requests/:id`, `POST /api/requests/:id/resubmit` (Organiser), `PATCH /api/events/:id/return` (assigned Coordinator), `GET /api/requests/:id` |
| Schema | `backend/sql/schema.sql` | `events.clarification_note` |
| UI | `frontend/src/views/SubmittedRequestsView.vue` | `/requests/submitted/:id`: status label, note, Edit request, Resubmit for review |
| UI | `frontend/src/components/EventRequestForm.vue` | `/requests/submitted/:id/edit`: Save Changes |
| UI | `frontend/src/views/CoordinatorRequestsView.vue` | `/coordinator/requests`: Return for clarification |

## 3. Test cases

### Unit — `backend/test/unit/request.edits.test.js`
Pure domain methods; no database or server.

| ID | Function | Inputs | Expected | AC |
| --- | --- | --- | --- | --- |
| UT-01 | `canEdit()` | every event status | true only for `submitted` and `clarification_requested` | AC-031-001 |
| UT-02 | `canEdit()` and `canRequestChanges()` | each active status | exactly one of the two is true (no gap, no overlap with US-008) | AC-031-001, AC-031-003 |

### Unit (frontend) — `frontend/test/request-edits.test.cjs`
The page is rendered on its own; the API call is replaced by a stub returning one request.

| ID | Page / method | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| UT-03 | `SubmittedRequestsView.vue` | request in each status, on the list and on its own page | "Edit request" shows only for `submitted` and `clarification_requested` | AC-031-001 |
| UT-04 | `SubmittedRequestsView.vue` | returned request with a note | shows "Returned for clarification" and the note | AC-031-006 |

### Integration — `backend/test/integration/request.edits.test.js`
Real router and SQL on temporary tables, rolled back after the run.

| ID | Endpoint | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| IT-01 | `PUT /api/requests/:id` | valid edit on a Submitted request | 200; values saved, status still `submitted`, no change request row | AC-031-001, AC-031-003 |
| IT-02 | `PUT /api/requests/:id` | edit on an approved request | 409; nothing changes | AC-031-001 |
| IT-03 | `PUT /api/requests/:id` | attendance `-5` | 422 with `fields.expectedAttendance`; nothing changes | AC-031-002 |
| IT-04 | `PATCH /api/events/:id/return`, `GET /api/requests/:id` | Coordinator returns with a note | Organiser's view shows `clarification_requested` and the note | AC-031-006 |
| IT-05 | `POST /api/requests/:id/resubmit` | returned request | 200; status `submitted` | AC-031-005 |
| IT-06 | `PUT /api/requests/:id` | another Organiser edits | 404; nothing changes | Week 4 authorisation |

### End-to-end (functional) — `e2e/tests/us031-edit-before-approval.spec.js`
Fixtures seed an Organiser, a Coordinator and one Submitted request assigned to the Coordinator.

| ID | User journey | Expected (what the user sees + what is saved) | ACs |
| --- | --- | --- | --- |
| E2E-01 | Coordinator returns the request with a note; Organiser opens it, edits Expected Attendance to 150, saves, resubmits | Organiser sees "Returned for clarification" and the note, then "Your changes have been saved." and Submitted; database has status `submitted`, attendance 150, no change request | AC-031-001, AC-031-003, AC-031-005, AC-031-006 |

## 4. Traceability

| AC | Unit | Integration | Frontend | E2E / Manual |
| --- | --- | --- | --- | --- |
| AC-031-001 | UT-01, UT-02 | IT-01, IT-02 | UT-03 | E2E-01 |
| AC-031-002 | — | IT-03 | — | — |
| AC-031-003 | UT-02 | IT-01 | — | E2E-01 |
| AC-031-004 | — | — | — | Parked (US-002) |
| AC-031-005 | — | IT-05 | — | E2E-01 |
| AC-031-006 | — | IT-04 | UT-04 | E2E-01 |

## 5. How to run

```bash
docker compose up -d                                   # PostgreSQL
cd backend && npm run init-db && node --test test/unit test/integration
cd ../frontend && npm test
cd ../e2e && npm test
```

## 6. Bugs found by the tests

| Bug | Found by (test, red) | Fix | Commit |
| --- | --- | --- | --- |
| A freshly approved event (status `approved`, written by `PATCH /api/events/:id/decision`) could neither be edited nor receive a change request until it became `confirmed`, because `CHANGE_REQUEST_STATUSES` only listed `planning` and `confirmed`. | UT-02 | Added `EVENT_STATUS.APPROVED` and included it in `CHANGE_REQUEST_STATUSES` (backend and frontend). | `<hash> fix(US-031): …` |

Refactorings for this story are logged in [`docs/refactoring-log.md`](../refactoring-log.md), not here.

## 7. Results and evidence

| Stage | Commit | Backend | Frontend | E2E | Evidence |
| --- | --- | --- | --- | --- | --- |
| Tests written | `<hash>` | — | — | — | — |
| After code | `<hash>` | <n>/<n> | <n>/<n> | <n>/<n> | — |
| After refactor | `<hash>` | <n>/<n> | <n>/<n> | <n>/<n> | — |
| CI on PR | — | — | — | — | — |

Coverage (unit + integration): `backend/src/submissions.js` <xx>% lines. Uncovered: <lines> because <reason>.
