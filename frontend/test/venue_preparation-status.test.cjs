// US-021 frontend tests for the preparation status page.
// The page's API calls are swapped for stubs (fake functions returning sample data), so no backend is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');           // reads a .vue file
const { compile, createSSRApp } = require('vue');
const { renderToString } = require('@vue/server-renderer'); // turns a Vue page into HTML text

// The page file split into its <template> and <script> parts.
const descriptor = parse(fs.readFileSync(path.join(__dirname, '../src/views/PreparationStatusView.vue'), 'utf8')).descriptor;

// Loads the page's code with our stubs in place of the real API functions.
function instance(api) {
  const script = descriptor.script.content
    .replace(/import .*\r?\n/g, '')         // drop the real imports...
    .replace('export default', 'return');
  // ...and pass our stubs in under the same names the page uses.
  const options = new Function('fetchPreparationBookings', 'savePreparationStatus', script)(api.list, api.save);
  const state = { ...options.data() };      // the page's data (rows, error, ...)
  for (const [name, method] of Object.entries(options.methods)) state[name] = method.bind(state); // so `this` works in methods
  return state;
}
// Renders the page to HTML so we can check what the user would see.
const render = (state) => renderToString(createSSRApp({ render: compile(descriptor.template.content), data: () => state }));

// Two venues of one event. Times are UTC: 01:00Z = 9:00 AM and 04:00Z = 12:00 PM in Singapore.
const sampleRows = () => [
  { id: 'b1', event_title: 'Gala', venue_name: 'Hall A', start_time: '2099-03-01T01:00:00Z', end_time: '2099-03-01T04:00:00Z', preparation_status: 'not_started' },
  { id: 'b2', event_title: 'Gala', venue_name: 'Hall B', start_time: '2099-03-01T01:00:00Z', end_time: '2099-03-01T04:00:00Z', preparation_status: 'ready' }
];

test('[FE-01] the page shows one row per venue with event, venue, date, time and status (AC1)', async () => {
  const page = instance({ list: async () => sampleRows(), save: async () => ({}) }); // stubs: list returns the sample rows
  await page.load();                     // what the page does when it opens
  const html = await render(page);
  for (const text of ['Gala', 'Hall A', 'Hall B', '1 Mar 2099', '9:00 AM – 12:00 PM', 'Not Started', 'Ready']) {
    assert.ok(html.includes(text), text); // the text after the comma names the missing value if it fails
  }
});

test('[FE-02] if saving fails, an error shows and the old status stays (AC6)', async () => {
  const page = instance({
    list: async () => sampleRows(),
    save: async () => { throw new Error('Unable to save preparation status. Please retry.') } // stub: saving always fails
  });
  await page.load();
  const row = page.rows[0];                // Hall A, currently Not Started
  row.selected = 'in_progress';            // user picks In Progress in the dropdown

  await page.save(row);                    // user clicks Save
  assert.equal(page.error, 'Unable to save preparation status. Please retry.'); // error shown
  assert.equal(row.preparation_status, 'not_started');                          // old status kept
});