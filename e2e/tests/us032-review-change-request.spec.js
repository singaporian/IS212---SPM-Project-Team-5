// US-032: Review and Process a Change Request — end-to-end journeys in a real browser.
// Test case IDs match docs/testing/US-032-test-plan.md.
const { test, expect } = require('@playwright/test');
const { pool, createFixtures } = require('../support/db');

let fx, organiser, coordA, coordB;

test.beforeEach(async () => {
  fx = createFixtures();
  organiser = await fx.user('event_organiser', 'organiser');
  coordA = await fx.user('event_coordinator', 'coord-a');
  coordB = await fx.user('event_coordinator', 'coord-b');
});
test.afterEach(async () => fx.cleanup());
test.afterAll(async () => pool.end());

async function signIn(page, account) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

async function openChangeRequests(page) {
  await page.getByRole('link', { name: 'Review Change Requests' }).click();
  await expect(page).toHaveURL('/coordinator/change-requests');
}

const card = (page, title) => page.locator('article', { hasText: title });

test('TC-US032-E2E-01 AC1 AC2 AC4 AC5: approve a date/time move and see which arrangements to reconsider', async ({ page }) => {
  const event = await fx.event({ title: 'Orientation', organiser, coordinator: coordA });
  const arranged = await fx.arrangements(event, coordA);
  const crId = await fx.changeRequest(event, organiser, {
    preferredStart: fx.sgt('2099-03-05', '14:00'), preferredEnd: fx.sgt('2099-03-05', '17:00')
  });

  await signIn(page, coordA);
  await openChangeRequests(page);

  const request = card(page, event.title);
  await expect(request).toContainText('Date & time');
  await expect(request).toContainText('1 Mar 2099, 9:00 AM – 12:00 PM'); // current
  await expect(request).toContainText('5 Mar 2099, 2:00 PM – 5:00 PM');  // proposed

  await request.getByRole('button', { name: 'Approve' }).click();

  const status = page.getByRole('status');
  await expect(status).toContainText(`Change request for ${event.title} approved.`);
  await expect(status).toContainText(`${arranged.venueName} booking`);
  await expect(status).toContainText(`2 × ${arranged.equipmentName}`);
  await expect(card(page, event.title)).toHaveCount(0);

  const saved = await fx.row('SELECT preferred_start, preferred_end FROM events WHERE id = $1', [event.id]);
  expect(saved.preferred_start.toISOString()).toBe(fx.sgt('2099-03-05', '14:00'));
  expect((await fx.row('SELECT status FROM event_change_requests WHERE id = $1', [crId])).status).toBe('approved');
  const booking = await fx.row('SELECT status, requires_reconsideration FROM bookings WHERE id = $1', [arranged.bookingId]);
  expect(booking).toEqual({ status: 'confirmed', requires_reconsideration: true });
  const reservation = await fx.row('SELECT quantity, requires_reconsideration FROM equipment_reservations WHERE id = $1', [arranged.reservationId]);
  expect(reservation).toEqual({ quantity: 2, requires_reconsideration: true });
});

test('TC-US032-E2E-02 AC2 AC3: reject a change and the event stays as it was', async ({ page }) => {
  const event = await fx.event({ title: 'Workshop', organiser, coordinator: coordA });
  const crId = await fx.changeRequest(event, organiser, { venueLayoutPreference: 'Classroom' });

  await signIn(page, coordA);
  await openChangeRequests(page);
  const request = card(page, event.title);
  await expect(request).toContainText('Theatre');
  await expect(request).toContainText('Classroom');
  await request.getByRole('button', { name: 'Reject' }).click();

  await expect(page.getByRole('status')).toHaveText(`Change request for ${event.title} rejected. The event is unchanged.`);
  await expect(card(page, event.title)).toHaveCount(0);
  expect((await fx.row('SELECT venue_layout_preference FROM events WHERE id = $1', [event.id])).venue_layout_preference).toBe('Theatre');
  expect((await fx.row('SELECT status FROM event_change_requests WHERE id = $1', [crId])).status).toBe('rejected');
});

test('TC-US032-E2E-03 AC7: a failed save shows an error, keeps the request, and retry succeeds once', async ({ page }) => {
  const event = await fx.event({ title: 'Seminar', organiser, coordinator: coordA });
  const crId = await fx.changeRequest(event, organiser, { venueLayoutPreference: 'Banquet' });

  await signIn(page, coordA);
  await openChangeRequests(page);

  let failNext = true;
  await page.route('**/api/events/change-requests/*/decision', async (route) => {
    if (!failNext) return route.continue();
    failNext = false;
    return route.fulfill({ status: 500, json: { error: 'Unable to save your decision. Nothing was changed. Please retry.' } });
  });

  const request = card(page, event.title);
  await request.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert')).toHaveText('Unable to save your decision. Nothing was changed. Please retry.');
  await expect(request).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect((await fx.row('SELECT status FROM event_change_requests WHERE id = $1', [crId])).status).toBe('pending');

  await request.getByRole('button', { name: 'Retry approve' }).click();
  await expect(page.getByRole('status')).toContainText(`Change request for ${event.title} approved.`);
  await expect(card(page, event.title)).toHaveCount(0);
  expect((await fx.row('SELECT status FROM event_change_requests WHERE id = $1', [crId])).status).toBe('approved');
  expect((await fx.row('SELECT venue_layout_preference FROM events WHERE id = $1', [event.id])).venue_layout_preference).toBe('Banquet');
});

test("TC-US032-E2E-04 AC1: a coordinator does not see change requests for other coordinators' events", async ({ page }) => {
  const event = await fx.event({ title: 'Gala', organiser, coordinator: coordA });
  await fx.changeRequest(event, organiser, { venueLayoutPreference: 'Banquet' });

  await signIn(page, coordB);
  await openChangeRequests(page);
  await expect(page.getByRole('heading', { name: 'Change Requests' })).toBeVisible();
  await expect(card(page, event.title)).toHaveCount(0);
});
