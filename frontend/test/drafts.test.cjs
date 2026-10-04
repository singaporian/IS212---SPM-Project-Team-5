const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');

function formInstance(request, id) {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/EventRequestForm.vue'), 'utf8');
  const script = parse(source).descriptor.script.content
    .replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function('draftRequest', script)(request);
  const instance = { $route: { params: id ? { id } : {} }, $options: options };
  instance.$nextTick = async () => {};
  instance.$el = { querySelector: () => null };
  instance.$router = { async replace(route) { instance.$route.params = route.params } };
  Object.assign(instance, options.data.call(instance));
  for (const [name, method] of Object.entries(options.methods)) instance[name] = method.bind(instance);
  for (const [name, get] of Object.entries(options.computed)) Object.defineProperty(instance, name, { get: get.bind(instance) });
  return instance;
}

// Lark: US-006-001, US-006-002, US-006-006.
test('direct submit sends current unsaved form without a separate save', async () => {
  for (const existing of [false, true]) {
    const calls = [];
    const instance = formInstance(async (url, options) => { calls.push({url, ...options}); return { status: 'submitted' }; }, existing ? 'saved-id' : undefined);
    instance.savedVersion = existing ? 'a'.repeat(32) : '';
    instance.form.eventName = 'Current unsaved title';
    instance.form.expectedAttendance = '1';
    await instance.submitForReview();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    const body = JSON.parse(calls[0].body);
    assert.deepEqual(body.draft, instance.form);
    assert.equal(body.version, existing ? 'a'.repeat(32) : null);
    assert.equal(instance.submitted, true);
  }
});

// Lark: US-006-003 through US-006-006; backend tests verify the actual validation rules.
test('submission validation errors preserve input and expose corrective messages', async () => {
  for (const field of ['eventName', 'startDate', 'startTime', 'endDate', 'endTime', 'expectedAttendance']) {
  const fields = { [field]: 'Correct this field.' };
  const instance = formInstance(async (url, options) => {
    if (!options) return { version: 'a'.repeat(32), draft_data: { eventName: 'Test', expectedAttendance: 'none' } };
    throw Object.assign(new Error('Correct the listed fields.'), { fields, status: 422 });
  }, 'saved-id');
  await instance.loadDraft();
  instance.form[field] = '';
  instance.form.purpose = 'Keep my current input';
  const before = structuredClone(instance.form);
  await instance.submitForReview();
  assert.deepEqual(instance.form, before);
  assert.deepEqual(instance.submitFields, fields);
  assert.equal(instance.submitted, false);
  assert.equal(instance.submitting, false);
  assert.equal(instance.fieldError(field), fields[field]);
  }
});

test('submission failure allows retry with same version and redirects on success', async () => {
  const calls = [];
  let route;
  const instance = formInstance(async (url, options) => {
    if (!options) return { version: 'b'.repeat(32), draft_data: { eventName: 'Ready' } };
    calls.push({ url, body: JSON.parse(options.body) });
    if (calls.length === 1) throw new Error('Connection lost');
    return { status: 'submitted' };
  }, 'saved-id');
  instance.$router.replace = async value => { route = value };
  await instance.loadDraft();
  await instance.submitForReview();
  assert.match(instance.submitError, /Connection lost/);
  assert.equal(instance.form.eventName, 'Ready');
  await instance.submitForReview();
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[1].body, { version: 'b'.repeat(32), draft: instance.form });
  assert.equal(instance.submitted, true);
  assert.equal(route.name, 'submitted-event-request');
  assert.equal(route.params.id, 'saved-id');
});

test('in-flight submission prevents duplicate submissions and saves', async () => {
  let finish, calls = 0;
  const instance = formInstance(async (url, options) => {
    if (!options) return { version: 'c'.repeat(32), draft_data: {} };
    calls++;
    return new Promise(resolve => { finish = resolve });
  }, 'saved-id');
  await instance.loadDraft();
  const pending = instance.submitForReview();
  await instance.submitForReview();
  await instance.saveDraft();
  assert.equal(calls, 1);
  finish({ status: 'submitted' });
  await pending;
  await instance.submitForReview();
  await instance.saveDraft();
  assert.equal(calls, 1);
});

test('stale submission is rejected without false success or lost input', async () => {
  const instance = formInstance(async (url, options) => {
    if (!options) return { version: 'd'.repeat(32), draft_data: { purpose: 'Keep me' } };
    throw Object.assign(new Error('This draft was changed elsewhere. Reopen it.'), { status: 409 });
  }, 'saved-id');
  await instance.loadDraft();
  await instance.submitForReview();
  assert.equal(instance.submitted, false);
  assert.equal(instance.form.purpose, 'Keep me');
  assert.match(instance.submitError, /changed elsewhere/);
});

test('a late save response cannot enable submission for a different draft', async () => {
  let finish;
  const instance = formInstance(() => new Promise(resolve => { finish = resolve }), 'first-id');
  const pending = instance.saveDraft();
  instance.draftId = 'second-id';
  instance.savedVersion = 'current-version';
  instance.savedForm = 'current-snapshot';
  finish({ version: 'old-version' });
  await pending;
  assert.equal(instance.savedVersion, 'current-version');
  assert.equal(instance.savedForm, 'current-snapshot');
});

test('save failures retain all input and retry uses the same draft ID', async () => {
  const calls = [];
  const instance = formInstance(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new Error('Connection lost');
    return {};
  });
  Object.assign(instance.form, { purpose: 'Plan later', startTime: '11:05', expectedAttendance: 'none' });
  const before = structuredClone(instance.form);
  await instance.saveDraft();
  assert.deepEqual(instance.form, before);
  assert.match(instance.saveError, /Connection lost/);
  assert.equal(instance.saving, false);
  await instance.saveDraft();
  assert.equal(calls[0].url, calls[1].url);
  assert.deepEqual(JSON.parse(calls[1].options.body), before);
  assert.match(instance.saveMessage, /saved successfully/);
  assert.equal(instance.$route.params.id, instance.draftId);
});

test('reopening a draft restores every corresponding field', async () => {
  const stored = { eventName: 'Sample', startDate: '2099-01-01', startTime: '', endDate: '',
    endTime: '12:00', expectedAttendance: ' not decided ', purpose: 'Purpose', description: 'Description',
    venueRequirements: 'Theatre', accessibilityNeeds: 'Ramp', equipmentRequirements: 'none', registrationNeeds: 'no' };
  const instance = formInstance(async () => ({ draft_data: stored }), 'saved-id');
  await instance.loadDraft();
  assert.deepEqual(instance.form, stored);
  assert.equal(instance.loadError, '');
});

test('invalid attendance blocks save and retains input', async () => {
  let called = false;
  const instance = formInstance(async () => { called = true });
  instance.form.expectedAttendance = '1.5';
  await instance.saveDraft();
  assert.equal(called, false);
  assert.equal(instance.form.expectedAttendance, '1.5');
  assert.match(instance.saveError, /whole number/);
});

test('concurrent clicks cannot send duplicate saves', async () => {
  let finish, calls = 0;
  const instance = formInstance(() => { calls++; return new Promise(resolve => { finish = resolve }) });
  const pending = instance.saveDraft();
  await instance.saveDraft();
  assert.equal(calls, 1);
  finish({});
  await pending;
});

test('denied draft load does not expose an editable empty form', async () => {
  const instance = formInstance(async () => { throw new Error('Draft not found.') }, 'other-id');
  await instance.loadDraft();
  assert.equal(instance.loadError, 'Draft not found.');
  assert.equal(instance.loading, false);
});

test('a late response from another draft cannot replace the current form', async () => {
  let finish;
  const instance = formInstance(() => new Promise(resolve => { finish = resolve }), 'first-id');
  const pending = instance.loadDraft();
  instance.draftId = 'second-id';
  instance.form.eventName = 'Current draft';
  finish({ draft_data: { eventName: 'Previous draft' } });
  await pending;
  assert.equal(instance.form.eventName, 'Current draft');
});

test('loading can be retried after a temporary failure', async () => {
  let calls = 0;
  const instance = formInstance(async () => {
    if (++calls === 1) throw new Error('Temporary outage');
    return { draft_data: { eventName: 'Recovered draft' } };
  }, 'saved-id');
  await instance.loadDraft();
  assert.equal(instance.loadError, 'Temporary outage');
  await instance.loadDraft();
  assert.equal(instance.loadError, '');
  assert.equal(instance.form.eventName, 'Recovered draft');
});

test('expired-session save error keeps unsaved input available', async () => {
  const instance = formInstance(async () => { throw new Error('Your session has expired.') });
  instance.form.purpose = 'Unsaved work';
  await instance.saveDraft();
  assert.match(instance.saveError, /session has expired/);
  assert.equal(instance.form.purpose, 'Unsaved work');
  assert.equal(instance.saving, false);
});

test('valid complete future date/time pairs save while reversed times are rejected', async () => {
  let calls = 0;
  const instance = formInstance(async () => { calls++; return {} });
  Object.assign(instance.form, { startDate: '2099-01-01', startTime: '10:00', endDate: '2099-01-01', endTime: '11:00' });
  await instance.saveDraft();
  assert.equal(calls, 1);
  instance.form.endTime = '09:00';
  await instance.saveDraft();
  assert.equal(calls, 1);
  assert.match(instance.saveError, /later than the start/);
});

// Organiser five-minute timing regression; DEF-001 ordering retained.
test('DEF-001 interval errors mark only the responsible end field and allow overnight times', async () => {
  const { createSSRApp, compile } = require('vue');
  const { renderToString } = require('@vue/server-renderer');
  const template = parse(fs.readFileSync(path.join(__dirname, '../src/components/EventRequestForm.vue'), 'utf8')).descriptor.template.content;
  async function assertRenderedFields(instance, invalidField) {
    const app = createSSRApp({ render: compile(template), data: () => instance });
    app.config.globalProperties.$route = instance.$route;
    app.component('router-link', { template: '<a><slot /></a>' });
    const html = await renderToString(app);
    for (const field of ['endDate', 'endTime']) {
      const input = html.match(new RegExp('<(?:input|select)[^>]*id="' + field + '"[^>]*>'))[0];
      assert.equal(input.includes('is-invalid'), field === invalidField);
      assert.equal(input.includes('aria-invalid="true"'), field === invalidField);
      assert.equal(html.includes('id="' + field + '-error"'), field === invalidField);
    }
    if (invalidField) assert.ok(html.includes(instance.fieldError(invalidField)));
  }
  let calls = 0;
  const instance = formInstance(async () => { calls++; return {} });
  Object.assign(instance.form, { startDate: '2026-10-15', startTime: '10:05', endDate: '2026-10-14', endTime: '10:10' });
  assert.equal(instance.fieldError('endDate'), 'End date must not be earlier than the start date.');
  assert.equal(instance.fieldError('endTime'), '');
  await assertRenderedFields(instance, 'endDate');
  await instance.saveDraft();
  assert.equal(calls, 0);
  instance.form.endDate = '2026-10-15';
  for (const time of ['10:05', '10:00']) {
    instance.form.endTime = time;
    assert.equal(instance.fieldError('endDate'), '');
    assert.equal(instance.fieldError('endTime'), 'End time must be later than the start time.');
    await assertRenderedFields(instance, 'endTime');
    await instance.saveDraft();
    assert.equal(calls, 0);
  }
  instance.form.endDate = '2026-10-16';
  instance.form.endTime = '00:05';
  assert.equal(instance.fieldError('endDate'), '');
  assert.equal(instance.fieldError('endTime'), '');
  await assertRenderedFields(instance, '');
  await instance.saveDraft();
  assert.equal(calls, 1);
});

test('valid historical dates can be saved with or without a time', async () => {
  let calls = 0;
  const instance = formInstance(async () => { calls++; return {} });
  instance.form.startDate = '2000-01-01';
  await instance.saveDraft();
  assert.equal(calls, 1);
  Object.assign(instance.form, { startTime: '10:00', endDate: '2000-01-01', endTime: '11:00' });
  await instance.saveDraft();
  assert.equal(calls, 2);
  assert.equal(instance.saveError, '');
});

test('field errors appear against their inputs and clear when edited', async () => {
  const fields = { eventName: 'Enter a name.', expectedAttendance: 'Enter positive attendance.' };
  const instance = formInstance(async () => { throw Object.assign(new Error('Correct fields.'), { fields: { ...fields } }); }, 'saved-id');
  instance.savedVersion = 'saved';
  instance.savedForm = JSON.stringify(instance.form);
  await instance.submitForReview();
  assert.equal(instance.fieldError('eventName'), fields.eventName);
  assert.equal(instance.fieldError('expectedAttendance'), fields.expectedAttendance);
  instance.clearFieldError('eventName');
  assert.equal(instance.fieldError('eventName'), '');
  assert.equal(instance.fieldError('expectedAttendance'), fields.expectedAttendance);
});

test('draft API field errors are associated with inputs without losing form values', async () => {
  const instance = formInstance(async () => { throw Object.assign(new Error('Enter a valid date.'), { fields: { startDate: 'Enter a valid date.' } }); });
  instance.form.purpose = 'Keep this purpose';
  await instance.saveDraft();
  assert.equal(instance.fieldError('startDate'), 'Enter a valid date.');
  assert.equal(instance.form.purpose, 'Keep this purpose');
  instance.clearFieldError('startDate');
  assert.equal(instance.fieldError('startDate'), '');
});

test('validation failures focus and scroll the first invalid control after re-enabling the form', async () => {
  for (const mode of ['local', 'save', 'submit']) {
    const instance = formInstance(async () => {
      throw Object.assign(new Error('Correct fields.'), { fields: { eventName: 'Enter a name.' } });
    }, 'saved-id');
    const actions = [];
    instance.$nextTick = async () => {
      assert.equal(instance.saving, false);
      assert.equal(instance.submitting, false);
      actions.push('render');
    };
    instance.$el.querySelector = selector => {
      assert.match(selector, /aria-invalid="true"/);
      return {
        focus(options) { assert.equal(options.preventScroll, true); actions.push('focus'); },
        scrollIntoView(options) { assert.equal(options.block, 'center'); actions.push('scroll'); }
      };
    };
    if (mode === 'local') instance.form.expectedAttendance = '-1';
    if (mode === 'submit') {
      instance.savedVersion = 'saved';
      instance.savedForm = JSON.stringify(instance.form);
      await instance.submitForReview();
    } else await instance.saveDraft();
    assert.deepEqual(actions, ['render', 'focus', 'scroll']);
  }
});

// Organiser five-minute timing regression; DEF-001 ordering retained.
test('organiser form uses five-minute selections and preserves saved values', async () => {
  const { compile } = require('vue');
  const { renderToString } = require('@vue/server-renderer');
  const { createSSRApp } = require('vue');
  let saved;
  const instance = formInstance(async (url, options) => { saved = JSON.parse(options.body); return { version: 'saved' }; }, 'saved-id');
  Object.assign(instance.form, { startDate: '2026-10-01', endDate: '2026-10-01', startTime: '10:05', endTime: '10:10' });
  await instance.saveDraft();
  assert.equal(saved.startTime, '10:05');
  assert.equal(saved.endTime, '10:10');
  instance.form.endTime = '23:55';
  await instance.saveDraft();
  assert.equal(saved.endTime, '23:55');
  const source = fs.readFileSync(path.join(__dirname, '../src/components/EventRequestForm.vue'), 'utf8');
  const app = createSSRApp({ render: compile(parse(source).descriptor.template.content), data: () => instance });
  app.config.globalProperties.$route = instance.$route;
  app.component('router-link', { template: '<a><slot /></a>' });
  const html = await renderToString(app);
  assert.match(html, /<select[^>]*id="startTime"/);
  assert.ok(html.includes('value="23:55"'));
  assert.ok(!html.includes('value="10:03"'));
  assert.match(html, /<select[^>]*id="endTime"/);
});

// Lark: US-006-001, US-006-002, US-006-006 (rendered submission confirmation).
test('US-006 successful POST retains rendered confirmation after receipt GET failure and retries only GET', async () => {
  const { createSSRApp, compile } = require('vue');
  const { renderToString } = require('@vue/server-renderer');
  let postCount = 0, route;
  const form = formInstance(async () => { postCount++; return { status: 'submitted' }; }, 'saved-id');
  form.savedVersion = 'saved';
  form.savedForm = JSON.stringify(form.form);
  form.$router.replace = async value => { route = value; };
  await form.submitForReview();
  assert.equal(postCount, 1);
  const source = fs.readFileSync(path.join(__dirname, '../src/views/SubmittedRequestsView.vue'), 'utf8');
  const descriptor = parse(source).descriptor;
  const script = descriptor.script.content.replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');
  const calls = [];
    const options = new Function('fetch', 'authHeaders', 'RequestNavigation', 'canRequestChanges', script)(async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    return Response.json({ error: 'Unable to load details.' }, { status: 500 });
  }, () => ({}), { template: '<nav />' }, status => ['planning', 'confirmed'].includes(status));
  const receipt = { ...options.data(), $route: { ...route, path: '/requests/submitted/saved-id' } };
  for (const [key, method] of Object.entries(options.methods)) receipt[key] = method.bind(receipt);
  await receipt.load();
  await receipt.load();
  const app = createSSRApp({ render: compile(descriptor.template.content), data: () => receipt });
  app.config.globalProperties.$route = receipt.$route;
  app.component('RequestNavigation', { template: '<nav />' });
  app.component('router-link', { template: '<a><slot /></a>' });
  const html = await renderToString(app);
  assert.match(html, /Your request has been submitted successfully/);
  assert.match(html, /Unable to load details/);
  assert.match(html, /Retry/);
  assert.equal(postCount, 1);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET']);
  assert.ok(calls.every(call => call.url === '/api/requests/saved-id'));
});

// Lark: US-006-004, US-006-005.
test('attendance draft placeholders remain allowed and malformed input uses concise guidance', async () => {
  const saved = [];
  const instance = formInstance(async (url, options) => {
    saved.push(JSON.parse(options.body)); return { version: 'saved' };
  }, 'saved-id');
  for (const value of ['Not decided', '']) {
    instance.form.expectedAttendance = value;
    await instance.saveDraft();
    assert.equal(saved.at(-1).expectedAttendance, value);
    assert.equal(instance.attendanceError, '');
  }
  for (const value of ['abc', '1.5', '-1']) {
    instance.form.expectedAttendance = value;
    assert.equal(instance.attendanceError, 'Enter a positive whole number.');
  }
});

// Lark: US-006-004, US-006-005, US-006-006.
test('submission attendance messages appear unchanged beside the field', async () => {
  for (const [value, message] of [
    ['Not decided', 'Enter a positive whole number before submitting.'],
    ['', 'Enter a positive whole number before submitting.'],
    ['0', 'Enter a positive whole number.'],
    ['abc', 'Enter a positive whole number.'],
    ['1.5', 'Enter a positive whole number.']
  ]) {
    const instance = formInstance(async () => {
      throw Object.assign(new Error('Correct fields.'), { fields: { expectedAttendance: message } });
    }, 'saved-id');
    instance.form.expectedAttendance = value;
    instance.savedVersion = 'saved';
    instance.savedForm = JSON.stringify(instance.form);
    await instance.submitForReview();
    assert.equal(instance.fieldError('expectedAttendance'), message);
    assert.equal(instance.submitted, false);
    assert.equal(instance.form.expectedAttendance, value);
  }
});

test('legacy off-grid organiser draft values remain visible and require correction without silent rounding', async () => {
  let calls=0;
  const instance=formInstance(async()=>{calls++;},'saved-id');
  instance.form.startTime='10:03';
  assert.equal(instance.fieldError('startTime'),'Choose a time in five-minute intervals.');
  await instance.saveDraft();
  assert.equal(calls,0);
  assert.equal(instance.form.startTime,'10:03');
  instance.form.startTime='10:05';
  assert.equal(instance.fieldError('startTime'),'');
});
