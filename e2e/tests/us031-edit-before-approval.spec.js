// US-031 functional test: Edit a Submitted Request Before Approval, end to end in a real browser
// (real frontend, backend and PostgreSQL). [E2E-xx] ids link to docs/testing/US-031-test-plan.md.
const { test, expect } = require('@playwright/test');
const { createFixtures } = require('../support/db');

// The request as the Organiser submitted it (US-006 form fields).
const FORM = {
  eventName: 'Orientation', purpose: 'Welcome new students', description: 'Talks and booths',
  startDate: '2099-03-01', startTime: '09:00', endDate: '2099-03-01', endTime: '12:00',
  expectedAttendance: '100', venueRequirements: 'Theatre', accessibilityNeeds: 'None',
  equipmentRequirements: 'Projector', registrationNeeds: 'no'
};

let fx, organiser, coordinator;

test.beforeEach(async () => {
  fx = createFixtures();
  organiser = await fx.user('event_organiser', 'organiser');
  coordinator = await fx.user('event_coordinator', 'coordinator');
});
test.afterEach(async () => fx.cleanup());

async function signIn(page, account) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

test('[E2E-01] AC1 AC3 AC5 AC6: coordinator returns a request, organiser edits and resubmits it', async ({ page, browser }) => {
  const event = await fx.event({ title: 'Orientation', organiser, coordinator, status: 'submitted' });
  await fx.row(`UPDATE events SET draft_data = $2::jsonb, submitted_at = now() WHERE id = $1 RETURNING id`,
    [event.id, JSON.stringify({ ...FORM, eventName: event.title })]);

  // Coordinator returns the request with a note.
  await signIn(page, coordinator);
  await page.goto('/coordinator/requests');
  const card = page.locator('li', { hasText: event.title });
  await card.getByRole('button', { name: 'View Details' }).click();
  await card.getByRole('button', { name: 'Return for clarification' }).click();
  await card.getByLabel('Note to the Organiser').fill('Please confirm the expected attendance.');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toContainText('clarification_requested');

  // Organiser sees the status and note, edits a field and resubmits.
  const organiserPage = await (await browser.newContext()).newPage();
  await signIn(organiserPage, organiser);
  await organiserPage.goto(`/requests/submitted/${event.id}`);
  await expect(organiserPage.getByText('Returned for clarification').first()).toBeVisible();
  await expect(organiserPage.getByText('Please confirm the expected attendance.')).toBeVisible();

  await organiserPage.getByRole('link', { name: 'Edit request' }).click();
  await organiserPage.getByLabel(/Expected Attendance/).fill('150');
  await organiserPage.getByRole('button', { name: 'Save Changes' }).click();
  await expect(organiserPage).toHaveURL(new RegExp(`/requests/submitted/${event.id}\\?updated=1$`));
  await expect(organiserPage.getByText('Your changes have been saved.')).toBeVisible();

  await organiserPage.getByRole('button', { name: 'Resubmit for review' }).click();
  await expect(organiserPage.locator('.badge').first()).toHaveText('Submitted');

  const saved = await fx.row('SELECT status, expected_attendance FROM events WHERE id = $1', [event.id]);
  expect(saved).toEqual({ status: 'submitted', expected_attendance: 150 });
  const changeRequests = await fx.row('SELECT count(*)::int AS n FROM event_change_requests WHERE event_id = $1', [event.id]);
  expect(changeRequests.n).toBe(0);
});
