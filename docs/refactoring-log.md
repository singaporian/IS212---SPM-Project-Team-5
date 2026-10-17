# Refactoring Log

Every refactoring the team makes is recorded here: one row per refactoring commit.

**Refactoring** means changing how code is structured **without changing what it does**.
- Tests must be green before and green after.
- Test files must not be changed in the same commit.
- Removing tests is not refactoring (that is test pruning, committed as `test:`), so it does not go here.

## How to refactor (team steps, about 15 minutes)

1. **Start green.** Branch off `main` (`name/developer/US-0XX/refactor-<short-name>`), run the tests and write down the pass count (e.g. 11/11).
   ```bash
   cd backend && node --test test/unit test/integration
   ```
2. **Pick one smell** in your story's code. Common ones:
   | Smell | Refactoring | Number to count |
   | --- | --- | --- |
   | Variable or function never used | Remove Dead Code | unused items |
   | Same code or call repeated | Extract Variable / Extract Function | number of copies |
   | Long function doing several jobs | Extract Function | lines in the function |
   | Magic strings like `'approved'` repeated | Replace Magic Literal with Constant | number of literals |
   | Unclear name | Rename | — (state the old and new name) |
3. **Count the number before** you change anything (e.g. "handler is 83 lines").
4. **Make one change.** AI help is fine; prompt: *"Refactor only <function> in <file> using <refactoring name>. Do not change behaviour, outputs, SQL results or error messages. Do not touch tests."*
5. **Rerun the tests.** The pass count must be the same. If anything goes red, undo the change (`git checkout -- <file>`); do not edit the test.
6. **Count the number after**, then commit one refactoring per commit:
   ```bash
   git commit -am "refactor(US-0XX): <what you did>"
   ```
7. **Add a row below** with the commit hash (`git log --oneline -1`), push, and open a PR titled `refactor(US-0XX): <summary>`.
8. **Evidence:** screenshot the test run after the refactor and save it as `docs/testing/evidence/US-0XX/03-refactor-green.png` (linked from the story's test plan, section 8).

## Log

| ID | Date | Story | Smell | Refactoring | File | Before → After | Tests before → after | Commit | By |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | 2026-10-17 | US-032 | `moved` calculated but unused; `movesEvent()` called twice | Remove Dead Code / reuse variable | `backend/src/changeRequests.js` | `movesEvent(event)` calls: 2 → 1 | 11/11 → 11/11 | `<hash>` | Wenxuan |
| R-02 | 2026-10-17 | US-032 | Decision handler mixed SQL building with business steps | Extract Function: `buildEventUpdate()` | `backend/src/changeRequests.js` | Handler: 83 → 77 lines | 11/11 → 11/11 | `<hash>` | Wenxuan |
