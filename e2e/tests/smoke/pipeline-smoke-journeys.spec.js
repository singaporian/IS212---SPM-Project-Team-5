const { test, expect } = require('@playwright/test');
const { createFixtures } = require('../../support/db');

let fx;

test.beforeEach(async () => {
  fx = createFixtures();
});

test.afterEach(async () => {
  await fx.cleanup();
});

async function signIn(page, account) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

async function switchUser(page, account) {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await signIn(page, account);
}

async function submitOrganiserRequest(page, title) {
  await page.goto('/requests/new');
  await page.getByLabel('Event Name').fill(title);
  await page.getByLabel('Start Date').fill('2099-04-10');
  await page.getByLabel('Start Time').selectOption('09:00');
  await page.getByLabel('End Date').fill('2099-04-10');
  await page.getByLabel('End Time').selectOption('12:00');
  await page.getByLabel('Expected Attendance').fill('120');
  await page.getByLabel('Purpose').fill('Pipeline smoke journey');
  await page.getByLabel('Description').fill('Cross-role smoke test request.');
  await page.getByLabel('Venue Requirements').fill('Theatre layout');
  await page.getByLabel('Equipment Requirements').fill('Projector');
  await page.getByLabel('Registration Needs').selectOption('yes');
  await page.getByRole('button', { name: 'Submit for Review' }).click();
  await expect(page).toHaveURL(/submitted=1/);
  await expect(page.getByText('Your request has been submitted successfully')).toBeVisible();
}

test('@smoke [SMOKE-01] complete happy path across all roles', async ({ page }) => {
  const organiser = await fx.user('event_organiser', 'smoke-org');
  const coordinatorLead = await fx.user('event_coordinator_lead', 'smoke-lead');
  const coordinator = await fx.user('event_coordinator', 'smoke-coord');
  const venueStaff = await fx.user('venue_staff', 'smoke-venue');
  const techSupport = await fx.user('technical_support_staff', 'smoke-tech');
  const safetyOfficer = await fx.user('safety_officer', 'smoke-safety');
  const attendee = await fx.user('attendee', 'smoke-attendee');
  const venue = await fx.venue('Happy Hall');
  const equipment = await fx.equipment('Happy Projector', 12);
  const title = `E2E Smoke Happy ${fx.run}`;

  await signIn(page, organiser);
  await submitOrganiserRequest(page, title);

  const event = await fx.row(
    'SELECT id, registration_required FROM events WHERE title = $1',
    [title]
  );
  expect(event).toBeTruthy();
  fx.trackEvent(event.id);
  expect(event.registration_required).toBe(true);

  await switchUser(page, coordinatorLead);
  await page.goto('/coordinator-lead/assignments');
  const queueItem = page.locator('li.queue-item', { hasText: title });
  await queueItem.getByRole('button', { name: 'Review & assign' }).click();
  await queueItem.getByLabel('Assign to').selectOption(coordinator.id);
  await queueItem.getByRole('button', { name: 'Assign' }).click();
  await expect.poll(async () => {
    const row = await fx.row('SELECT assigned_coordinator_id FROM events WHERE id = $1', [event.id]);
    return row?.assigned_coordinator_id;
  }).toBe(coordinator.id);

  await switchUser(page, coordinator);
  await page.goto('/coordinator/requests');
  const requestCard = page.locator('li', { hasText: title });
  await requestCard.getByRole('button', { name: 'View Details' }).click();
  await requestCard.getByRole('button', { name: 'Approve' }).click();
  await requestCard.getByRole('button', { name: 'Confirm' }).click();
  await expect(requestCard.getByText('Request approved.')).toBeVisible();

  await page.goto('/bookings/new');
  await page.locator('#booking-event').selectOption(event.id);
  await page.locator('#booking-venue').selectOption(venue.id);
  await page.getByLabel('Start date').fill('2099-04-10');
  await page.getByLabel('End date').fill('2099-04-10');
  await page.getByLabel('Start time').fill('09:00');
  await page.getByLabel('End time').fill('12:00');
  await page.getByLabel('Arrangement requests for Venue Staff').fill('Main stage and wheelchair aisle clearance');
  await page.getByRole('button', { name: 'Review request' }).click();
  await page.getByRole('button', { name: 'Confirm and submit' }).click();
  await expect(page.getByText('submitted. Venue Staff can now review this venue arrangement.')).toBeVisible();

  const booking = await fx.row(
    `SELECT id, status FROM bookings WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [event.id]
  );
  expect(booking.status).toBe('pending');

  await switchUser(page, venueStaff);
  await page.goto('/bookings/pending');
  await page.locator('article', { hasText: title }).getByRole('link', { name: 'Review Request' }).click();
  await page.getByRole('button', { name: 'Approve Request' }).click();
  await page.getByRole('button', { name: 'Confirm Approval' }).click();
  await expect(page.getByText('Decision saved successfully.')).toBeVisible();
  await expect.poll(async () => {
    const row = await fx.row('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    return row?.status;
  }).toBe('approved');

  await switchUser(page, coordinator);
  await page.goto('/technical-support/requirements');
  await page.getByLabel('Event').selectOption(event.id);
  await page.getByRole('checkbox', { name: equipment.name }).check();
  await page.getByLabel(`${equipment.name} quantity`).fill('2');
  await page.getByLabel('Number of staff required').fill('2');
  await page.getByRole('button', { name: 'Save requirements' }).click();
  await expect(page.getByText('Technical support requirements saved and shared with Technical Support Staff.')).toBeVisible();

  await switchUser(page, techSupport);
  await page.goto('/technical-support/queue');
  const technicalCard = page.locator('article', { hasText: title });
  await technicalCard.getByRole('button', { name: 'Sufficient Resources Available' }).click();
  await expect(page.getByText(`Saved "Sufficient Resources Available" for ${title}.`)).toBeVisible();
  await expect.poll(async () => {
    const row = await fx.row('SELECT status FROM technical_support_requirements WHERE event_id = $1', [event.id]);
    return row?.status;
  }).toBe('confirmed');

  await switchUser(page, safetyOfficer);
  await page.goto('/safety/checks');
  const safetyCard = page.locator('article', { hasText: title }).first();
  await safetyCard.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(async () => {
    const row = await fx.row('SELECT status FROM operational_safety_checks WHERE event_id = $1', [event.id]);
    return row?.status;
  }).toBe('approved');

  await switchUser(page, venueStaff);
  await page.goto('/venue/preparation');
  const prepRow = page.locator('tr', { hasText: title });
  await prepRow.getByRole('combobox').selectOption({ label: 'In Progress' });
  await prepRow.getByRole('button', { name: 'Save' }).click();
  await expect(prepRow.getByTestId('current-status')).toHaveText('In Progress');

  await switchUser(page, attendee);
  await page.goto('/attendee/events');
  const attendeeCard = page.locator('div.border.rounded.p-3', { hasText: title });
  await attendeeCard.getByRole('button', { name: 'Register' }).click();
  await attendeeCard.getByLabel('Name').fill('Smoke Attendee');
  await attendeeCard.getByLabel('Email').fill(`attendee-${fx.run}@example.test`);
  await attendeeCard.getByLabel('Phone').fill('+6599990000');
  await attendeeCard.getByRole('button', { name: 'Confirm registration' }).click();
  await expect(page.getByText(`You're registered for "${title}".`)).toBeVisible();
  await expect.poll(async () => {
    const row = await fx.row('SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = $2', [event.id, 'registered']);
    return row?.n;
  }).toBe(1);
});

test('@smoke [SMOKE-02] venue conflict is refused and existing booking remains intact', async ({ page }) => {
  const organiser = await fx.user('event_organiser', 'conflict-org');
  const coordinator = await fx.user('event_coordinator', 'conflict-coord');
  const venueStaff = await fx.user('venue_staff', 'conflict-venue');
  const eventA = await fx.event({ title: 'Conflict Base', organiser, coordinator, status: 'confirmed' });
  const eventB = await fx.event({ title: 'Conflict Attempt', organiser, coordinator, status: 'approved' });
  const venue = await fx.venue('Conflict Hall');

  const existing = await fx.row(
    `INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status, setup_minutes, turnaround_minutes)
     VALUES ($1, $2, $3, $4, $5, 'confirmed', 60, 60)
     RETURNING id`,
    [eventA.id, venue.id, coordinator.id, fx.sgt('2099-06-10', '09:00'), fx.sgt('2099-06-10', '11:00')]
  );

  await signIn(page, coordinator);
  await page.goto('/bookings/new');
  await page.locator('#booking-event').selectOption(eventB.id);
  await page.locator('#booking-venue').selectOption(venue.id);
  await page.getByLabel('Start date').fill('2099-06-10');
  await page.getByLabel('End date').fill('2099-06-10');
  await page.getByLabel('Start time').fill('11:30');
  await page.getByLabel('End time').fill('13:00');
  await page.getByRole('button', { name: 'Review request' }).click();
  await page.getByRole('button', { name: 'Confirm and submit' }).click();
  await page.getByRole('button', { name: 'Acknowledge conflict and submit' }).click();
  await expect(page.getByText('submitted. Venue Staff can now review this venue arrangement.')).toBeVisible();

  const conflictBooking = await fx.row(
    `SELECT id, status FROM bookings WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [eventB.id]
  );
  expect(conflictBooking.status).toBe('pending');

  await switchUser(page, venueStaff);
  await page.goto('/bookings/pending');
  await page.locator('article', { hasText: eventB.title }).getByRole('link', { name: 'Review Request' }).click();
  await page.getByRole('button', { name: 'Approve Request' }).click();
  await page.getByRole('button', { name: 'Confirm Approval' }).click();
  await expect(page.getByText('The venue is unavailable for this occupied interval.')).toBeVisible();

  await expect.poll(async () => {
    const row = await fx.row('SELECT status FROM bookings WHERE id = $1', [conflictBooking.id]);
    return row?.status;
  }).toBe('pending');

  await expect.poll(async () => {
    const row = await fx.row('SELECT status FROM bookings WHERE id = $1', [existing.id]);
    return row?.status;
  }).toBe('confirmed');
});

test('@smoke [SMOKE-03] approved date/time change flags arrangements for reconsideration', async ({ page }) => {
  const organiser = await fx.user('event_organiser', 'change-org');
  const coordinator = await fx.user('event_coordinator', 'change-coord');
  const event = await fx.event({ title: 'Change Window', organiser, coordinator });
  const arranged = await fx.arrangements(event, coordinator);
  const changeRequestId = await fx.changeRequest(event, organiser, {
    preferredStart: fx.sgt('2099-03-05', '14:00'),
    preferredEnd: fx.sgt('2099-03-05', '17:00')
  });

  await signIn(page, coordinator);
  await page.goto('/coordinator/change-requests');

  const request = page.locator('article', { hasText: event.title });
  await expect(request).toContainText('Date & time');
  await request.getByRole('button', { name: 'Approve' }).click();

  const status = page.getByRole('status');
  await expect(status).toContainText(`Change request for ${event.title} approved.`);
  await expect(status).toContainText(`${arranged.venueName} booking`);
  await expect(status).toContainText(`2 × ${arranged.equipmentName}`);

  const updatedEvent = await fx.row('SELECT preferred_start, preferred_end FROM events WHERE id = $1', [event.id]);
  expect(updatedEvent.preferred_start.toISOString()).toBe(fx.sgt('2099-03-05', '14:00'));
  expect(updatedEvent.preferred_end.toISOString()).toBe(fx.sgt('2099-03-05', '17:00'));

  const updatedChangeRequest = await fx.row('SELECT status FROM event_change_requests WHERE id = $1', [changeRequestId]);
  expect(updatedChangeRequest.status).toBe('approved');

  const booking = await fx.row('SELECT status, requires_reconsideration FROM bookings WHERE id = $1', [arranged.bookingId]);
  expect(booking).toEqual({ status: 'confirmed', requires_reconsideration: true });
  const reservation = await fx.row('SELECT quantity, requires_reconsideration FROM equipment_reservations WHERE id = $1', [arranged.reservationId]);
  expect(reservation).toEqual({ quantity: 2, requires_reconsideration: true });
});
