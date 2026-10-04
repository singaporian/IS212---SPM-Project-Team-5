// US-010: Inform the Organiser when a requested change is major (cancel and resubmit).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { createSSRApp, compile } = require('vue');
const { renderToString } = require('@vue/server-renderer');

const canRequestChanges = status => ['planning', 'confirmed'].includes(status);
const approved = { id: 'event-1', title: 'Orientation', status: 'planning',
  draft_data: { startDate: '2099-03-01', startTime: '09:00', endTime: '12:00', expectedAttendance: '100' } };
const majorError = () => Object.assign(
  new Error("Expected Attendance changes can't be made through a change request. The event must be cancelled and resubmitted."),
  { status: 422, code: 'MAJOR_CHANGE', majorChanges: ['expectedAttendance'] });

// ---------- EventChangeRequestView ----------
const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/views/EventChangeRequestView.vue'), 'utf8')).descriptor;
const viewScript = descriptor.script.content.replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');

async function view({ submit = async () => ({}), resubmit = async () => ({ draftId: 'new-draft' }) } = {}) {
  const pushes = [];
  const options = new Function('RequestNavigation', 'canRequestChanges', 'fetchSubmittedRequest', 'submitChangeRequest', 'cancelAndResubmit', 'TIME_OPTIONS', viewScript)(
    {}, canRequestChanges, async () => structuredClone(approved), submit, resubmit, []);
  const state = { ...options.data(), $route: { params: { id: approved.id } }, $router: { push: route => pushes.push(route) } };
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state);
  for (const [name, get] of Object.entries(options.computed || {})) Object.defineProperty(state, name, { get: get.bind(state), enumerable: true });
  await state.load();
  return { state, pushes };
}

async function render(state) {
  const app = createSSRApp({ render: compile(descriptor.template.content), data: () => state });
  app.config.globalProperties.$route = state.$route;
  app.component('RequestNavigation', { template: '<nav />' });
  app.component('router-link', { template: '<a><slot /></a>' });
  return renderToString(app);
}

// AC-010-003
test('a major change shows the explanation instead of a confirmation', async () => {
  const { state } = await view({ submit: async () => { throw majorError(); } });
  state.form.expectedAttendance = '150'
  state.form.venueRequirements = 'Banquet'
  await state.submit();
  assert.equal(state.submitted, false);
  assert.equal(state.error, '', 'the explanation is not shown as a generic error');
  assert.equal(state.majorChange.message, majorError().message);
  assert.deepEqual(state.majorChange.aspects, ['expectedAttendance']);
  assert.deepEqual(state.majorChange.payload, { expectedAttendance: 150, venueLayoutPreference: 'Banquet' });
  const html = await render(state);
  assert.match(html, /This is a major change/);
  assert.match(html, /Expected Attendance changes can(&#39;|')t be made through a change request/);
  assert.match(html, /Cancel this event and resubmit/);
  assert.match(html, /Go back and edit my change/);
  assert.doesNotMatch(html, /<form/);
});

test('other errors still show as normal form errors', async () => {
  const { state } = await view({ submit: async () => { throw Object.assign(new Error('Unable to submit change request. Please retry.'), { status: 500 }); } });
  state.form.venueRequirements = 'Banquet';
  await state.submit();
  assert.equal(state.majorChange, null);
  assert.equal(state.error, 'Unable to submit change request. Please retry.');
});

// AC-010-004: cancel the change
test('"Go back" returns to the form with the input kept and nothing cancelled', async () => {
  let resubmits = 0;
  const { state } = await view({ submit: async () => { throw majorError(); }, resubmit: async () => { resubmits++; return {}; } });
  state.form.expectedAttendance = '150';
  await state.submit();
  state.backToForm();
  assert.equal(state.majorChange, null);
  assert.equal(state.form.expectedAttendance, '150');
  assert.equal(resubmits, 0);
  assert.match(await render(state), /<form/);
});

// AC-010-004: proceed
test('"Cancel this event and resubmit" sends the same changes and opens the new draft', async () => {
  const calls = [];
  const { state, pushes } = await view({
    submit: async () => { throw majorError(); },
    resubmit: async (id, changes) => { calls.push({ id, changes }); return { cancelledEventId: id, draftId: 'new-draft' }; }
  });
  state.form.expectedAttendance = '150';
  await state.submit();
  await state.confirmResubmit();
  assert.deepEqual(calls, [{ id: 'event-1', changes: { expectedAttendance: 150 } }]);
  assert.deepEqual(pushes, [{ name: 'edit-event-draft', params: { id: 'new-draft' } }]);
  assert.equal(state.resubmitting, false);
});

test('a failed cancel-and-resubmit keeps the panel open with the error, and double clicks send once', async () => {
  let calls = 0, release;
  const { state, pushes } = await view({
    submit: async () => { throw majorError(); },
    resubmit: () => { calls++; return new Promise((resolve, reject) => { release = reject; }); }
  });
  state.form.expectedAttendance = '150';
  await state.submit();
  const first = state.confirmResubmit();
  await state.confirmResubmit();
  release(new Error('Unable to cancel and resubmit. Nothing was changed. Please retry.'));
  await first;
  assert.equal(calls, 1);
  assert.deepEqual(pushes, []);
  assert.ok(state.majorChange, 'panel still open');
  assert.equal(state.error, 'Unable to cancel and resubmit. Nothing was changed. Please retry.');
  assert.match(await render(state), /Nothing was changed\. Please retry\./);
});

// ---------- services/changeRequests.js ----------
function service(fetch) {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/changeRequests.js'), 'utf8')
    .replace(/import .* from .*\r?\n/g, '').replace(/^export /gm, '');
  return new Function('authHeaders', 'fetch', `${source}\nreturn { submitChangeRequest, cancelAndResubmit };`)(() => ({ Authorization: 'Bearer t' }), fetch);
}
const reply = (status, body) => async () => ({ status, ok: status < 400, json: async () => body });

test('submitChangeRequest passes the MAJOR_CHANGE code and aspects to the view', async () => {
  const { submitChangeRequest } = service(reply(422, { error: 'Major.', code: 'MAJOR_CHANGE', majorChanges: ['duration'] }));
  await assert.rejects(submitChangeRequest('e', {}), error =>
    error.message === 'Major.' && error.code === 'MAJOR_CHANGE' && error.status === 422 && error.majorChanges[0] === 'duration');
});

test('cancelAndResubmit posts to the new endpoint and reports errors', async () => {
  const calls = [];
  const { cancelAndResubmit } = service(async (url, options) => {
    calls.push({ url, options });
    return { status: 201, ok: true, json: async () => ({ draftId: 'd' }) };
  });
  assert.deepEqual(await cancelAndResubmit('e-1', { expectedAttendance: 150 }), { draftId: 'd' });
  assert.equal(calls[0].url, '/api/events/e-1/cancel-and-resubmit');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, JSON.stringify({ expectedAttendance: 150 }));

  await assert.rejects(service(reply(409, { error: 'Only approved events can be cancelled and resubmitted.' })).cancelAndResubmit('e', {}),
    /Only approved events can be cancelled and resubmitted\./);
  await assert.rejects(service(reply(401, {})).cancelAndResubmit('e', {}), /Your session has expired/);
});