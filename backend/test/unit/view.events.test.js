// US-028 - View Appropriate Event Information
// Pure tests for public registration-status rules; no database or HTTP server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { registrationWindowStatus } = require('../../src/registrations');

// AC-028-003: a confirmed event with registration enabled and available capacity is open.
test('confirmed registration event is open when it is required and within capacity', async () => {
  const result = await registrationWindowStatus(null, { status: 'confirmed', registration_required: true, registration_capacity: 50 }, 12);
  assert.deepEqual(result, { open: true, reason: null });
});

// AC-028-001/003: events that are not confirmed or do not require registration are closed.
test('registration status is closed when the event is not confirmed or registration is not required', async () => {
  assert.equal((await registrationWindowStatus(null, { status: 'planning', registration_required: true }, 0)).open, false);
  assert.equal((await registrationWindowStatus(null, { status: 'confirmed', registration_required: false }, 0)).open, false);
});

// AC-028-003: registration closes when the configured capacity has been reached.
test('registration status is closed when capacity has been reached', async () => {
  const result = await registrationWindowStatus(null, { status: 'confirmed', registration_required: true, registration_capacity: 2 }, 2);
  assert.deepEqual(result, { open: false, reason: 'This event has reached its registration capacity.' });
});
