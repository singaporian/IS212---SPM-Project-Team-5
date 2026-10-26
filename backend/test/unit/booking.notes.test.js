const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNoteText, ownsNote } = require('../../src/bookingNotes');

test('[UT-01] validateNoteText accepts free text and trims outer whitespace', () => {
  assert.equal(validateNoteText('  Keep ramp clear.\nUse rear entrance.  '), 'Keep ramp clear.\nUse rear entrance.');
});
test('[UT-02] validateNoteText rejects missing or non-text notes', () => {
  for (const value of [undefined, null, 4, {}, '']) assert.throws(() => validateNoteText(value), { status: 400 });
});
test('[UT-03] validateNoteText rejects whitespace-only notes', () => {
  assert.throws(() => validateNoteText(' \t\r\n '), { status: 400, message: 'Enter a note.' });
});
test('[UT-04] ownsNote permits the recorded creator', () => {
  assert.equal(ownsNote({ created_by: 'staff-one' }, 'staff-one'), true);
});
test('[UT-05] ownsNote refuses another user or missing attribution', () => {
  assert.equal(ownsNote({ created_by: 'staff-one' }, 'staff-two'), false);
  assert.equal(ownsNote({}, undefined), false);
  assert.equal(ownsNote(null, 'staff-one'), false);
});
test('[UT-06] validateNoteText preserves the existing 10,000-character boundary', () => {
  assert.equal(validateNoteText('a'.repeat(10000)).length, 10000);
  assert.throws(() => validateNoteText('a'.repeat(10001)), { status: 400 });
});
