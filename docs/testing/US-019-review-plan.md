# US-019 — Review a Venue Booking Request

## Authority and scope

Section-specific clarifications take precedence over Week 4, Week 1, backlog and existing code, in that order. Week 4 verification was supplied by Yu Hui: Venue Staff review pending booking requests and approve/reject them; confirmed bookings affect availability; the approved-to-confirmed transition is unspecified. Week 1 supports reviewing timing, attendance, requirements, existing bookings, recorded unavailability, operating information and applicable setup/turnaround. Existing code is not a business-rule source.

US-019 is read-only review. The four ACs cover request details, relevant venue information, conflict identification and applicable buffers. Approval, rejection, alternative suggestions, notifications and decision transitions are unchanged.

## Source-backed scope and team lifecycle decision

- Confirmed bookings and recorded venue unavailability affect availability; incompatible overlaps and applicable buffers must be identified/considered. These are source-supported requirements.
- TEAM DESIGN DECISION (later explicitly confirmed): approved and confirmed bookings occupy the venue. Pending, rejected and alternative_suggested records do not reserve it. US-019 applies this policy to read-only conflict results; decision actions and other workflows are outside this change.
- Use recorded setup/turnaround values only. Missing values add no buffer. Existing workflow/database defaults are not changed by this story; the review does not invent fallback durations.
- Submitted booking arrangement is primary. Current event timing/requirements are labelled separately rather than substituted. The current booking record stores timing and venue requirements, not a historical snapshot of every event field.
- Display operating hours, notes and recorded availability dates without outside-hours warnings or blocking.
- Preserve minute precision and format displayed times as 12-hour AM/PM in Singapore time.

## Implementation/boundary convention — not confirmed business policy

The overlap calculation uses strict comparisons: first.start < second.end and first.end > second.start, after applying recorded buffers. Exact touching therefore does not generate an overlap result in the current implementation. This is a technical comparison convention, NOT a customer requirement or an agreed team decision. Automated tests document this implementation boundary; they do not establish business acceptance. Do not make exact-touch allowed/disallowed a manual acceptance criterion until the team confirms the policy. Recorded buffers that create a positive-duration overlap still identify a conflict.

Recorded venue unavailability is independently checked against the occupied request interval. The request itself is excluded. Nearby records are shown for the Singapore calendar dates touched by the occupied interval. Operating hours are shown as the recorded weekly schedule. Review refresh reloads current data and does not use the old submission-time conflict flag.

## Implementation

- GET /api/bookings/:id/review, Venue Staff only, no writes and no cache.
- Pending-request cards show attendance and availability summaries and link to a separate read-only review page with booking/event requirements, venue information, occupied intervals, bookings and blocked periods.
- Errors clear the previous result and offer Retry rather than implying availability.
- No schema changes or new reservation statuses.
- Existing US-015 conflict-acknowledgement submission behaviour is a separate discrepancy with the later customer clarification; it is not endorsed or changed here.

## Manual scope: Week 4 five-step method

1. Workflow: open request, inspect arrangement and venue information, inspect current conflicts; stop before a decision.
2. Happy path: full request and venue details, differing event preferences labelled separately, 10:03 AM retained, no reservation conflicts.
3. Story-specific quality: refresh updated availability; loading failure never displays a false no-conflict result.
4. Negative scenarios: overlapping confirmed booking; overlapping recorded unavailability; approved records are reservation conflicts; pending records remain contextual. Verify a clear positive-duration buffer-created overlap without relying on an exact-touch expectation.
5. Boundaries: exact-touch business acceptance is deferred pending team confirmation; its present implementation is tested automatically only. No future-date or operating-hours boundary is invented.

Status: implementation accepted; pending final manual/integration verification. Automated fixture-based checks do not establish manual end-to-end workflow acceptance. Do not mark US-019 fully verified until that workflow is exercised.

## Automated coverage

- backend/test/booking.review.test.js: approved/confirmed classification with pending records retained as context; self/other-venue exclusion; both buffer directions; missing/zero buffers; strict-overlap boundary convention (not acceptance policy); combined buffers; cross-midnight precision; blocked periods; real API/database details and refresh; no writes/notifications; roles and failures.
- frontend/test/booking-review.test.cjs: actual rendered details, separate values, AM/PM and minute precision, current conflicts/pending display, GET-only refresh and error/retry behaviour.
- Run full backend/frontend suites and frontend build to retain US-006 and DEF-001 coverage with the organiser CHG-001 revert from main.

## Execution record — 2026-09-29

- Targeted US-019 backend: 10 passed (includes parent integration entry).
- Targeted US-019 frontend: 3 passed.
- Full backend suite: 74 passed, 0 failed.
- Full frontend suite: 37 passed, 0 failed.
- Frontend production build: passed; existing Vite CJS deprecation warning.
- git diff --check: passed.
- No manual browser execution performed for US-019; final manual/integration verification remains pending as stated above.

## Current scope separation

The dedicated review page performs GET requests only. The review-only inbox and detail page omit decision controls; existing backend decision routes remain unchanged; no new approval, rejection, alternative, Reviewed navigation, decision metadata or notification implementation is imported. Venue search and submission occupancy-policy alignment remain separate integration work. Historical execution counts above predate this update.

## Layout restoration

Compact inbox cards and a dedicated styled review page retain the original review design, including coordinator/submission metadata and a non-blocking capacity comparison. No Decision panel or Reviewed tab is included. Backend 76 passed; frontend 40 passed; production build passed. Manual visual verification remains pending.
