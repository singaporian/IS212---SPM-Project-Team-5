# US-0XX — <Story title>: Test Plan

<!--
HOW TO USE (delete this comment block when done)
1. Copy this file to docs/testing/US-0XX-test-plan.md and replace every <…>.
2. Test IDs: UT-xx (backend unit), IT-xx (integration), FE-xx (frontend), E2E-xx (Playwright).
   Put the ID at the start of the test name in code, e.g. test('[IT-01] …'), so the plan and code match.
3. Keep it small: about one test per behaviour. If you can't explain a test in one line, cut it.
   - Unit and integration tests describe a FUNCTION or ENDPOINT.
   - E2E (functional) tests describe the USER STORY; aim for one happy-path journey.
4. TDD stories: commit the tests first (red), then the code (green), then any refactor.
   Fill section 7 at each stage. Older stories done before TDD: write "Tests added after implementation".
5. Use "—" for an empty cell; don't delete rows or sections.
-->

| Item | Value |
| --- | --- |
| User story | US-0XX — As a <role>, I want <goal>, so that <benefit>. |
| Owner | <name> |
| Branch | <name>/developer/US-0XX/<short-name> |
| Pull request | #<number> |
| Approach | TDD (tests written and run red before the code) / Tests added after implementation |
| Depends on | <other stories, or "None"> |

## 1. Acceptance criteria

| ID | Acceptance criterion | Source |
| --- | --- | --- |
| AC-0XX-001 | <…> | <Week 4 instructions / G7 clarifications / Week 7 changes> |
| AC-0XX-002 | <…> | <…> |

**Out of scope:** <what was deliberately left out and why, or "None">

## 2. Code under test

| Layer | File | Function / endpoint / page |
| --- | --- | --- |
| Domain / logic | `backend/src/…` | `<function>` |
| API | `backend/src/…` | `<METHOD /api/…>` |
| Schema | `backend/sql/schema.sql` | `<new tables or columns, or —>` |
| UI | `frontend/src/views/…` | `<route>` |

## 3. Test cases

### Unit — `backend/test/unit/<file>.test.js`
<What is real and what is faked, e.g. "Pure functions; no database or server.">

| ID | Function | Inputs | Expected | AC |
| --- | --- | --- | --- | --- |
| UT-01 | `<function>` | <inputs> | <result> | <AC> |

### Integration — `backend/test/integration/<file>.test.js`
<e.g. "Real router and SQL on temporary tables, rolled back after each run.">

| ID | Endpoint | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| IT-01 | `<METHOD /api/…>` | <setup and action> | <status code + what is saved> | <AC> |

### Frontend — `frontend/test/<file>.test.cjs`
<Test doubles used, e.g. "API call replaced by a stub returning sample data.">

| ID | Page / method | Scenario | Expected | AC |
| --- | --- | --- | --- | --- |
| FE-01 | `<View.vue> <method>` | <…> | <…> | <AC> |

### End-to-end (functional) — `e2e/tests/us0XX-<name>.spec.js`
<What the fixtures seed.>

| ID | User journey | Expected (what the user sees + what is saved) | ACs |
| --- | --- | --- | --- |
| E2E-01 | <steps> | <…> | <ACs> |

## 4. Traceability

<!-- Every AC needs at least one test, or a manual check in section 7. -->

| AC | Unit | Integration | Frontend | E2E / Manual |
| --- | --- | --- | --- | --- |
| AC-0XX-001 | — | — | — | — |
| AC-0XX-002 | — | — | — | — |

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
| <what went wrong, or "None"> | <ID> | <what changed> | `<hash> fix(US-0XX): …` |

Refactorings for this story are logged in [`docs/refactoring-log.md`](../refactoring-log.md), not here.

## 7. Results and evidence

Screenshots go in `docs/testing/evidence/US-0XX/`.

| Stage | Commit | Backend | Frontend | E2E | Evidence |
| --- | --- | --- | --- | --- | --- |
| Red (tests only) | `<hash>` | 0/<n> | 0/<n> | 0/<n> | [01-red.png](evidence/US-0XX/01-red.png) |
| Green (after code) | `<hash>` | <n>/<n> | <n>/<n> | <n>/<n> | [02-green.png](evidence/US-0XX/02-green.png) |
| After refactor | `<hash>` | <n>/<n> | <n>/<n> | <n>/<n> | [03-refactor-green.png](evidence/US-0XX/03-refactor-green.png) |
| CI on PR | — | ✅ | ✅ | ✅ | [04-ci-green.png](evidence/US-0XX/04-ci-green.png) |

### Manual check

| Step | Expected | Actual | Pass/Fail | Tester | Date |
| --- | --- | --- | --- | --- | --- |
| <user action> | <…> | <…> | <…> | <name> | <date> |
