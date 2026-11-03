// US-030 - Withdraw Registration: pure eligibility-check unit tests.
// SQL/HTTP wiring remains covered by the integration tests in
// test/integration/registrations.test.js; this isolates the two rules
// that decide whether a withdrawal is allowed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertRegistrationWithdrawable } = require('../../src/registrations');

test('[UT-01] assertRegistrationWithdrawable allows an active registration on a future event', () => {
  const registration = { status: 'registered', preferred_start: '2099-03-01T10:00:00+08:00' };
  assert.equal(assertRegistrationWithdrawable(registration), true);
});

test('[UT-02] assertRegistrationWithdrawable allows an active registration with no recorded start time', () => {
  const registration = { status: 'registered', preferred_start: null };
  assert.equal(assertRegistrationWithdrawable(registration), true);
});

test('[UT-03] assertRegistrationWithdrawable rejects an already-withdrawn registration (AC-030-004)', () => {
  const registration = { status: 'withdrawn', preferred_start: '2099-03-01T10:00:00+08:00' };
  assert.throws(
    () => assertRegistrationWithdrawable(registration),
    { status: 409, message: 'This registration has already been withdrawn.' }
  );
});

test('[UT-04] assertRegistrationWithdrawable rejects once the event has started (AC-030-002)', () => {
  const registration = { status: 'registered', preferred_start: '2020-01-01T10:00:00+08:00' };
  assert.throws(
    () => assertRegistrationWithdrawable(registration),
    { status: 409, message: 'Withdrawal is not permitted once the event has started.' }
  );
});

test('[UT-05] assertRegistrationWithdrawable treats an event starting exactly now as already started', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const registration = { status: 'registered', preferred_start: now.toISOString() };
  assert.throws(
    () => assertRegistrationWithdrawable(registration, now),
    { status: 409, message: 'Withdrawal is not permitted once the event has started.' }
  );
});

test('[UT-06] assertRegistrationWithdrawable allows a moment before the event starts', () => {
  const now = new Date('2026-06-01T11:59:59Z');
  const start = new Date('2026-06-01T12:00:00Z');
  const registration = { status: 'registered', preferred_start: start.toISOString() };
  assert.equal(assertRegistrationWithdrawable(registration, now), true);
});

test('[UT-07] assertRegistrationWithdrawable checks status before the start-time rule', () => {
  // An already-withdrawn registration for a past event should still report
  // "already withdrawn", not "event has started" - the status check comes first.
  const registration = { status: 'withdrawn', preferred_start: '2020-01-01T10:00:00+08:00' };
  assert.throws(
    () => assertRegistrationWithdrawable(registration),
    { message: 'This registration has already been withdrawn.' }
  );
});
