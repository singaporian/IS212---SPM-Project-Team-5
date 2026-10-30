// US-029/US-030 - Register for Event / Withdraw Registration
// Pure unit tests for input validation and registration-window eligibility logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRegistrationInput, registrationWindowStatus, partitionRegistrations } = require('../../src/registrations');

// --- validateRegistrationInput ---

// AC-029-002: name, email and phone are all required.
test('rejects a missing name', () => {
  assert.throws(
    () => validateRegistrationInput({ name: '', email: 'a@b.com', phone: '91234567' }),
    err => err.status === 400 && Boolean(err.fields.name)
  );
});

// AC-029-003: email must look like an email address.
test('rejects an invalid email', () => {
  assert.throws(
    () => validateRegistrationInput({ name: 'Attendee', email: 'not-an-email', phone: '91234567' }),
    err => err.status === 400 && Boolean(err.fields.email)
  );
});

// AC-029-003: phone must contain enough digits to be a real number.
test('rejects a phone number that is too short', () => {
  assert.throws(
    () => validateRegistrationInput({ name: 'Attendee', email: 'a@b.com', phone: '123' }),
    err => err.status === 400 && Boolean(err.fields.phone)
  );
});

test('accepts a valid registration and trims whitespace', () => {
  const result = validateRegistrationInput({ name: '  Attendee  ', email: ' a@b.com ', phone: ' +65 9123 4567 ' });
  assert.deepEqual(result, { name: 'Attendee', phone: '+65 9123 4567', email: 'a@b.com' });
});

// --- registrationWindowStatus ---

const baseEvent = { status: 'confirmed', registration_required: true, registration_capacity: null, registration_opens_at: null, registration_closes_at: null };

// AC-029-001: only confirmed events accept registration.
test('closed when the event is not confirmed', async () => {
  const result = await registrationWindowStatus(null, { ...baseEvent, status: 'draft' }, 0);
  assert.equal(result.open, false);
  assert.match(result.reason, /not yet confirmed/);
});

// AC-029-001: only events marked as requiring registration accept it.
test('closed when the event does not require registration', async () => {
  const result = await registrationWindowStatus(null, { ...baseEvent, registration_required: false }, 0);
  assert.equal(result.open, false);
  assert.match(result.reason, /does not take attendee registration/);
});

// AC-029-007: registration cannot happen before the configured opening time.
test('closed before the registration window opens', async () => {
  const result = await registrationWindowStatus(null, { ...baseEvent, registration_opens_at: new Date(Date.now() + 86400000).toISOString() }, 0);
  assert.equal(result.open, false);
  assert.match(result.reason, /Registration opens/);
});

// AC-029-007: registration cannot happen after the configured closing time.
test('closed after the registration window closes', async () => {
  const result = await registrationWindowStatus(null, { ...baseEvent, registration_closes_at: new Date(Date.now() - 86400000).toISOString() }, 0);
  assert.equal(result.open, false);
  assert.match(result.reason, /Registration closed/);
});

// AC-029-008: registration cannot happen once capacity is reached.
test('closed once registration capacity is reached', async () => {
  const result = await registrationWindowStatus(null, { ...baseEvent, registration_capacity: 2 }, 2);
  assert.equal(result.open, false);
  assert.match(result.reason, /capacity/);
});

test('open under capacity and within an unrestricted window', async () => {
  const result = await registrationWindowStatus(null, { ...baseEvent, registration_capacity: 5 }, 2);
  assert.deepEqual(result, { open: true, reason: null });
});

test('open when there is no capacity or window restriction at all', async () => {
  const result = await registrationWindowStatus(null, baseEvent, 999);
  assert.deepEqual(result, { open: true, reason: null });
});

// --- partitionRegistrations ---

test('partitions registered and withdrawn attendees separately', () => {
  const result = partitionRegistrations([
    { id: 'one', status: 'registered' },
    { id: 'two', status: 'withdrawn' }
  ]);
  assert.deepEqual(result.registered.map(r => r.id), ['one']);
  assert.deepEqual(result.withdrawn.map(r => r.id), ['two']);
});
