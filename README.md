# IS212---SPM-Project-Team-5

## Branch Naming Convention
Always branch off `main`. Format your branches as: `name/role/user-story-ID/brief-description`

## Pull Request Workflow
1. Push your branch to the remote repository.
2. Open a Pull Request against `main`.
3. Fill out the generated PR template.
4. Request at least one peer review. - should ownself check instead?
5. Once approved and all checks pass, squash and merge into `main`.


## Start the project (recommended)

Follow these steps to get a working local development environment. This uses Docker only for PostgreSQL; backend and frontend run locally for fast iteration.

1. From the repository root, start the Postgres container:

```bash
docker-compose up -d db
```

2. Create the backend env file (one-time):

```bash
cp .env.example backend/.env
```

3. Initialize the database schema and run the backend:

```bash
cd backend
npm install
# run the SQL schema against the running Postgres container
npm run init-db
# optional: create local demo accounts for all five roles
npm run seed-demo
# start the backend dev server
npm run dev
```

4. Start the frontend dev server (new terminal):

```bash
cd frontend
npm install
npm run dev
```

5. Open the app in your browser: http://localhost:5173

### Authentication

The application uses email/password authentication. Passwords are hashed with bcrypt and the backend returns an expiring JWT. Protected API requests require an `Authorization: Bearer <token>` header. The frontend stores the session locally and redirects unauthenticated users to `/login`.

Public registration creates either an `attendee` or `event_organiser` account. This matches the customer briefing: Event Organisers are external client representatives who need to submit their own event requests. Internal roles must be provisioned by an administrator or by the local demo seed command. For local testing, after `npm run init-db`, run `npm run seed-demo` in `backend`:

| Role | Demo email |
| --- | --- |
| Event Organiser | organiser@connectsphere.local |
| Event Coordinator | coordinator@connectsphere.local |
| Venue Staff | venue@connectsphere.local |
| Technical Support Staff | tech@connectsphere.local |
| Attendee | attendee@connectsphere.local |

All demo accounts use the password `Password123!`. These accounts are for local development only and must not be used in a deployed environment.

The current venue endpoint is restricted to Event Coordinators and Venue Staff as an example of role-based authorization. Other feature endpoints will apply the same middleware as they are implemented.

The `/requests/new` frontend route is restricted to Event Organisers. The dashboard also hides its request-creation actions for every other role. A user who manually enters `/requests/new` while logged in as another role is redirected to the dashboard.

The home dashboard uses one shared layout with role-aware copy and actions for now. Separate role-specific pages should be added when the corresponding workflows are implemented; duplicating five mostly empty homepages at this stage would create unnecessary maintenance overhead.

### Object-oriented domain model

The backend contains four domain classes in `backend/src/domain/index.js`:

- `User` encapsulates role decisions such as whether a user can create event requests or access venue data.
- `EventRequest` encapsulates draft/submitted state and coordinator assignment decisions.
- `Venue` encapsulates suitability checks for capacity, facilities, layouts, and accessibility.
- `Booking` encapsulates booking status and overlap checks, including setup and turnaround buffers.

Routes continue to use the existing PostgreSQL/API response shapes. The classes provide domain behavior without replacing the current persistence layer. Their behavior is covered by `backend/test/domain.test.js`.

Notes:
- The backend expects Postgres on the host port `55432` by default (mapped to container 5432). See `backend/.env` if you need to change it.
- Frontend dev server proxies `/api` to `http://localhost:3000` so API calls work without CORS changes.


## Useful commands & troubleshooting

- Show Postgres container logs:

```bash
docker-compose logs -f db
```

- If `npm run init-db` reports authentication/role errors, ensure:
	- You have run `docker-compose up -d db` and the container finished initialisation.
	- `backend/.env` matches the host/port the container exposes (default `DB_PORT=55432`).

- To completely recreate the Postgres data (will remove data):

```bash
docker-compose down -v
docker-compose up -d db
```

- If the backend connects to the wrong Postgres instance (e.g., local Postgres on 5432), change `backend/.env` `DB_HOST` to `127.0.0.1` and `DB_PORT` to `55432` to explicitly target the project container.

- If `npm run dev` reports `EADDRINUSE` on port 3000, another backend process is already running. Stop it, then start the backend once:

```bash
kill $(lsof -tiTCP:3000 -sTCP:LISTEN)
cd backend
npm run dev
```


## Save Draft Progress (US-004)

Event Organisers can select **Save Draft** on the request form, then reopen it
from **Dashboard > My Drafts**. Incomplete fields are allowed; populated fields
are validated. Successful saves keep the request in Draft status.

After pulling this change, run `npm run init-db` from `backend` once to add the
`events.draft_data` column to an existing database, then restart the backend.
The migration preserves existing records.

The draft API requires an Event Organiser JWT:
- `GET /api/drafts`: list the signed-in organiser's drafts.
- `GET /api/drafts/:id`: retrieve an owned draft.
- `PUT /api/drafts/:id`: save the complete current form using a stable UUID.

Draft form values are stored in `draft_data` exactly as entered, including
separate date/time fields, attendance placeholders and registration choices.
The event title is also updated for listing. Future submission code should
validate and map these draft values into the structured event fields.
Ownership and Draft status are enforced in the atomic write statement.
Missing and inaccessible draft IDs return the same generic response.

Run `npm test` in both `backend` and `frontend`. Backend tests require the
configured PostgreSQL database with the schema initialized; they use temporary
tables and roll back their fixtures. Frontend tests cover the form's save/load
logic; run `npm run build` in `frontend` to check template compilation.

Manual check:
1. Sign in as an Event Organiser and save only a purpose or start time.
2. Open My Drafts, reopen it, change values and save again.
3. Confirm the list still contains one request and its status is Draft.
4. Stop the backend, edit a field and try saving. The error should keep the
   input available. Restart the backend and retry.
5. Sign in as a different organiser and open the saved draft URL. Its contents
   must not be shown.

Draft scope clarification: US-004 uses the nine Week 4 field groups. Incomplete
values are allowed, and valid historical dates are allowed; no past-date
restriction is applied. Date formats, time formats and start/end ordering are
still validated. Event Type, Programme/Agenda and Special Arrangements are
outside this agreed draft scope.

## Technical Support Requirements (US-016)

Event Coordinators can open `/technical-support/requirements` from the dashboard to select an assigned event, choose multiple equipment types with quantities, and specify the number of technical support staff required. Saving replaces the previous requirements version for that event and notifies Technical Support Staff.

The equipment type `Other` includes a details field, so coordinators can describe equipment that is not covered by the standard list. A description is required when `Other` is selected.

Technical Support Staff can open `/technical-support/queue` to see the latest requirements for all events. Replaced requirements are marked **Updated**, and requirements saved after the event start time are marked **Late request**.

The US-016 schema is created by the normal initializer:

```bash
cd backend
npm run init-db
```

The coordinator dashboard also shows a summary of submitted technical support requirements, with a link back to the full management page. The coordinator form retains its input when a save fails and displays a retryable error.

## Notifications (US-002)

Authenticated users can click the bell icon in the header to view their notification list. Unread notifications show a count badge and a highlighted row; clicking a notification marks it as read. The list is loaded from `/api/notifications` for the signed-in user only, and read state is updated through `/api/notifications/:id/read` with ownership checks.

The implemented booking and technical-support triggers are targeted by role and event relationship:

- A submitted venue booking request notifies Venue Staff.
- A Venue Staff booking decision notifies the Coordinator who submitted that request.
- Updated technical-support requirements notify Technical Support Staff.

Notification responses include only the notification message and event identifier, not protected event details. Users must still pass the relevant authorization checks to view event information.

