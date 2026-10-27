# US-009 — Track My Request's Status: Test Plan

| Item | Value |
| --- | --- |
| User story | US-009 — As an Event Organiser, I want to see the current status of each of my requests and the outcome of any change requests, so that I know where my event stands and what I need to do next. |
| Owner | Wenxuan |
| Branch | wenxuan/developer/US-009/track-request-status |
| Pull request | #<number> |
| Approach | TDD (tests written before the code) |
| Depends on | US-006 (submission), US-008 (change requests), US-013 (approve/reject and its audit row), US-031 (edit/return/resubmit), US-032 (change request decisions) |

## 1. Acceptance criteria

| ID | Acceptance criterion | Source |
| --- | --- | --- |
| AC-009-001 | Each of the Organiser's requests shows its current status, in plain words, on both the list and the request page: Submitted, Returned for clarification, Approved, In planning, Confirmed, Rejected, Cancelled. | Week 4, Event Review and Approval: "The outcome of the review should be visible to the relevant users." |
| AC-009-002 | A rejected request shows the Coordinator's rejection reason, plus any comment the Coordinator added. The Coordinator can add a comment to any reason (still required for Other). | Week 4 (same); G7: rejection reason is mandatory |
| AC-009-003 | Each status says what the Organiser can do next: edit (Submitted or Returned), request changes (Approved, In planning or Confirmed), or nothing (Rejected or Cancelled). | Week 4, Event Request Creation and Event Change Requests; US-031 and US-008 rules |
| AC-009-004 | For each change request on an approved event, its own status (Pending Review, Approved or Rejected) is shown alongside the event, separately from the event's status. | Week 4, Event Change Requests |
| AC-009-005 | If a change request was rejected, the event details are unchanged; if it was approved, the event shows the updated values. | Week 4, Event Change Requests |

**Out of scope:** drafts (shown in My Drafts, US-004); `completed` (nothing sets it yet); coding any status transition (each stays with its own story); notifications (US-002).

### Status labels and next steps

| Stored value | Label | Next step shown |
| --- | --- | --- |
| `submitted` | Submitted | Edit request |
| `clarification_requested` | Returned for clarification | Edit request, Resubmit for review |
| `approved` | Approved | Request changes |
| `planning` | In planning | Request changes |
| `confirmed` | Confirmed | Request changes |
| `rejected` | Rejected (with reason) | No further action (list: disabled button) |
| `cancelled` | Cancelled | No further action (list: disabled button) |

`planning` is labelled "In planning" because it means the Safety Officer sent the event back for changes (US-039).

### Design decisions

- **Rejection reason without changing US-013.** US-013 already writes an audit row to `event_changes` when it rejects (`Decision: rejected … for reason: <reason>[ Details: <detail>]`). `GET /api/requests/:id` reads the latest such row and returns `rejection_reason` (e.g. `Other: Venue closed`). No schema change. Requests rejected before this story also show their reason. Risk: if US-013's summary wording changes, the reason disappears. IT-01 calls the real decision endpoint, so it would fail.
- **Rejection comment for every reason (added after review).** The Coordinator's reject form now shows the comment box for every reason, not only Other (required for Other, optional otherwise). The decision endpoint saves the comment in the same audit row for any reason. This is the only change to US-013 code: one line in `index.js` and the comment box in `CoordinatorRequestsView.vue`; US-013's rules (reason mandatory, detail required for Other) are unchanged.
- **Change requests** are returned inside `GET /api/requests/:id` as `change_requests` (newest first). No new endpoint.
- **AC-009-005** needs no new code: US-032 already writes approved values into the event and its `draft_data` (which the request page shows) and leaves rejected ones unchanged. Covered by US-032 IT-03 and IT-04; not duplicated here.

## 2. Code under test

| Layer | File | Function / endpoint / page |
| --- | --- | --- |
| API | `backend/src/submissions.js` | `GET /api/requests/:id` (adds `rejection_reason`, `change_requests`), `rejectionReason()` |
| API | `backend/src/index.js` | `PATCH /api/events/:id/decision` (US-013): saves the comment for any reason |
| UI | `frontend/src/views/CoordinatorRequestsView.vue` | Reject form: comment box shown for every reason |
| Schema | `backend/sql/schema.sql` | — (none) |
| UI | `frontend/src/views/SubmittedRequestsView.vue` | `/requests/submitted` and `/requests/submitted/:id`: status labels, next step, rejection reason, change requests |

## 3. Test cases

### Unit — backend
None: US-009 adds no new domain logic. `rejectionReason()` is covered through IT-01.

### Unit (frontend) — `frontend/test/request-status.test.cjs`
The page is rendered on its own; the API call is replaced by a stub returning one request.

| ID | Page / method | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| UT-01 | `SubmittedRequestsView.vue` `statusLabel()` | each of the 7 statuses, on the list and on the request page | the badge shows the plain-words label, e.g. `planning` → "In planning" | AC-009-001 |
| UT-02 | `SubmittedRequestsView.vue` | request page in each status | Edit request / Resubmit for review / Request changes / "No further action" | AC-009-003 |
| UT-03 | `SubmittedRequestsView.vue` | rejected request with reason "Other: Venue closed for renovation" | "Rejected" badge and the reason | AC-009-002 |
| UT-04 | `SubmittedRequestsView.vue` | event "In planning" with one pending and one rejected change request | "Change requests" section with "Pending Review" and "Rejected" badges, separate from the "In planning" event badge | AC-009-004 |

### Integration — `backend/test/integration/request.status.test.js`
Full app (`index.js`) and SQL on temporary tables, rolled back after the run.

| ID | Endpoint | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| IT-01 | `PATCH /api/events/:id/decision`, `GET /api/requests/:id` | Coordinator rejects with "Other" + "Venue closed for renovation" | 200; status `rejected`, `rejection_reason` = "Other: Venue closed for renovation" | AC-009-002 |
| IT-02 | `GET /api/requests/:id` | approved event with an older approved and a newer pending change request | 200; event status still `approved`; `change_requests` statuses `['pending', 'approved']` | AC-009-004 |
| IT-03 | `PATCH /api/events/:id/decision`, `GET /api/requests/:id` | Coordinator rejects with "Insufficient Information" + comment "Please add the event programme." | 200; `rejection_reason` = "Insufficient Information: Please add the event programme." | AC-009-002 |

### Functional (manual) — TC-009-FT-01
No E2E for now. Run by hand once before the PR (frontend, backend and database running).

| ID | User journey | Expected | ACs |
| --- | --- | --- | --- |
| FT-01 | 1. Organiser submits requests A and B. 2. Coordinator rejects A with reason Insufficient Information and the comment "Please add the programme". 3. Coordinator approves B. 4. Organiser sends a change request on B (attendance 100 → 150); Coordinator approves it. 5. Organiser sends another change request on B (attendance 150 → 300); Coordinator rejects it. 6. Organiser opens Submitted requests, then A, then B. | List: A "Rejected" with disabled "Request changes"; B "Approved" with "Request changes". A's page: reason "Insufficient Information: Please add the programme" and "No further action". B's page: "Change requests" with one "Approved" and one "Rejected" badge, separate from the event's "Approved" badge; Expected Attendance shows 150 (not 300). | AC-009-001 to AC-009-005 |

## 4. Traceability

| AC | Unit | Integration | Frontend | E2E / Manual |
| --- | --- | --- | --- | --- |
| AC-009-001 | — | — | UT-01 | FT-01 |
| AC-009-002 | — | IT-01, IT-03 | UT-03 | FT-01 |
| AC-009-003 | — | — | UT-02 | FT-01 |
| AC-009-004 | — | IT-02 | UT-04 | FT-01 |
| AC-009-005 | — | US-032 IT-03, IT-04 | — | FT-01 |

## 5. How to run

```bash
docker compose up -d                                   # PostgreSQL
cd backend && npm run init-db && node --test test/unit test/integration
cd ../frontend && npm test
```

## 6. Bugs found by the tests

| Bug | Found by (test, red) | Fix | Commit |
| --- | --- | --- | --- |
| None | — | — | — |

Refactorings for this story are logged in [`docs/refactoring-log.md`](../refactoring-log.md), not here.

## 7. Results and evidence

Screenshots go in `docs/testing/evidence/US-009/`.

| Stage | Commit | Backend | Frontend | E2E | Evidence |
| --- | --- | --- | --- | --- | --- |
| Red (tests only) | `<hash>` | <n-2>/<n> | <m-4>/<m> | — | [01-red.png](evidence/US-009/01-red.png) |
| Green (after code) | `<hash>` | <n>/<n> | <m>/<m> | — | [02-green.png](evidence/US-009/02-green.png) |
| After refactor | `<hash>` | <n>/<n> | <m>/<m> | — | [03-refactor-green.png](evidence/US-009/03-refactor-green.png) |
| CI on PR | — | ✅ | ✅ | ✅ | [04-ci-green.png](evidence/US-009/04-ci-green.png) |

Coverage (unit + integration): `backend/src/submissions.js` <xx>% lines. Uncovered US-009 lines: <lines or "none"> because <reason>.

Limitation: the reason is read from US-013's audit text. A request rejected without that audit row shows "No reason was recorded."

### Manual check

| Step | Expected | Actual | Pass/Fail | Tester | Date |
| --- | --- | --- | --- | --- | --- |
| FT-01 (see section 3) | as in section 3 | <…> | <…> | Wenxuan | <date> |
