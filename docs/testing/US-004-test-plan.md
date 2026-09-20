# US-004 — Save Draft Progress: Run Guide and Test Report

| Item | Value |
| --- | --- |
| Epic | EPIC 2 — Event Request Management (Event Organiser) |
| User story | US-004 — Save Draft Progress — 5 SP, P0 |
| Branch | yuhui/developer/US-004/save-draft-progress |
| Execution date | 13 September 2026, Asia/Singapore |
| Environment | Windows PowerShell; Node v24.14.1; npm 11.11.0; PostgreSQL project database |
| Overall result | Automated checks pass against the clarified Week 4 scope; browser acceptance remains pending |
| Evidence | [Automated execution output](US-004-test-results.txt) |

## 1. What the feature does

An Event Organiser enters whatever information is currently known and selects
**Save Draft**. The browser sends the current form to the backend, which validates
the supplied values and saves them to PostgreSQL. A successful save displays a
confirmation and keeps the request in Draft status.

Each form receives a stable UUID. The first save creates the draft; subsequent
saves and retries use the same UUID. This prevents repeated saves in that form
from creating duplicate event requests. **Dashboard > My Drafts** lists the
organiser's drafts and provides links to reopen the latest saved values.

The API checks both the authenticated role and the creator's ID. Another
organiser receives a generic “Draft not found” response, without draft contents.
All fields are written in one SQL statement, so a failed write cannot persist
only some fields. A failed request leaves the browser's unsaved form values
available for retry.

### Implementation locations

| File | Responsibility |
| --- | --- |
| backend/src/drafts.js | Validation, authenticated draft list/read/save API, atomic SQL save |
| backend/sql/schema.sql | Idempotent addition of events.draft_data |
| frontend/src/components/EventRequestForm.vue | Save action, messages, load existing values, retain failed-save input |
| frontend/src/services/drafts.js | Authenticated API requests and error handling |
| frontend/src/views/DraftsView.vue | My Drafts listing |
| frontend/src/router/index.js | Organiser-only list and draft routes |
| backend/test/drafts.test.js | Validator and real PostgreSQL API tests |
| frontend/test/drafts.test.cjs | Form method/computed-property tests with mocked API requests |

Draft data is stored as JSON to preserve blank fields, separate dates and times,
literal placeholder text, whitespace, and the three registration choices.
The event title is also stored in the title column for listing. The other
structured event columns are not populated by this save feature; a later
submission workflow must validate and map draft values.

## 2. How to run locally

Prerequisites: Node.js/npm installed, Docker Desktop running with its Linux
engine, and a terminal opened at the repository root. Node 24 was used for this
test run.

### First-time setup or setup after pulling the feature

In PowerShell at the repository root:

~~~powershell
docker compose up -d db
if (!(Test-Path backend/.env)) {
    Copy-Item .env.example backend/.env
}
cd backend
npm install
npm run init-db
npm run seed-demo
npm run dev
~~~

Use DB_HOST=127.0.0.1 and DB_PORT=55432 in backend/.env for the project container.
Keep the other database credentials consistent with the existing example and
Docker configuration. Do not overwrite an already configured .env.

The init-db command is required after pulling this feature to add draft_data to
an existing database. It was already run successfully in this workspace during
implementation. seed-demo is optional and creates the local testing accounts.

In a second terminal, opened at the repository root:

~~~powershell
cd frontend
npm install
npm run dev
~~~

Leave both development servers running. Open http://localhost:5173 and sign in:

- Email: organiser@connectsphere.local
- Password: Password123!

Choose **Create Request**, enter a purpose, and select **Save Draft**.
Return through **My Drafts** to reopen it. The backend uses port 3000; Vite proxies
/api to it. If Vite reports another port, use the URL printed in its terminal.

For later starts, run docker compose up -d db from the root, then npm run dev
separately in backend and frontend. Reinstallation and seeding are unnecessary
unless dependencies or fixtures change.

If Docker reports that dockerDesktopLinuxEngine is missing, open Docker Desktop
and wait for its engine to start. The obsolete Compose version warning is not
the cause of that connection failure. Do not delete database volumes to test
save failures.

## 3. How to run the automated checks

With PostgreSQL running and the schema initialized, use a terminal at the root:

~~~powershell
cd backend
npm test
cd ../frontend
npm test
npm run build
~~~

The development servers do not need to be running for these checks.

| Check | Actual result |
| --- | --- |
| Backend npm test | PASS: 15 reported tests, 0 failures |
| Frontend npm test | PASS: 10 tests, 0 failures |
| Frontend npm run build | PASS |
| Full browser/manual acceptance run | Not executed |
| Nine Week 4 fields and valid historical dates | Covered by updated API and form tests; see section 7 |

The backend count includes its parent integration test. These counts are test
runner results, not 25 independent acceptance scenarios.

Backend tests mount the actual router and authentication middleware in a local
test server and execute real SQL against a temporary copy of the events table.
The connection rolls back and drops the temporary table. Existing user drafts
are not changed. Test tokens are generated for fixture identities, so these
tests do not exercise login/registration or the production users foreign key.

A deliberate test_write_failure database constraint error is expected in the
output: that test verifies failure handling and unchanged saved values. The
runner still finishes with zero failures.

Frontend tests execute component methods and computed properties with mocked
requests. They verify form state, validation and retry behavior. They do not
mount a browser DOM or verify rendered messages, focus, real router lifecycle,
or complete browser-to-API integration. Build success verifies compilation,
not browser acceptance.

## 4. Accounts and evidence for manual testing

Use the seeded organiser as Organiser A. Create a second account from the login
page, choosing **Event Organiser**, for Organiser B. Use two separate browser
profiles or one normal and one private window. Tabs in the same profile share
the stored session and are unsuitable for independent A/B sessions.

Use a unique test name such as “US004 Manual 2026-09-13”. Record the draft UUID
from /requests/drafts/<id>, the input values, the response status and any
screenshots. Do not include authentication tokens in the submitted evidence.

For each manual test, record Actual Result, Pass/Fail, Tester and Execution Date.
The automated status below is supporting evidence, not a completed manual run.

## 5. Your six scenarios: detailed procedures

### TC-US004-01 — Save an incomplete draft successfully

- Type: Positive / Happy Path. Priority: P0.
- Preconditions: Organiser A is signed in; backend/database are available.
- Steps:
  1. Select Create Request.
  2. Enter Purpose = “Planning a student workshop”; leave Event Name, dates and attendance blank.
  3. Select Save Draft.
  4. Record the draft URL and open My Drafts.
- Expected: A confirmation appears; exactly one draft is created; status remains
  Draft; blank fields are allowed; the title may display as Untitled event.
  Reopening retains the purpose exactly.
- Automated evidence: PASS for existing fields through partial-save API tests
  and successful-retry confirmation state. All nine Week 4 field groups are covered by an additional API round-trip test.
- Manual result: Not run.

### TC-US004-02 — Update an existing saved draft

- Type: Positive. Priority: P0.
- Preconditions: A saved draft owned by A.
- Steps:
  1. Open it from My Drafts and record its UUID.
  2. Enter Event Name = “Student Workshop”; change Purpose to “Revised planning”.
  3. Save, then save again without changing anything.
  4. Return to My Drafts and reopen the request.
- Expected: The UUID is unchanged; the same row is updated, with no duplicate;
  the latest values are saved; status remains Draft. Unedited form values stay
  as they were.
- Automated evidence: PASS; repeated API saves assert a single row and exact
  data. The current API expects a complete form snapshot, not a partial PATCH.
- Manual result: Not run.

### TC-US004-03 — Reopen and retrieve the latest saved values

- Type: Positive. Priority: P0.
- Preconditions: A has saved the updated draft from TC-US004-02.
- Steps:
  1. Add a multiline description, venue text with spaces, attendance “not decided”,
     and Registration Needs = Not required.
  2. Save, return to My Drafts, and reopen the draft.
  3. Refresh the saved draft URL.
  4. Sign out and back in as A, then reopen it again.
- Expected: Each corresponding field shows the most recently saved value,
  including blanks, line breaks and registration selection.
- Automated evidence: PASS for API round-trip and form restoration. Refresh and
  sign-out/sign-in persistence still need browser verification.
- Manual result: Not run.

### TC-US004-04 — Handle save failure without a partial save

- Type: Negative / Recovery. Priority: P0.
- Preconditions: Save Event Name = “Original name” and Purpose = “Original purpose”.
- Steps:
  1. Change both fields to new values without saving yet.
  2. Stop only the backend dev server with Ctrl+C.
  3. Select Save Draft in the existing browser tab.
  4. Confirm the error and both unsaved field values remain visible.
  5. Restart the backend with npm run dev.
  6. Before retrying, inspect the saved draft in a second tab in A's session.
  7. Return to the original tab and retry Save Draft.
- Expected: Failure shows an error and no success confirmation. The second tab
  shows the original values. A successful retry persists both new values using
  the same draft UUID.
- Automated evidence: PASS. A forced PostgreSQL constraint failure proves the
  entire write is rejected; a separate form test proves input retention/retry.
  Stopping the server manually tests the network-failure path.
- Manual result: Not run.

### TC-US004-05 — Another organiser attempts to view the draft

- Type: Negative / Security. Priority: P0.
- Preconditions: A owns a saved draft; B is signed in using a separate profile.
- Steps:
  1. Copy A's saved draft URL into B's browser.
  2. Open My Drafts as B.
  3. In B's browser developer tools, inspect GET /api/drafts/<A-draft-id>.
- Expected: No draft contents are exposed. The direct API read returns 404 and
  “Draft not found.” A's draft is absent from B's list. The form is not editable.
- Automated evidence: PASS for ownership-filtered read/list and load error state.
- Manual result: Not run.

### TC-US004-06 — Another organiser attempts to modify the draft

- Type: Negative / Security. Priority: P0.
- Preconditions: Same as TC-US004-05. Record A's original values.
- Steps:
  1. While signed in as B, send the API request below from the app's developer
     console, replacing the placeholder with A's draft UUID.
  2. Inspect the HTTP status and JSON response.
  3. As A, reopen the draft and compare its saved values.
- Expected: 404 with a generic error; no draft contents in the response; A's
  original values and Draft status remain unchanged.
- Automated evidence: PASS through an actual authenticated PUT as a different
  organiser, followed by verification of unchanged saved data.
- Manual result: Not run.

~~~javascript
const response = await fetch('/api/drafts/REPLACE_WITH_A_DRAFT_UUID', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + localStorage.getItem('connectsphere_token')
  },
  body: JSON.stringify({ eventName: 'Unauthorised edit' })
});
console.log(response.status, await response.json());
~~~

Run that snippet only as B against A's test draft. The server should reject it;
using A's token would authorize a full snapshot save and clear omitted fields.

## 6. Additional scenarios to include

Automated PASS refers only to the layer specified. All browser executions remain
pending unless separately recorded.

| ID | Type | Scenario / procedure | Expected result | Current evidence |
| --- | --- | --- | --- | --- |
| TC-US004-07 | Positive / Status | Save a draft repeatedly; inspect returned status | Always Draft; never submitted for review | PASS, API |
| TC-US004-08 | Boundary | Save a completely blank form | Allowed; untitled draft created | PASS, API; confirm product interpretation of “any subset” includes empty subset |
| TC-US004-09 | Boundary | Save only a future date, then only a time | Partial date/time pairs preserved exactly | PASS, API |
| TC-US004-10 | Negative / Validation | Try attendance -2, 1.5 or text other than accepted placeholders | Reject; previous save unchanged; explain attendance issue | PASS, validator/API/form |
| TC-US004-11 | Negative / Validation | Try impossible date, invalid time interval or end before start | Reject invalid values | PASS, validator; form covers complete reversed times |
| TC-US004-12 | Reliability | Double-click Save while a request is pending | One in-flight save; stable ID on retry | PASS, form and repeated API save |
| TC-US004-13 | Security | Call list/read/save with no token or expired token | 401; saved data unchanged | PASS, API |
| TC-US004-14 | Security | Read/save as attendee, coordinator, venue staff or technical staff | 403 before accessing draft contents | PASS, API |
| TC-US004-15 | Security | GET malformed UUID or unknown UUID; PUT malformed UUID | Generic 404 without contents | PASS, API; unknown valid PUT intentionally creates an owned draft |
| TC-US004-16 | Security | Add organiser_id or status=submitted to a save body | Reject unknown fields; owner and status unchanged | PASS, API |
| TC-US004-17 | Regression | Clear a previously saved field, then reopen | Cleared field stays blank; other snapshot values preserved | PASS, API |
| TC-US004-18 | Boundary | Save each registration choice and placeholder text with whitespace/newlines | Exact values restored | PASS, API/form |
| TC-US004-19 | Negative / Status | Attempt draft API save after status becomes Submitted | Reject; do not revert to Draft | PASS, API fixture |
| TC-US004-20 | Recovery | Fail a draft load, then retry | Error clears; saved values load | PASS, form |
| TC-US004-21 | Reliability | Previous draft's delayed response arrives after selecting another draft | Old response does not overwrite current form | PASS, form |
| TC-US004-22 | Positive / Validation | Save a valid historical date with and without time | Allow; no past-date restriction in agreed Draft rules | PASS, API/form |
| TC-US004-23 | Completeness | Save/reopen all nine Week 4 field groups | All agreed fields available and preserved | PASS, API round-trip; browser pending |
| TC-US004-24 | Persistence | Refresh, sign out/in, restart backend, reopen saved UUID | Latest committed values persist | Manual pending |
| TC-US004-25 | Reliability | Lose response after server commits; retry same draft UUID | Only one draft exists; no lost saved fields | Partly covered by stable-ID tests; exact network-loss timing not exercised |
| TC-US004-26 | Concurrency | Open one draft in two tabs and save different changes | Behavior agreed and documented; no unexpected silent data loss | Not run; current full-snapshot saves imply last successful save wins |

The unsaved-navigation warning belongs to US-005. Mandatory-field submission and
changing status to Submitted belong to US-006. They should be tested in those
feature branches rather than counted as missing US-004 functionality.

## 7. Findings and acceptance decision

### Clarified field scope and validation

The user clarified the scope on 13 September 2026:
- Drafts use the nine Week 4 field groups: Event Name, Purpose, Description,
  Proposed Date/Time, Expected Attendance, Venue Requirements, Accessibility
  Needs, Equipment Requirements and Registration Needs.
- Drafts may be incomplete, but entered values must be valid.
- There is no past-date restriction unless subsequently required by customer
  clarification.

The earlier F-01 missing-field finding is superseded by this scope decision.
Event Type, Programme/Agenda and Special Arrangements are not required for this
US-004 implementation. This decision changes the applicable scope; it does not
mean the fields were added.

The earlier F-02 past-date finding is superseded by the clarified rule.
The frontend past-start restriction has been removed to match the API.
Regression tests cover valid historical dates with and without a time.
Impossible calendar dates and malformed times remain invalid, and an entered
end date/time must follow the entered start date/time where comparable.
The existing five-minute time selection, attendance placeholder handling and
registration choices are unchanged.

A real SQL round-trip test now supplies all nine field groups and compares every
returned value. The original audit output is historical evidence; the updated
execution log describes the current requirements and results.

### F-03 — Browser acceptance evidence is outstanding

Automated form logic tests do not prove visual confirmation rendering, actual
route transitions, shared-session behavior or end-to-end login/save/reopen.
Execute the six manual procedures and TC-US004-24 before final sign-off.

### Branch hygiene

The working tree also contains earlier coordinator_id schema edits and an
untracked root package-lock.json. They predate this test task. Exclude unrelated
changes from the US-004 commit; do not discard them. No commit or push was made
as part of this test run.

## 8. Acceptance-criteria traceability

| US-004 acceptance criterion | Cases | Assessment |
| --- | --- | --- |
| Valid subset of US-003 fields can save while others are incomplete | 01, 08–11, 18, 22, 23 | All nine Week 4 field groups tested under the clarified rules |
| Successful save preserves input and shows confirmation | 01, 03, 18 | API/form state pass; rendered confirmation pending |
| Saving an existing draft updates it, without duplicates | 02, 12, 25 | Repeated-save checks pass; exact lost-response timing pending |
| Saving keeps Draft status and does not submit | 07, 16, 19 | API checks pass |
| Reopening shows most recent saved values | 03, 17, 18, 24 | API/form checks pass; browser persistence pending |
| Failed save informs organiser, is atomic and retains input | 04, 10, 13, 20 | PostgreSQL and form checks pass; browser recovery pending |
| Only creator can view/modify; reject without exposing contents | 05, 06, 13–16 | API checks pass; browser checks pending |

Recommended disposition: complete the browser acceptance procedures, then prepare a scoped US-004 commit and PR. The earlier field-scope and past-date findings are resolved by the recorded clarification and implementation alignment. Automated results do not substitute for browser evidence.
