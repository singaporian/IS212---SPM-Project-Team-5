// US-031 unit tests: which statuses let the Organiser edit a request directly.
// Pure domain methods; no database or server. [UT-xx] ids link to docs/testing/US-031-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventRequest } = require('../../src/domain');

// [UT-01] canEdit statuses (AC-031-001): moved to backend/test/unit/domain.test.js [UT-OOP-02],
// which already checked the same 2 allowed / 7 refused statuses (dedupe #1).

test('[UT-02] each active status allows either a direct edit or a change request, never both or neither', () => {
  for (const status of ['submitted', 'clarification_requested', 'approved', 'planning', 'confirmed']) {
    const request = new EventRequest({ status });
    assert.equal(request.canEdit() !== request.canRequestChanges(), true, status);
  }
});
