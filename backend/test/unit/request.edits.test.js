// US-031 unit tests: which statuses let the Organiser edit a request directly.
// Pure domain methods; no database or server. [UT-xx] ids link to docs/testing/US-031-test-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventRequest } = require('../../src/domain');

test('[UT-01] canEdit is true only for submitted and returned requests', () => {
  for (const status of ['submitted', 'clarification_requested']) {
    assert.equal(new EventRequest({ status }).canEdit(), true, status);
  }
  for (const status of ['draft', 'approved', 'planning', 'confirmed', 'rejected', 'cancelled', 'completed']) {
    assert.equal(new EventRequest({ status }).canEdit(), false, status);
  }
});

test('[UT-02] each active status allows either a direct edit or a change request, never both or neither', () => {
  for (const status of ['submitted', 'clarification_requested', 'approved', 'planning', 'confirmed']) {
    const request = new EventRequest({ status });
    assert.equal(request.canEdit() !== request.canRequestChanges(), true, status);
  }
});
