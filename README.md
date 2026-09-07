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

If you want, I can also add a small `Makefile` with these commands or a profile-based compose to toggle services; tell me which you prefer.
