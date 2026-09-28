# US-006 — Submit a Completed Draft for Review

## Current scope

This plan supersedes the earlier save-first test plan. Manual IDs below match the final Lark cases. Historical execution records are not evidence that the current cases passed.

The Organiser can submit the current valid form directly, including a new unsaved form or unsaved edits to an existing draft. Save Draft remains available independently. Submission validates current values and atomically persists them under the same request ID with status `submitted`; it does not create a duplicate or assign a coordinator automatically.

Mandatory submission fields: nonblank Event Name, valid Start Date/Time and End Date/Time, and positive whole-number Expected Attendance >= 1. There is no future-date restriction. The existing integer-storage and 10,000-character safeguards remain technical limits. Event names use a nonblank check, not a placeholder-word blacklist.

Attendance may be blank or `Not decided` while saving a Draft. At submission:

- Missing or `Not decided`: `Enter a positive whole number before submitting.`
- Malformed, fractional or below 1: `Enter a positive whole number.`
- Above the supported integer range: `This attendance estimate is too large. Enter a smaller number.`

Other fields remain optional. Accessibility/Equipment accept `None` or `Not Required`. Unknown (`Not decided`) and not applicable remain distinct in displayed draft text. Registration offers Required / Not required / Not decided; its stored structured value is true / false / null respectively.

Validation failure preserves current input, identifies affected fields and leaves an existing request in Draft without overwriting saved data. Invalid new submissions create no partial database event. Success displays confirmation, preserves current values, and makes the request visible in the coordinator unassigned queue. Confirmation remains visible if the subsequent receipt GET fails; Retry reloads the receipt only.

## CHG-001 and DEF-001

Any valid HH:mm minute from 00:00 through 23:59 is accepted. Native time controls use `step="60"`; there is no five-minute restriction. The combined end datetime must be later than the start datetime:

| Condition | Field error |
| --- | --- |
| End Date < Start Date | Only End Date: `End date must not be earlier than the start date.` |
| Same date and End Time <= Start Time | Only End Time: `End time must be later than the start time.` |
| End Date > Start Date | Earlier end clock times are valid if the individual dates/times are valid. |

These field choices apply to interval-order errors; independently malformed dates/times still receive their own validation errors. DEF-001 tests cover earlier date, equal same-day time, earlier same-day time and valid overnight intervals, including rendered error styling and aria-invalid.

Singapore UTC+8 storage handling is unchanged. Submitted event times display as 12-hour AM/PM without altering the API values. Native edit controls follow browser/locale display conventions.

## API and field mapping

`POST /api/drafts/:id/submit` accepts:

- Existing draft: `{ "version": "<version returned by draft GET/PUT>", "draft": { ...currentFormValues } }`.
- New unsaved form: `{ "version": null, "draft": { ...currentFormValues } }`, using the form's stable UUID.
- Legacy saved-snapshot submission: `{ "version": "<saved version>" }`.

Other top-level properties are rejected. Ownership/authentication, transactions, version checks and duplicate protection remain enforced. A stale saved version returns 409. Matching retries of submitted content return the existing receipt; different submitted content is rejected.

| Form property | Submitted column |
| --- | --- |
| eventName | title |
| purpose / description | purpose / description |
| startDate + startTime | preferred_start, interpreted as UTC+8 |
| endDate + endTime | preferred_end, interpreted as UTC+8 |
| expectedAttendance | expected_attendance |
| venueRequirements | venue_layout_preference |
| accessibilityNeeds | accessibility_requirements: notes object, or empty object |
| equipmentRequirements | equipment_requirements: text array, or empty array |
| registrationNeeds | registration_required: yes=true, no=false, not_decided=null |

Original current strings are preserved in draft_data. Structured accessibility/equipment normalize blank, None, Not Required and Not decided to empty structures; receipt and coordinator displays use original draft text to retain the distinction. No event type, programme or special-arrangement values are invented.

## Manual cases — final Lark IDs

Preconditions: database/schema and backend/frontend running; Organiser signed in. Use a separate browser profile for the Coordinator. Unless specified, use 2026-10-15 10:00 to 11:00, attendance 25, and a unique event name. These dates are fixed test data, not a minimum-date rule.

| ID | Scenario and steps | Data | Expected result |
| --- | --- | --- | --- |
| US-006-001 | Enter a complete new request; Submit directly; inspect receipt/list and coordinator queue. | US006 Direct Workshop; Purpose Student learning; Description Practical workshop; Venue Theatre seating; Accessibility Wheelchair access; Equipment Projector; Registration Required. | Confirmation; Submitted; current values preserved; one request in list; visible as available for assignment. Do not exercise assignment itself. |
| US-006-002 | Save a complete draft; record ID; change values without saving; Submit; inspect receipt and lists. | US006 Original -> US006 Revised; Revised purpose; Description/Venue blank; Accessibility None; Equipment/Registration Not Required. | Revised current values and optional choices preserved; same ID; no duplicate; removed from Drafts; confirmation. |
| US-006-003 | Save complete draft; change Purpose without saving; clear each name/start date/start time/end date/end time individually and Submit, restoring between attempts. Inspect saved draft separately. | US006 Mandatory Fields; Purpose Keep my current input. | Each attempt blocked with affected field identified; current input retained; saved Draft unchanged; no success confirmation. |
| US-006-004 | Save/reopen and attempt Submit with each unresolved attendance value. | US006 Estimate Pending; attendance blank, then Not decided. | Both save as Draft; both blocked at submission with exact before-submitting attendance message; input and Draft retained. |
| US-006-005 | Save attendance 25; try abc then 1.5 without saving; Submit each. | US006 Attendance Format. | Both rejected with Enter a positive whole number.; current input retained; saved Draft remains 25. |
| US-006-006 | Save attendance 25; attempt Submit with 0; change to 1 and Submit directly. | US006 Attendance Boundary. | 0 rejected with positive-whole-number message, Draft retained; 1 succeeds with confirmation and attendance 1 preserved. |
| CHG-001-001 | Save/reopen non-five-minute times; Submit; inspect receipt. | CHG001 Minute Precision; 2026-10-15 10:03 to 10:04. | No rounding; one-minute interval accepted; receipt 10:03 AM to 10:04 AM. |
| CHG-001-002 | Enter new request and Submit directly across midnight. | CHG001 Midnight Boundary; 2026-10-15 23:59 to 2026-10-16 00:00. | Valid interval; dates unchanged; receipt 11:59 PM to next-day 12:00 AM Singapore time. |
| CHG-001-003 | Save valid 10:03 to 11:00; attempt same-day end 10:03 then 10:02; inspect saved draft separately. | CHG001 End Order; 2026-10-15. | Both blocked; only End Time invalid with exact DEF-001 time message; current input retained; saved Draft unchanged. |

Yu Hui reported executing these nine cases in Lark. Actual results, dates and attachments remain in Lark; this document does not infer pass status or claim a new browser run. DEF-001 regression coverage additionally verifies the earlier-end-date branch without adding redundant Lark IDs.

## Automated traceability and execution

Nearby comments in backend/test/submissions.test.js, backend/test/drafts.test.js, frontend/test/drafts.test.cjs and frontend/test/organiser-time-display.test.cjs link the final Lark IDs to existing tests. Coverage is shared across unit, real API/PostgreSQL integration and component/template tests; these are not browser E2E replays.

Automated-only checks include invalid native-clock values (AC-CHG001-03), authentication/ownership, stale versions, concurrent/idempotent retries, transaction rollback, integer overflow, malformed dates and POST-success/receipt-GET-failure handling. Invalid-clock field identification is specifically tested by:

- `CHG-001 draft validation accepts every minute and identifies invalid time fields` in backend/test/drafts.test.js.
- `US-006 rejected values give corrective errors and preserve the entire draft` in backend/test/submissions.test.js.

Run from the repository root after starting PostgreSQL and applying the schema with backend's `npm run init-db`:

```powershell
npm test --prefix backend
npm test --prefix frontend
npm run build --prefix frontend
git diff --check
```

For local app setup, follow README.md. Fill the form and choose Submit for Review directly; Save Draft is optional. Check coordinator queue visibility without requiring assignment for US-006.

Backend tests use isolated fixtures and deliberate database failures to verify rollback. The normal backend npm suite excludes the older root-level backend/test-us011-us012.js shared-fixture script. Frontend tests use mocked transport and render actual templates for relevant UI checks.

Latest verified regression baseline (2026-09-28): backend 47 passed; frontend 34 passed; production build passed. Node counts include parent integration entries. The build emits the existing Vite CJS API deprecation warning. Earlier test counts and browser observations in historical records are not current acceptance evidence.
