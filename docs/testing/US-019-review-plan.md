# US-019 — Review a Venue Booking Request

## Authority and scope

Section-specific clarifications take precedence over Week 4, Week 1, backlog and existing code, in that order. Week 4 verification was supplied by Yu Hui: Venue Staff review pending booking requests and approve/reject them; confirmed bookings affect availability; the approved-to-confirmed transition is unspecified. Week 1 supports reviewing timing, attendance, requirements, existing bookings, recorded unavailability, operating information and applicable setup/turnaround. Existing code is not a business-rule source.

US-019 is read-only review. The four ACs cover request details, relevant venue information, conflict identification and applicable buffers. Approval, rejection, alternative suggestions, notifications and decision transitions are unchanged.

## Source-backed scope and unresolved lifecycle rule

- Confirmed bookings and recorded venue unavailability affect availability; incompatible overlaps and applicable buffers must be identified/considered. These are source-supported requirements.
- The earlier approved-as-reserved assertion was an unsupported assumption and has been removed. The team has NOT confirmed whether approval reserves a venue. US-019 currently counts only `confirmed` bookings and overlapping recorded unavailability as availability conflicts. `approved`, `pending`, `rejected` and `alternative_suggested` records remain visible for context, without inferred reservation semantics. Approval/decision code is unchanged.
- Use recorded setup/turnaround values only. Missing values add no buffer. Existing workflow/database defaults are not changed by this story; the review does not invent fallback durations.
- Submitted booking arrangement is primary. Current event timing/requirements are labelled separately rather than substituted. The current booking record stores timing and venue requirements, not a historical snapshot of every event field.
- Display operating hours, notes and recorded availability dates without outside-hours warnings or blocking.
- Preserve minute precision and format displayed times as 12-hour AM/PM in Singapore time.

## Implementation/boundary convention — not confirmed business policy

The overlap calculation uses strict comparisons: first.start < second.end and first.end > second.start, after applying recorded buffers. Exact touching therefore does not generate an overlap result in the current implementation. This is a technical comparison convention, NOT a customer requirement or an agreed team decision. Automated tests document this implementation boundary; they do not establish business acceptance. Do not make exact-touch allowed/disallowed a manual acceptance criterion until the team confirms the policy. Recorded buffers that create a positive-duration overlap still identify a conflict.

Recorded venue unavailability is independently checked against the occupied request interval. The request itself is excluded. Nearby records are shown for the Singapore calendar dates touched by the occupied interval. Operating hours are shown as the recorded weekly schedule. Review refresh reloads current data and does not use the old submission-time conflict flag.

## Implementation

- GET /api/bookings/:id/review, Venue Staff only, no writes and no cache.
- Existing pending-request screen expands a review panel with booking/event requirements, venue information, occupied intervals, bookings and blocked periods.
- Errors clear the previous result and offer Retry rather than implying availability.
- No schema changes or new reservation statuses.
- Existing US-015 conflict-acknowledgement submission behaviour is a separate discrepancy with the later customer clarification; it is not endorsed or changed here.

## Manual scope: Week 4 five-step method

1. Workflow: open request, inspect arrangement and venue information, inspect current conflicts; stop before a decision.
2. Happy path: full request and venue details, differing event preferences labelled separately, 10:03 AM retained, no reservation conflicts.
3. Story-specific quality: refresh updated availability; loading failure never displays a false no-conflict result.
4. Negative scenarios: overlapping confirmed booking; overlapping recorded unavailability; approved/pending records remain contextual under the current limited conflict classification. Verify a clear positive-duration buffer-created overlap without relying on an exact-touch expectation.
5. Boundaries: exact-touch business acceptance is deferred pending team confirmation; its present implementation is tested automatically only. No future-date or operating-hours boundary is invented.

Status: implementation accepted; pending final manual/integration verification. The real US-015 → Pending Review → US-019 workflow is not yet available, so the automated fixture-based checks do not establish end-to-end workflow acceptance. Do not mark US-019 fully verified until that workflow is exercised.

## Automated coverage

- backend/test/booking.review.test.js: confirmed-only classification with approved records retained as context; self/other-venue exclusion; both buffer directions; missing/zero buffers; strict-overlap boundary convention (not acceptance policy); combined buffers; cross-midnight precision; blocked periods; real API/database details and refresh; no writes/notifications; roles and failures.
- frontend/test/booking-review.test.cjs: actual rendered details, separate values, AM/PM and minute precision, current conflicts/pending display, GET-only refresh and error/retry behaviour.
- Run full backend/frontend suites and frontend build to retain US-006, CHG-001 and DEF-001 coverage.

## Execution record — 2026-09-29

- Targeted US-019 backend: 10 passed (includes parent integration entry).
- Targeted US-019 frontend: 3 passed.
- Full backend suite: 74 passed, 0 failed.
- Full frontend suite: 37 passed, 0 failed.
- Frontend production build: passed; existing Vite CJS deprecation warning.
- git diff --check: passed.
- No manual browser execution performed for US-019; final manual/integration verification remains pending as stated above.
