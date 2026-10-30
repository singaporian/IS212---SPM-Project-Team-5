// US-027 - Receive Relevant Event Notifications
// Pure unit tests for which changes are "relevant" to Technical Support Staff
// who have equipment reserved for an event.
const test = require('node:test');
const assert = require('node:assert/strict');
const { touchesEquipmentRelevantFields } = require('../../src/changeRequests');

// AC-027: date/time/equipment changes are relevant.
test('a start-time change is relevant', () => {
  assert.equal(touchesEquipmentRelevantFields({ preferredStart: '2099-01-01T10:00:00+08:00' }), true);
});

test('an end-time change is relevant', () => {
  assert.equal(touchesEquipmentRelevantFields({ preferredEnd: '2099-01-01T11:00:00+08:00' }), true);
});

test('an equipment requirements change is relevant', () => {
  assert.equal(touchesEquipmentRelevantFields({ equipmentRequirements: [] }), true);
});

test('a change touching one relevant field among several others is still relevant', () => {
  assert.equal(touchesEquipmentRelevantFields({ venueLayoutPreference: 'Theatre', preferredStart: '2099-01-01T10:00:00+08:00' }), true);
});

// AC-027: unrelated changes (e.g. venue layout only) are not relevant.
test('a venue-layout-only change is not relevant', () => {
  assert.equal(touchesEquipmentRelevantFields({ venueLayoutPreference: 'Theatre style, updated' }), false);
});

test('an empty change set is not relevant', () => {
  assert.equal(touchesEquipmentRelevantFields({}), false);
});

test('other unrelated fields are not relevant', () => {
  assert.equal(touchesEquipmentRelevantFields({ purpose: 'Updated purpose', expectedAttendance: 50 }), false);
});
