# ConnectSphere Backend

Minimal Express backend to connect to PostgreSQL and run the provided schema initializer.

Quick start (requires Node.js installed):

```bash
cd backend
npm install
# ensure POSTGRES is running (eg. `docker-compose up -d db`)
npm run init-db   # runs SQL schema against DB
npm run dev       # start server with nodemon
```

API endpoints:
- `GET /api/health` - health check
- `POST /api/init` - (dev) run schema SQL (same as `init-db`)
