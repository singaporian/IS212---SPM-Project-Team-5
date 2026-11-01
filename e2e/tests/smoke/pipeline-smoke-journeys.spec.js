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
  await page.getByLabel('Accessibility Needs').fill('Wheelchair access');
  await page.getByLabel('Registration Needs').selectOption('yes');
  await page.getByRole('button', { name: 'Submit for Review' }).click();
  await expect(page).toHaveURL(/submitted=1/);
  await expect(page.getByText('Your request has been submitted successfully')).toBeVisible();
}

test('@smoke [SMOKE-01] complete happy path across all roles', async ({ page }) => {
  test.setTimeout(60_000);
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
  // US-006: the real notification bell delivers the successfully submitted request to the Lead.
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.locator('.notification-menu')).toContainText(`Event request "${title}" has been submitted and is awaiting assignment.`);
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
  // US-019: verify the review content, not just that the decision page can be opened.
  const review = page.getByRole('region', { name: 'Venue booking review', exact: true });
  await expect(review.getByRole('heading', { name: 'Booking Request', exact: true })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Event Requirements', exact: true })).toBeVisible();
  await expect(review.getByRole('heading', { name: `Venue information: ${venue.name}`, exact: true })).toBeVisible();
  await expect(review).toContainText('Main stage and wheelchair aisle clearance');
  await expect(review).toContainText('Expected attendance: 120');
  await expect(review).toContainText('Wheelchair access');
  await expect(review).toContainText('Projector');
  await expect(review).toContainText('Recorded setup / turnaround');
  await expect(review).toContainText('No operating hours recorded.');
  await expect(review.getByText('No reserved booking conflict', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve Request' }).click();
  await page.getByRole('button', { name: 'Confirm Approval' }).click();
  await expect(page.getByText('Decision saved successfully.')).toBeVisible();
  await expect.poll(async () => {
    const row = await fx.row('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    return row?.status;
  }).toBe('approved');

  await switchUser(page, coordinator);
  // US-033: the saved outcome is available to the Coordinator through the real receipt UI.
  await page.goto('/bookings');
  const receipt = page.locator('article', { hasText: title });
  await expect(receipt).toContainText('Approved — venue reserved');
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
  // US-019/US-033: buffer-only conflict is visible before the protected approval action.
  const review = page.getByRole('region', { name: 'Venue booking review', exact: true });
  await expect(review).toContainText('Warning: Reserved booking overlaps occupied period');
  await expect(review).toContainText(eventA.title);
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

test('@smoke [SMOKE-04] US-018 staff share persistent booking notes and only edit/delete their own', async ({ page }) => {
  test.setTimeout(60_000);
  const organiser = await fx.user('event_organiser', 'notes-org');
  const coordinator = await fx.user('event_coordinator', 'notes-coord');
  const staffA = await fx.user('venue_staff', 'notes-staff-a');
  const staffB = await fx.user('venue_staff', 'notes-staff-b');
  const event = await fx.event({ title: 'Internal Notes', organiser, coordinator, status: 'approved' });
  const venue = await fx.venue('Notes Hall');
  const booking = await fx.row(`INSERT INTO bookings (event_id, venue_id, requested_by, start_time, end_time, status)
    VALUES ($1,$2,$3,$4,$5,'approved') RETURNING id`,
  [event.id, venue.id, coordinator.id, fx.sgt('2099-04-11', '10:00'), fx.sgt('2099-04-11', '11:00')]);

  async function openNotes(title = event.title) {
    await page.goto('/venue/bookings');
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    const card = page.locator('.booking-entry', { hasText: title });
    await card.click();
    const notes = card.getByRole('region', { name: 'Internal Venue Staff notes', exact: true });
    await expect(notes.getByRole('button', { name: 'Add note', exact: true })).toBeEnabled();
    return { card, notes };
  }

  await signIn(page, staffA);
  let { card, notes } = await openNotes();
  await expect(card).toContainText('Approved — venue reserved');
  await notes.getByLabel('Add an internal note').fill('Keep ramp clear.');
  await notes.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(notes.getByRole('status')).toHaveText('Note added.');
  await notes.getByLabel('Add an internal note').fill('Use rear entrance.');
  await notes.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(notes.locator('li')).toHaveCount(2);
  const original = await fx.row('SELECT * FROM booking_notes WHERE booking_id=$1 AND note_text=$2', [booking.id, 'Keep ramp clear.']);
  expect(original.created_by).toBe(staffA.id);
  expect(original.created_at).toBeTruthy();

  await page.reload();
  ({ notes } = await openNotes());
  await expect(notes.locator('li .note-text')).toHaveText(['Keep ramp clear.', 'Use rear entrance.']);
  await expect(notes.locator('li').first()).toContainText(`E2E notes-staff-a ${fx.run}`);
  const attribution = await notes.locator('li').first().locator('p.small').innerText();
  expect(attribution).toMatch(/\d.*(?:AM|PM)/);

  await switchUser(page, staffB);
  ({ notes } = await openNotes());
  await expect(notes.locator('li .note-text')).toHaveText(['Keep ramp clear.', 'Use rear entrance.']);
  await expect(notes.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(notes.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await notes.getByLabel('Add an internal note').fill('Staff B handling note.');
  await notes.getByRole('button', { name: 'Add note', exact: true }).click();
  const ownB = notes.locator('li', { hasText: 'Staff B handling note.' });
  await expect(ownB.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();

  await switchUser(page, staffA);
  ({ notes } = await openNotes());
  const ownA = notes.locator('li', { hasText: 'Keep ramp clear.' });
  await ownA.getByRole('button', { name: 'Edit', exact: true }).click();
  // Editing replaces the displayed note text with a textarea; do not retain a text-filtered row locator.
  await notes.getByLabel('Edit your note').fill('Keep ramp and walkway clear.');
  await notes.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(notes.getByRole('status')).toHaveText('Note updated.');
  await expect(notes.locator('li .note-text')).toHaveText(['Keep ramp and walkway clear.', 'Use rear entrance.', 'Staff B handling note.']);
  await expect(notes.locator('li').first().locator('p.small')).toHaveText(attribution);
  const edited = await fx.row('SELECT created_by, created_at FROM booking_notes WHERE id=$1', [original.id]);
  expect(edited.created_by).toBe(original.created_by);
  expect(edited.created_at).toEqual(original.created_at);
  await notes.locator('li').first().getByRole('button', { name: 'Delete', exact: true }).click();
  await notes.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(notes.getByRole('status')).toHaveText('Note deleted.');
  ({ notes } = await openNotes());
  await expect(notes.locator('li .note-text')).toHaveText(['Use rear entrance.', 'Staff B handling note.']);
  await expect(notes.locator('li', { hasText: 'Staff B handling note.' }).getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);

  // Both eligible lifecycle states must remain reachable in the calendar.
  const confirmed = await fx.event({ title: 'Confirmed Notes', organiser, coordinator, status: 'confirmed' });
  await fx.venueBooking(confirmed, coordinator, 'Confirmed Notes Hall');
  ({ card, notes } = await openNotes(confirmed.title));
  await expect(card).toContainText('Booking status: Confirmed');
  await notes.getByLabel('Add an internal note').fill('Confirmed booking handling note.');
  await notes.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(notes.getByText('Confirmed booking handling note.', { exact: true })).toBeVisible();

  await switchUser(page, coordinator);
  await page.goto('/bookings');
  const receipt = page.locator('article', { hasText: event.title });
  await receipt.click();
  await expect(receipt.getByText('Use rear entrance.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Internal Venue Staff notes', exact: true })).toHaveCount(0);
});

for (const decision of ['rejected', 'alternative_suggested']) {
  test(`@smoke [SMOKE-05] US-033 ${decision} decision reaches the Coordinator with its details`, async ({ page }) => {
    const organiser = await fx.user('event_organiser', 'response-org');
    const coordinator = await fx.user('event_coordinator', 'response-coord');
    const staff = await fx.user('venue_staff', 'response-staff');
    const event = await fx.event({ title: 'Venue Response', organiser, coordinator, status: 'approved' });
    const venue = await fx.venue('Response Hall');
    const booking = await fx.row(`INSERT INTO bookings (event_id,venue_id,requested_by,start_time,end_time,status)
      VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id`,
    [event.id, venue.id, coordinator.id, fx.sgt('2099-04-12', '10:00'), fx.sgt('2099-04-12', '11:00')]);
    await signIn(page, staff);
    await page.goto('/bookings/pending');
    await page.locator('article', { hasText: event.title }).getByRole('link', { name: 'Review Request' }).click();
    if (decision === 'rejected') {
      await page.getByRole('button', { name: 'Reject Request', exact: true }).click();
      await page.getByLabel('Reason (optional)').selectOption({ label: 'Maintenance Conflict' });
    } else {
      await page.getByRole('button', { name: 'Suggest Alternative', exact: true }).click();
      await page.getByLabel('Alternative start (Singapore time)').fill('2099-04-13T10:03');
      await page.getByLabel('Alternative end (Singapore time)').fill('2099-04-13T11:07');
    }
    const comment = decision === 'rejected' ? 'Please choose another venue.' : 'This later arrangement is proposed.';
    await page.getByLabel('Additional comments').fill(comment);
    await page.getByRole('button', { name: decision === 'rejected' ? 'Confirm Rejection' : 'Confirm Alternative', exact: true }).click();
    await expect(page.getByText('Decision saved successfully.', { exact: true })).toBeVisible();
    expect((await fx.row('SELECT status FROM bookings WHERE id=$1', [booking.id])).status).toBe(decision);
    await switchUser(page, coordinator);
    await page.goto('/bookings');
    const receipt = page.locator('article', { hasText: event.title });
    await receipt.click();
    await expect(receipt).toContainText(comment);
    if (decision === 'rejected') {
      await expect(receipt).toContainText('Maintenance Conflict');
    } else {
      await expect(receipt).toContainText('Suggested alternative:');
      const stored = await fx.row('SELECT alternative_start_time,alternative_end_time FROM bookings WHERE id=$1', [booking.id]);
      expect(stored.alternative_start_time.toISOString()).toBe(fx.sgt('2099-04-13', '10:03'));
      expect(stored.alternative_end_time.toISOString()).toBe(fx.sgt('2099-04-13', '11:07'));
    }
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.locator('.notification-menu')).toContainText(`Venue booking request ${decision.replaceAll('_', ' ')}`);
  });
}
