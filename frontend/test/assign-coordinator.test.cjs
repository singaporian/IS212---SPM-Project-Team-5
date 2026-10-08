// US-034: Assign Coordinator view behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');

const ALICE = { id: 'alice', name: 'Alice', email: 'alice@test.local', active_count: 1 };
const BOB = { id: 'bob', name: 'Bob', email: 'bob@test.local', active_count: 0 };
const QUEUED = { id: 'queued', title: 'Orientation Fair', status: 'submitted', assigned_coordinator_id: null, purpose: 'Welcome students',
  preferred_start: '2099-03-01T01:00:00Z', preferred_end: '2099-03-01T08:00:00Z', expected_attendance: 180, organiser_name: 'Olive' };
const ASSIGNED = { id: 'assigned', title: 'Gala Dinner', status: 'approved', assigned_coordinator_id: 'alice', coordinator_name: 'Alice',
  preferred_start: '2099-04-01T11:00:00Z', preferred_end: '2099-04-01T15:00:00Z' };
const overview = (overrides = {}) => ({ unassigned: [QUEUED], assignments: [ASSIGNED], coordinators: [ALICE, BOB], ...overrides });

function viewInstance(api = {}) {
  const services = {
    getAssignmentOverview: async () => overview(),
    assignCoordinator: async () => ({ message: 'Saved' }),
    ...api
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/views/AssignCoordinatorView.vue'), 'utf8');
  const script = parse(source).descriptor.script.content
    .replace(/import .* from .*\r?\n/g, '').replace('export default', 'return');
  const options = new Function(...Object.keys(services), script)(...Object.values(services));
  const instance = { $refs: {}, $nextTick: fn => fn() };
  Object.assign(instance, options.data.call(instance));
  for (const [name, method] of Object.entries(options.methods)) instance[name] = method.bind(instance);
  for (const [name, get] of Object.entries(options.computed)) Object.defineProperty(instance, name, { get: get.bind(instance) });
  return instance;
}

test('the queue, coordinator workloads and active assignments load together', async () => {
  const instance = viewInstance();
  await instance.loadOverview();
  assert.equal(instance.loaded, true);
  assert.deepEqual(instance.unassigned.map(e => e.title), ['Orientation Fair']);
  assert.deepEqual(instance.assignments.map(e => e.coordinator_name), ['Alice']);
  assert.equal(instance.coordinatorOption(ALICE), 'Alice — 1 active request');
  assert.equal(instance.coordinatorOption(BOB), 'Bob — 0 active requests');
  assert.equal(instance.formatSchedule(QUEUED), 'Sun, 1 Mar 2099, 9:00 AM – 4:00 PM');
  assert.equal(instance.formatSchedule({}), 'Schedule not specified');
});

test('a load failure is shown and can be retried', async () => {
  let fail = true;
  const instance = viewInstance({ getAssignmentOverview: async () => { if (fail) throw new Error('Unable to load coordinator assignments. Please retry.'); return overview() } });
  await instance.loadOverview();
  assert.equal(instance.loaded, false);
  assert.match(instance.loadError, /Unable to load/);
  fail = false;
  await instance.loadOverview();
  assert.equal(instance.loadError, '');
  assert.equal(instance.unassigned.length, 1);
});

test('the Lead reviews a request and must choose a coordinator before it is assigned', async () => {
  const calls = [];
  const instance = viewInstance({ assignCoordinator: async (...args) => { calls.push(args); return { message: 'Assigned "Orientation Fair" to Bob.' } } });
  await instance.loadOverview();
  instance.toggleReview(QUEUED);
  assert.equal(instance.reviewingId, 'queued');
  await instance.assign(QUEUED);
  assert.equal(calls.length, 0, 'nothing is sent without a coordinator');
  assert.equal(instance.showAssignError, true);
  instance.assignTo = 'bob';
  await instance.assign(QUEUED);
  assert.deepEqual(calls, [['queued', 'bob', null]]);
  assert.equal(instance.successMessage, 'Assigned "Orientation Fair" to Bob.');
  assert.equal(instance.reviewingId, '', 'the review panel closes after assigning');
});

test('an assignment that lost a race shows a warning and refreshes the queue', async () => {
  let loads = 0;
  const instance = viewInstance({
    getAssignmentOverview: async () => (++loads === 1 ? overview() : overview({ unassigned: [] })),
    assignCoordinator: async () => { throw Object.assign(new Error('"Orientation Fair" was assigned by someone else while you were viewing it.'), { status: 409 }) }
  });
  await instance.loadOverview();
  instance.toggleReview(QUEUED);
  instance.assignTo = 'bob';
  await instance.assign(QUEUED);
  assert.match(instance.conflictMessage, /assigned by someone else/);
  assert.equal(loads, 2);
  assert.equal(instance.reviewingId, '', 'the panel for a request no longer in the queue closes');
});

test('a failed assignment keeps the Lead\'s selection so they can retry', async () => {
  const instance = viewInstance({ assignCoordinator: async () => { throw Object.assign(new Error('Unable to save the assignment.'), { status: 500 }) } });
  await instance.loadOverview();
  instance.toggleReview(QUEUED);
  instance.assignTo = 'bob';
  await instance.assign(QUEUED);
  assert.match(instance.saveError, /Your selection has been kept/);
  assert.equal(instance.reviewingId, 'queued');
  assert.equal(instance.assignTo, 'bob');
});

test('reassigning offers only other coordinators and sends the current coordinator for a stale-view check', async () => {
  const calls = [];
  const instance = viewInstance({ assignCoordinator: async (...args) => { calls.push(args); return { message: 'Reassigned.' } } });
  await instance.loadOverview();
  instance.openReassign(ASSIGNED);
  assert.deepEqual(instance.reassignOptions.map(c => c.id), ['bob']);
  await instance.confirmReassign();
  assert.equal(calls.length, 0, 'nothing is sent without a coordinator');
  instance.reassignTo = 'bob';
  await instance.confirmReassign();
  assert.deepEqual(calls, [['assigned', 'bob', 'alice']]);
  assert.equal(instance.reassigning, null);
  assert.equal(instance.successMessage, 'Reassigned.');
});

test('a failed reassignment keeps the dialog open with an error, and a conflict closes it with a warning', async () => {
  let failure = Object.assign(new Error('Unable to save the assignment.'), { status: 500 });
  const instance = viewInstance({ assignCoordinator: async () => { throw failure } });
  await instance.loadOverview();
  instance.openReassign(ASSIGNED);
  instance.reassignTo = 'bob';
  await instance.confirmReassign();
  assert.ok(instance.reassigning, 'dialog stays open');
  assert.match(instance.reassignError, /current assignment is unchanged/);
  failure = Object.assign(new Error('"Gala Dinner" was assigned by someone else.'), { status: 409 });
  await instance.confirmReassign();
  assert.equal(instance.reassigning, null);
  assert.match(instance.conflictMessage, /someone else/);
});

test('assignments can be filtered by coordinator', async () => {
  const instance = viewInstance();
  await instance.loadOverview();
  instance.toggleFilter('bob');
  assert.equal(instance.filteredAssignments.length, 0);
  instance.toggleFilter('bob');
  assert.equal(instance.filterCoordinatorId, '');
  instance.toggleFilter('alice');
  assert.deepEqual(instance.filteredAssignments.map(e => e.id), ['assigned']);
});
