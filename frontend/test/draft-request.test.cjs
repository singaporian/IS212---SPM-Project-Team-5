const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/services/drafts.js'), 'utf8')
  .replace(/import .*\r?\n/, '').replace('export async function', 'async function');
const requestWith = fetch => new Function('fetch', 'authHeaders', source + '\nreturn draftRequest;')(fetch, () => ({}));

test('empty proxy failures and malformed successful responses produce readable errors', async () => {
  for (const [status, body, message] of [[500, '', /temporarily unavailable/], [200, '<html>error</html>', /unexpected response/], [200, 'null', /unexpected response/]]) {
    const request = requestWith(async () => new Response(body, { status }));
    await assert.rejects(request(), error => message.test(error.message) && error.status === status);
  }
});

test('network failures produce a connection message', async () => {
  await assert.rejects(requestWith(async () => { throw new TypeError('Failed to fetch'); })(), /Unable to reach the server/);
});

test('valid responses and field validation errors retain their data', async () => {
  const saved = { id: 'draft', version: 'version' };
  assert.deepEqual(await requestWith(async () => Response.json(saved))(), saved);
  const fields = { eventName: 'Enter a name.' };
  await assert.rejects(requestWith(async () => Response.json({ error: 'Correct fields.', fields }, { status: 422 }))(),
    error => error.status === 422 && error.message === 'Correct fields.' && error.fields.eventName === fields.eventName);
  await assert.rejects(requestWith(async () => Response.json({ error: 'Enter a valid date.', field: 'startDate' }, { status: 400 }))(),
    error => error.field === 'startDate' && error.fields.startDate === 'Enter a valid date.');
});
