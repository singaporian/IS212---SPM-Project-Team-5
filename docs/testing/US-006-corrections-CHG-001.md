> Update — 2026-10-02: CHG-001 is withdrawn for the organiser event form. Five-minute selections and validation are restored. US-006 direct submission, DEF-001 field-specific ordering errors, AM/PM display and venue-booking work remain. The execution record below is historical evidence, not the current organiser timing specification. Existing stored times are not rewritten or rounded.

# US-006 corrections and CHG-001 execution record

Date: 2026-09-28

## US-006 corrections

Attendance errors distinguish missing, malformed, below-one and database-range values. The nonblank event-name requirement remains; the placeholder word blacklist is removed. Submission confirmation renders independently of the subsequent receipt GET, including when receipt loading fails. Retrying receipt loading performs only a GET.

## CHG-001 — Refine Event Time Input

This is a later refinement linked to completed US-003, not a revision of historical Sprint 1 acceptance or execution records.

Native time inputs use minute precision. Draft and submission validators accept any HH:mm clock time from 00:00 to 23:59. Existing start/end ordering, optional draft fields, Singapore timezone, and historical-date support remain unchanged.

## Verification

- Backend full npm test suite: 39 passed, 0 failed, 0 skipped.
- Frontend full npm test suite: 30 passed, 0 failed, 0 skipped.
- Frontend production build: passed.
- git diff --check: passed.
- Backend cases cover each attendance error, blank names, former placeholder names, attendance one, arbitrary minute times, invalid times, unchanged rejected rows, preservation, status transition and assignment availability.
- Frontend tests execute the POST-success/detail-GET-failure sequence with mocked transport and render the actual Vue template to verify both success and load-error text. Retry is asserted to issue GET only. Native time input attributes and minute-value save behaviour are checked.
- Existing ownership, rollback, stale-version, concurrent retry, draft and equipment regressions pass. No live browser acceptance run was performed for this change.

## Not Decided investigation — representation unchanged

backend/src/submissions.js optionalText treats blank, none, not required and not decided as empty (case insensitive, trimmed comparison). The complete original strings stay unchanged in events.draft_data. The submission route maps empty accessibility to {} and empty equipment to []; therefore these structured columns do not distinguish unknown from explicitly unnecessary requirements.

Registration uses no -> false, not_decided -> null, yes -> true. Its UI offers Not required rather than a separate None option; the distinction is retained.

Current CoordinatorRequestsView reads the original accessibility/equipment draft strings before structured fallbacks, so those distinctions remain visible for submitted drafts. SubmittedRequestsView also reads draft_data. Consumers reading only structured requirements cannot distinguish the two states. No other direct consumer of these event requirement columns was found in the current backend/src and frontend/src search; venue search takes its own accessibility filter input.

Smallest safe immediate approach: continue reading the preserved draft_data to distinguish the values. If downstream structured consumers need an explicit distinction, agree additive requirement-state metadata and its consumer handling in a separately tracked change. Do not change the existing object/array types in isolation.

## Scope

No changes to authentication, coordinator queue or details, assignment, approval, notification, venue/resource planning, timezone, version/locking/idempotency policy, or saved-draft representation in this change. Shared draft time validation changes only under CHG-001. Existing uncommitted work predates this correction and is not attributed to it.
