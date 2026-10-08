# US-034 — Assign and Reassign Event Coordinators

## User story

As an Event Coordinator Lead, I want to assign and reassign Event Coordinators to event requests from an unassigned queue, so that event requests are properly distributed among coordinators.

## Acceptance criteria and where they are tested

| # | Acceptance criterion | Test cases |
| --- | --- | --- |
| AC1 | The Lead can view event requests in an unassigned queue. | 001, 002, 007, 023 |
| AC2 | The Lead can review basic event information before assigning. | 003 |
| AC3 | The Lead can assign an unassigned request to a Coordinator. | 004, 005, 021, 023 |
| AC4 | The Lead can reassign a request from one Coordinator to another. | 009, 010, 014, 022 |
| AC5 | The assigned Coordinator is notified when a request is assigned or reassigned to them. | 006, 011 |
| AC6 | The previous Coordinator is notified when a request is reassigned. | 012 |
| AC7 | Coordinators can only manage requests currently assigned to them. | 016, 018 |
| AC8 | The Lead can view all coordinator assignments and active events. | 015, 020 |
| AC9 | The system records the current Coordinator for each assigned request. | 008, 019 |

Test cases 016–019 also cover two effects of this story on Coordinators: they can no longer assign requests to themselves, and venue bookings follow the event when it is reassigned.

## Before you start

### Terms used in this plan

- **Event Coordinator Lead ("Lead")**: the person who distributes event requests to Coordinators.
- **Event Coordinator ("Coordinator")**: works on the event requests assigned to them.
- **Event Organiser**: an outside client who submits event requests.
- **Unassigned queue**: submitted event requests that no Coordinator has been given yet.
- **Active request**: a request that is still in progress. Its status is Submitted, Clarification requested, Approved, Planning or Confirmed. Rejected, completed and cancelled requests are not active.
- **Notification bell**: the bell icon at the top right of every page. A red number on it shows how many notifications are unread. Click the bell to open the list.

### Setup (ask the developer)

1. The application is running and opens at **http://localhost:5173**.
2. The demo data has been reset just before you start. A developer does this by running `npm run seed-demo` in the `backend` folder. **Write down the date of the reset**, because the event dates below are counted from it.
3. Run the test cases **in order, in one session**. Later cases depend on what earlier cases changed. If you have to start again, ask for another reset and begin at 001.

### Test accounts

Every account uses the password **`Password123!`**

| Role | Name shown in the app | Email |
| --- | --- | --- |
| Event Coordinator Lead | Event Coordinator Lead | coordinatorlead@connectsphere.local |
| Event Coordinator | Event Coordinator | coordinator@connectsphere.local |
| Event Coordinator | Event Coordinator Two | coordinator2@connectsphere.local |
| Event Coordinator | Event Coordinator Three | coordinator3@connectsphere.local |
| Event Organiser | Event Organiser | organiser@connectsphere.local |

### How to sign in, sign out and use two windows

- **Sign in:** go to http://localhost:5173, enter the email and password, and click **Sign in**.
- **Sign out:** click your initials (the round avatar) at the top right, then click **Logout**.
- **Two people at once:** all normal tabs in one browser share the same sign-in. To be signed in as a second person, open a **private window**: in Chrome press **Ctrl+Shift+N** (Windows) or **⌘+Shift+N** (Mac), and in Firefox or Edge press **Ctrl+Shift+P** / **⌘+Shift+P**. Sign in there as the second person. Each test case says which window to use.
- **The Lead's page does not update by itself.** If something changes in another window, click the **Refresh** button in the "Unassigned queue" section to see it.

### Demo data after a reset

"Day +14" means 14 days after the reset date. All times are Singapore time.

| Event request | Status | Coordinator | Date and time | Attendance |
| --- | --- | --- | --- | --- |
| US-034 Demo: Freshman Orientation Fair | Submitted | *(unassigned)* | Day +14, 9:00 AM – 4:00 PM | 180 |
| US-034 Demo: Alumni Networking Night | Submitted | *(unassigned)* | Day +21, 6:30 PM – 9:30 PM | 90 |
| US-034 Demo: Data Science Workshop | Submitted | *(unassigned)* | Day +10, 1:00 PM – 5:00 PM | 40 |
| US-034 Demo: Charity Gala Dinner | Submitted | *(unassigned)* | Day +35, 7:00 PM – 11:00 PM | 150 |
| US-034 Demo: Leadership Seminar | Submitted | Event Coordinator Two | Day +17, 10:00 AM – 12:00 PM | 60 |
| US-034 Demo: Robotics Showcase | Submitted | Event Coordinator Two | Day +28, 11:00 AM – 5:00 PM | 120 |
| US-034 Demo: Career Talk Series | Submitted | Event Coordinator Three | Day +12, 3:00 PM – 4:30 PM | 70 |
| Six "US-017 Demo" and "US-023 Demo" events (for example *US-017 Demo: Morning Conference*) | Approved | Event Coordinator | Days +3 to +6 | various |

Starting workload: **Event Coordinator 6**, **Event Coordinator Two 2**, **Event Coordinator Three 1**. Four requests are unassigned.

---

## Test cases

### US-034-001 — The Lead opens the Assign Coordinator page from the home page

**1. Test case scenario**
The Lead can find the Assign Coordinator button on their home page, and it opens the assignment page.

**2. Test steps**
1. Sign in as the Lead.
2. On the home page, find the card titled **Coordinator Lead workspace**.
3. Click **Assign Coordinator**.

**3. Test data**
- Account: coordinatorlead@connectsphere.local / Password123!

**4. Expected results**
- The **Assign Coordinator** button is inside the **Coordinator Lead workspace** card. It is a filled, coloured button with a person-and-tick icon.
- Clicking it opens a page headed **Assign coordinators**, with the small label "Coordinator assignment" above the heading.
- The page has three sections, from top to bottom: **Unassigned queue**, **Coordinator workload** and **Active assignments**.
- A **Back to Home** button at the top right returns to the home page.

---

### US-034-002 — View the unassigned queue

**1. Test case scenario**
The Lead sees every unassigned request, with the oldest submission first.

**2. Test steps**
1. Signed in as the Lead, open the **Assign coordinators** page (as in 001).
2. Look at the **Unassigned queue** section.

**3. Test data**
- Demo data straight after a reset.

**4. Expected results**
- The number badge next to "Unassigned queue" shows **4**.
- The four requests appear in this order (oldest submission first):
  1. US-034 Demo: Freshman Orientation Fair
  2. US-034 Demo: Alumni Networking Night
  3. US-034 Demo: Data Science Workshop
  4. US-034 Demo: Charity Gala Dinner
- Each row shows the event type and submission time (for example "Fair · Submitted …"), the event date and time, and a **Review & assign** button.
- Requests that already have a Coordinator (such as *Leadership Seminar*) are **not** in the queue.

---

### US-034-003 — Review basic event information before assigning

**1. Test case scenario**
The Lead can read a request's key details before choosing a Coordinator.

**2. Test steps**
1. In the Unassigned queue, click **Review & assign** on *US-034 Demo: Freshman Orientation Fair*.
2. Read the details panel that opens.
3. Click **Close** on the same row.

**3. Test data**
- Request: US-034 Demo: Freshman Orientation Fair

**4. Expected results**
- After step 1, a panel opens under the row and shows:
  - **Organiser:** Event Organiser (organiser@connectsphere.local)
  - **Status:** Submitted
  - **Event type:** Fair
  - **Schedule:** Day +14, 9:00 AM – 4:00 PM (for example "Thu, 22 Oct 2026, 9:00 AM – 4:00 PM")
  - **Expected attendance:** 180
  - **Purpose:** Welcome incoming students and introduce campus clubs.
  - **Description:** Booths for 30 student clubs with a short welcome address at 9:30 AM.
- Below the details are an **Assign to** dropdown and an **Assign** button.
- After step 3, the panel closes and nothing has been assigned. The queue still shows 4.

---

### US-034-004 — Assigning without choosing a Coordinator is blocked

**1. Test case scenario**
The Lead must choose a Coordinator before a request can be assigned.

**2. Test steps**
1. Click **Review & assign** on *US-034 Demo: Freshman Orientation Fair*.
2. Leave **Assign to** on "Select an Event Coordinator".
3. Click **Assign**.

**3. Test data**
- No Coordinator selected.

**4. Expected results**
- The dropdown is outlined in red, with the message **"Choose an Event Coordinator."** under it.
- No success message appears, and the request stays in the queue (still 4).

---

### US-034-005 — Assign an unassigned request to a Coordinator

**1. Test case scenario**
The Lead assigns a request from the queue, and it moves into the active assignments.

**2. Test steps**
1. With the *Freshman Orientation Fair* panel still open, open the **Assign to** dropdown and read the options.
2. Select **Event Coordinator Three — 1 active request**.
3. Click **Assign**.

**3. Test data**
- Request: US-034 Demo: Freshman Orientation Fair
- Coordinator: Event Coordinator Three

**4. Expected results**
- In step 1, the dropdown lists all three Coordinators with their current workload: "Event Coordinator — 6 active requests", "Event Coordinator Three — 1 active request" and "Event Coordinator Two — 2 active requests".
- After step 3, a green message at the top says: **Assigned "US-034 Demo: Freshman Orientation Fair" to Event Coordinator Three. They have been notified.**
- The request leaves the Unassigned queue, which now shows **3**.
- In **Coordinator workload**, Event Coordinator Three now shows **2**.
- In **Active assignments**, the request appears with status **Submitted** and coordinator **Event Coordinator Three**.

---

### US-034-006 — The assigned Coordinator is notified

**1. Test case scenario**
A Coordinator receives a notification when the Lead assigns a request to them, and can open it.

**2. Test steps**
1. Sign out, then sign in as Event Coordinator Three.
2. Look at the notification bell at the top right, then click it.
3. Click the notification about *Freshman Orientation Fair*.
4. On the page that opens, click **View Details** on *US-034 Demo: Freshman Orientation Fair*.

**3. Test data**
- Account: coordinator3@connectsphere.local / Password123!

**4. Expected results**
- The bell shows a red unread count of at least 1.
- The list contains: **Event request "US-034 Demo: Freshman Orientation Fair" has been assigned to you by Event Coordinator Lead.** It is highlighted as unread.
- Clicking it marks it as read and opens the **Assigned Requests** page.
- *Freshman Orientation Fair* is in **My Assigned Requests**, and **View Details** shows its details (purpose, attendance, and so on) with **Approve** and **Reject** buttons.

---

### US-034-007 — A newly submitted request appears in the queue

**1. Test case scenario**
When an Event Organiser submits a new request, it joins the end of the Lead's unassigned queue.

**2. Test steps**
1. Sign out, then sign in as the Event Organiser.
2. On the home page, click **Create Request**.
3. Fill in the form with the test data, then click **Submit for Review**.
4. Confirm a submission confirmation is shown.
5. Sign out, sign in as the Lead, and open **Assign Coordinator**.

**3. Test data**
- Account: organiser@connectsphere.local / Password123!
- Event Name: **US-034 Test: Community Coding Night**
- Start Date: 20 November 2026, Start Time: **6:00 PM**
- End Date: 20 November 2026, End Time: **9:00 PM**
- Expected Attendance: 45
- Purpose: Evening coding meetup for beginners
- Description: Mentored coding session with refreshments
- Leave all other fields as they are.

**4. Expected results**
- The Organiser sees a green message: **Request submitted successfully.**
- The Lead's Unassigned queue now shows **4**, with *US-034 Test: Community Coding Night* **last** (it is the newest).
- **Review & assign** on it shows the details entered above, with Organiser "Event Organiser".

---

### US-034-008 — An assignment is saved permanently

**1. Test case scenario**
The Coordinator recorded for a request stays the same after the page is reloaded and the Lead signs in again.

**2. Test steps**
1. Signed in as the Lead on the Assign coordinators page, press **F5** (or ⌘+R) to reload the browser page.
2. Sign out, sign back in as the Lead, and open **Assign Coordinator** again.

**3. Test data**
- Assignment made in 005: Freshman Orientation Fair → Event Coordinator Three

**4. Expected results**
- After both steps, *Freshman Orientation Fair* is still in **Active assignments** with coordinator **Event Coordinator Three**, and is not in the Unassigned queue.

---

### US-034-009 — The Reassign dialog shows the current Coordinator and can be cancelled

**1. Test case scenario**
Before reassigning, the Lead sees who has the request now. Cancelling changes nothing.

**2. Test steps**
1. In **Active assignments**, find *US-034 Demo: Robotics Showcase* (coordinator: Event Coordinator Two) and click **Reassign**.
2. Read the dialog, then open the **Reassign to** dropdown.
3. Click **Reassign** without choosing anyone.
4. Click **Cancel**.

**3. Test data**
- Request: US-034 Demo: Robotics Showcase

**4. Expected results**
- A dialog titled **Reassign event request** opens. It shows the event name, its status and schedule, "Organiser: Event Organiser", and **Currently assigned to Event Coordinator Two.**
- The dropdown lists only **Event Coordinator** and **Event Coordinator Three**. The current Coordinator (Two) is not offered.
- The dialog explains: "Both coordinators will be notified. Event Coordinator Two will no longer be able to manage this request."
- After step 3, the dropdown is outlined in red with **"Choose an Event Coordinator."** and the dialog stays open.
- After step 4, the dialog closes and *Robotics Showcase* is still assigned to Event Coordinator Two.

---

### US-034-010 — Reassign a request to another Coordinator

**1. Test case scenario**
The Lead moves a request from one Coordinator to another.

**2. Test steps**
1. Click **Reassign** on *US-034 Demo: Robotics Showcase*.
2. Select **Event Coordinator Three — 2 active requests**.
3. Click **Reassign**.

**3. Test data**
- Request: US-034 Demo: Robotics Showcase
- From: Event Coordinator Two → To: Event Coordinator Three

**4. Expected results**
- The dialog closes and a green message says: **Reassigned "US-034 Demo: Robotics Showcase" from Event Coordinator Two to Event Coordinator Three. Both coordinators have been notified.**
- In **Active assignments**, *Robotics Showcase* now shows **Event Coordinator Three**.
- **Coordinator workload** shows Event Coordinator Two **1** and Event Coordinator Three **3**.

---

### US-034-011 — The new Coordinator is notified of the reassignment

**1. Test case scenario**
The Coordinator who receives a reassigned request is told who it came from.

**2. Test steps**
1. Sign out, then sign in as Event Coordinator Three.
2. Click the notification bell.
3. Go to **Dashboard → Quick Actions → Assigned Event Requests**.

**3. Test data**
- Account: coordinator3@connectsphere.local

**4. Expected results**
- The list contains: **Event request "US-034 Demo: Robotics Showcase" has been reassigned to you from Event Coordinator Two by Event Coordinator Lead.**
- *Robotics Showcase* is listed in **My Assigned Requests**.

---

### US-034-012 — The previous Coordinator is notified and loses the request

**1. Test case scenario**
The Coordinator who lost a request is told about it and can no longer see it.

**2. Test steps**
1. Sign out, then sign in as Event Coordinator Two.
2. Click the notification bell.
3. Go to **Dashboard → Quick Actions → Assigned Event Requests**.

**3. Test data**
- Account: coordinator2@connectsphere.local

**4. Expected results**
- The list contains: **Event request "US-034 Demo: Robotics Showcase" has been reassigned from you to Event Coordinator Three by Event Coordinator Lead. It is no longer in your assigned requests.**
- *Robotics Showcase* is **not** in **My Assigned Requests**. *Leadership Seminar* is still there.

---

### US-034-013 — Coordinators are not notified when nothing changes for them

**1. Test case scenario**
Cancelled or blocked actions in 004 and 009 did not send notifications.

**2. Test steps**
1. Still signed in as Event Coordinator Two, open the notification bell.
2. Count the notifications about *Robotics Showcase*.

**3. Test data**
- Account: coordinator2@connectsphere.local

**4. Expected results**
- There is exactly **one** notification about *Robotics Showcase*: the reassignment in 012. The cancelled dialog in 009 sent nothing.

---

### US-034-014 — Reassign an already-approved event

**1. Test case scenario**
Requests that a Coordinator has already approved can still be reassigned, because they are still active.

**2. Test steps**
1. Sign out, sign in as the Lead, and open **Assign Coordinator**.
2. In **Active assignments**, find *US-017 Demo: Morning Conference* (status **Approved**, coordinator Event Coordinator) and click **Reassign**.
3. Select **Event Coordinator Two** and click **Reassign**.

**3. Test data**
- Request: US-017 Demo: Morning Conference
- From: Event Coordinator → To: Event Coordinator Two

**4. Expected results**
- A green success message confirms the reassignment.
- *Morning Conference* now shows **Event Coordinator Two**, and its status badge is still **Approved** (green).
- Workload: Event Coordinator **5**, Event Coordinator Two **2**, Event Coordinator Three **3**.

---

### US-034-015 — View all coordinator assignments and filter by Coordinator

**1. Test case scenario**
The Lead can see every Coordinator's workload and list each Coordinator's active requests.

**2. Test steps**
1. In **Coordinator workload**, read each Coordinator's number.
2. Read the badge next to **Active assignments**.
3. Click the **Event Coordinator Two** tile.
4. Click the same tile again.
5. In the **Coordinator** dropdown at the top right of Active assignments, choose **Event Coordinator Three**, then choose **All coordinators**.

**3. Test data**
- State after 014.

**4. Expected results**
- Step 1: Event Coordinator **5**, Event Coordinator Two **2**, Event Coordinator Three **3**. Each tile also shows the Coordinator's email.
- Step 2: the badge shows **10** (5 + 2 + 3).
- Step 3: the tile is highlighted, the badge shows **2**, and the table lists only *Leadership Seminar* and *Morning Conference*.
- Step 4: the highlight is removed and all 10 rows return.
- Step 5: choosing Event Coordinator Three shows its 3 requests (*Career Talk Series*, *Freshman Orientation Fair*, *Robotics Showcase*). Choosing All coordinators shows all 10 again.
- Every row shows the event name and type, a status badge, the schedule, the Coordinator, and a **Reassign** button.

---

### US-034-016 — Coordinators cannot assign requests to themselves

**1. Test case scenario**
Only the Lead assigns requests now. A Coordinator's page shows only their own requests, with no way to take or release one.

**2. Test steps**
1. Sign out, then sign in as Event Coordinator Two.
2. Go to **Dashboard → Quick Actions → Assigned Event Requests**.

**3. Test data**
- Account: coordinator2@connectsphere.local

**4. Expected results**
- The page has **no "Unassigned Queue"** section, no **Assign to Me** button and no **Unassign** button.
- It shows the note: "The Event Coordinator Lead assigns requests to you. You can only manage requests currently assigned to you."
- **My Assigned Requests** lists only *Leadership Seminar* and *Morning Conference*. Requests belonging to other Coordinators (such as *Robotics Showcase*) are not shown.

---

### US-034-017 — A Coordinator creates a venue booking for their request

**1. Test case scenario**
Prepares the booking checks in 018 and 019. A Coordinator submits a venue booking request for an event assigned to them.

**2. Test steps**
1. Signed in as Event Coordinator Two, go to **Dashboard → Quick Actions → Create Venue Booking Requests**.
2. Fill in the form with the test data.
3. Click **Review all bookings**, then **Confirm and submit all**.
4. Click **Back to Dashboard** and find the **My Venue Booking Requests** card on the right.

**3. Test data**
- Event: **US-034 Demo: Leadership Seminar (expected attendance: 60)**
- Venue: **Hotel Ballroom 3 (150 seats)**
- Required capacity: 60 (filled in automatically)
- Date: the Leadership Seminar date (Day +17)
- Start time: 10:00 AM, End time: 12:00 PM
- Setup minutes: 30, Turnaround minutes: 30

**4. Expected results**
- A green message says: **1 venue booking requests submitted for US-034 Demo: Leadership Seminar.**
- **My Venue Booking Requests** lists *US-034 Demo: Leadership Seminar*, Hotel Ballroom 3, with a yellow **Pending Review** badge.

---

### US-034-018 — A reassigned Coordinator immediately loses control of the request

**1. Test case scenario**
If the Lead reassigns a request while the old Coordinator has it open, the old Coordinator can no longer act on it, and its venue booking leaves their dashboard.

**2. Test steps**
1. **Normal window (Event Coordinator Two):** go to **Assigned Event Requests** and click **View Details** on *Leadership Seminar*. Leave this page open.
2. **Private window:** sign in as the Lead, open **Assign Coordinator**, and reassign *US-034 Demo: Leadership Seminar* to **Event Coordinator Three**.
3. **Normal window:** on the open details, click **Approve**, then **Confirm**.
4. **Normal window:** click **Refresh** at the top of My Assigned Requests.
5. **Normal window:** click **Back to Dashboard** (or Dashboard in the top bar) and look at **My Venue Booking Requests**.

**3. Test data**
- Request: US-034 Demo: Leadership Seminar
- From: Event Coordinator Two → To: Event Coordinator Three

**4. Expected results**
- Step 2: the Lead sees the green reassignment message.
- Step 3: the approval is refused with a red message: **"Request not found, not assigned to this coordinator, or already decided"**. The request is **not** approved.
- Step 4: *Leadership Seminar* disappears from My Assigned Requests. Only *Morning Conference* remains.
- Step 5: the *Leadership Seminar* booking from 017 is **no longer** listed in My Venue Booking Requests.
- Event Coordinator Two's notification bell has a new "reassigned from you" notification about *Leadership Seminar*.

---

### US-034-019 — The new Coordinator takes over the request and its venue booking

**1. Test case scenario**
The Coordinator who receives a reassigned request also sees the venue bookings made for it before.

**2. Test steps**
1. Close the private window. In the normal window, sign out and sign in as Event Coordinator Three.
2. On the home page, look at **My Venue Booking Requests**.
3. Click **View All** in that card.
4. Go to **Assigned Event Requests** and click **View Details** on *Leadership Seminar*.

**3. Test data**
- Account: coordinator3@connectsphere.local

**4. Expected results**
- Step 2: *US-034 Demo: Leadership Seminar* at Hotel Ballroom 3 is listed with **Pending Review**, although Event Coordinator Two created it.
- Step 3: the booking appears on the **All Venue Booking Requests** page.
- Step 4: the details open, and **Approve** / **Reject** are available to Event Coordinator Three.

---

### US-034-020 — Rejected requests leave the active list; approved ones stay

**1. Test case scenario**
The Lead's view shows only active requests. A request a Coordinator rejects drops out, and one they approve stays.

**2. Test steps**
1. Signed in as Event Coordinator Three on **Assigned Event Requests**, click **View Details** on *Career Talk Series*.
2. Click **Reject**, choose the reason **Duplicate Request**, and click **Confirm**.
3. Click **View Details** on *Freshman Orientation Fair*, then **Approve** → **Confirm**.
4. Sign out, sign in as the Lead, and open **Assign Coordinator**.

**3. Test data**
- Reject: US-034 Demo: Career Talk Series (reason: Duplicate Request)
- Approve: US-034 Demo: Freshman Orientation Fair

**4. Expected results**
- *Career Talk Series* is **not** in Active assignments, not in the Unassigned queue, and cannot be reassigned.
- *Freshman Orientation Fair* is still listed with Event Coordinator Three and a green **Approved** badge.
- Event Coordinator Three's workload is **3** (Freshman Orientation Fair, Robotics Showcase and Leadership Seminar; Career Talk Series no longer counts).

---

### US-034-021 — Two Leads assign the same request at the same time

**1. Test case scenario**
If someone else assigns a request while the Lead has an old copy of the page open, the Lead's attempt is refused rather than overwriting it.

**2. Test steps**
1. **Normal window:** signed in as the Lead, open **Assign Coordinator**. Do not refresh this window until step 4.
2. Open a **private window**, sign in as the Lead again, and open **Assign Coordinator**.
3. **Private window:** assign *US-034 Demo: Alumni Networking Night* to **Event Coordinator**.
4. **Normal window:** *Alumni Networking Night* is still shown in the queue. Click **Review & assign** on it, choose **Event Coordinator Two**, and click **Assign**.

**3. Test data**
- Request: US-034 Demo: Alumni Networking Night
- Private window assigns to Event Coordinator; normal window tries Event Coordinator Two.

**4. Expected results**
- Step 3 succeeds with the green "Assigned …" message.
- Step 4 shows a yellow message: **Not changed. "US-034 Demo: Alumni Networking Night" was assigned by someone else while you were viewing it. The list has been refreshed; review it and try again.**
- The normal window refreshes on its own. *Alumni Networking Night* leaves the queue and appears in Active assignments with **Event Coordinator**, not Event Coordinator Two.
- Event Coordinator Two receives **no** notification about *Alumni Networking Night*.

---

### US-034-022 — Two Leads reassign the same request at the same time

**1. Test case scenario**
A reassignment made from an out-of-date dialog is refused.

**2. Test steps**
1. **Normal window:** click **Reassign** on *Alumni Networking Night* (currently Event Coordinator). Leave the dialog open.
2. **Private window:** click the queue's **Refresh**, then reassign *Alumni Networking Night* to **Event Coordinator Three**.
3. **Normal window:** in the open dialog, choose **Event Coordinator Two** and click **Reassign**.

**3. Test data**
- Request: US-034 Demo: Alumni Networking Night

**4. Expected results**
- Step 2 succeeds.
- Step 3: the dialog closes and a yellow message says **Not changed. "US-034 Demo: Alumni Networking Night" was assigned by someone else while you were viewing it. …**
- The table refreshes and shows *Alumni Networking Night* with **Event Coordinator Three**.

---

### US-034-023 — Empty the unassigned queue

**1. Test case scenario**
Once every request has been assigned, the queue says so.

**2. Test steps**
1. Close the private window. In the normal window (Lead), assign the remaining requests one at a time using **Review & assign**.

**3. Test data**
- US-034 Demo: Data Science Workshop → Event Coordinator Two
- US-034 Demo: Charity Gala Dinner → Event Coordinator Two
- US-034 Test: Community Coding Night → Event Coordinator

**4. Expected results**
- Each assignment shows its green success message.
- After the last one, the Unassigned queue badge shows **0** and the section says **"Every active event request has a coordinator."**
- Final workload: Event Coordinator **6**, Event Coordinator Two **3**, Event Coordinator Three **4**. The Active assignments badge shows **13**.

---

## Not covered by these manual tests

These are checked by the automated tests (`npm test` in `backend` and `frontend`) because they can't be set up from the browser:

- **A Venue Staff decision on a booking notifies the event's current Coordinator.** The app has no screen yet where Venue Staff approve or reject a booking. `backend/test/booking.ownership.test.js` confirms that, after a reassignment, the new Coordinator receives the decision notification and the previous one does not.
- **Server or database failures** during assignment: a clear error appears, nothing is changed, and retrying works.
- **Closed requests** (rejected, completed, cancelled, draft) cannot be assigned even if someone tries to send the request directly.
- **Roles other than the Lead** cannot view or change assignments.
