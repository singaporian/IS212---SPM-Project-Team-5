// US-021 end-to-end test: one happy-path journey through the real app (browser, frontend, backend, database).
const { test, expect } = require('@playwright/test');
const { pool, createFixtures } = require('../support/db'); // helpers that insert test data into the real database

let fx;

// TEARDOWN: delete this test's data after each test, and close the database connection at the end.
test.afterEach(async () => fx.cleanup());

// Logs in through the real login page.
async function signIn(page, account) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);   // finds the input by its label text
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');                    // waits until we land on the dashboard
}

test('[E2E-01] staff set venue A to In Progress and the coordinator sees each venue status (AC1-AC4)', async ({ page }) => {
  // Setup: three users and a confirmed event with two venues.
  fx = createFixtures();
  const organiser = await fx.user('event_organiser', 'organiser');
  const coordinator = await fx.user('event_coordinator', 'coord');
  const staff = await fx.user('venue_staff', 'staff');
  const event = await fx.event({ title: 'Summit', organiser, coordinator, status: 'confirmed' }); // confirmed = safety check passed
  const roomA = await fx.venueBooking(event, coordinator, 'Room A');
  const roomB = await fx.venueBooking(event, coordinator, 'Room B');

  // Venue Staff set Room A to In Progress.
  await signIn(page, staff);
  await page.getByRole('link', { name: 'Preparation Status' }).click();
  const rowA = page.locator('tr', { hasText: roomA.venueName });          // the table row for Room A
  await rowA.getByRole('combobox').selectOption({ label: 'In Progress' }); // combobox = the dropdown
  await rowA.getByRole('button', { name: 'Save' }).click();
  await expect(rowA.getByTestId('current-status')).toHaveText('In Progress'); // the saved status badge updates

  // The coordinator sees Room A In Progress and Room B still Not Started.
  await page.evaluate(() => localStorage.clear()); // sign out: the login token is stored in localStorage
  await signIn(page, coordinator);
  await page.getByRole('link', { name: 'Venue Preparation' }).click();
  await expect(page.locator('tr', { hasText: roomA.venueName })).toContainText('In Progress');
  await expect(page.locator('tr', { hasText: roomB.venueName })).toContainText('Not Started');
});