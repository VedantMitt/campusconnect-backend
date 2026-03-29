# GitHub Copilot / Agent Instructions — campusconnect-backend

Purpose: give AI coding agents the minimal, actionable context to safely modify and extend the Express + TypeScript backend.

- **Big picture:** The backend is an Express app written in TypeScript. Entry: `src/index.ts` -> `src/app.ts` mounts routes. Primary routes:
  - `src/routes/auth.routes.ts` — user registration & join flows
  - `src/routes/activity.routes.ts` — activity CRUD and join logic
  - `src/middleware/auth.middleware.ts` — validates `Authorization: Bearer <token>` and sets `req.userId`
  - `src/db.ts` — exports a `pg` Pool; SQL queries use parameterized `$1` placeholders.

- **Run & debug:**
  - Install: `npm install` in `campusconnect-backend`
  - Dev: `npm run dev` (uses `ts-node-dev` to run `src/index.ts`)
  - Required env: `JWT_SECRET` (string), `DATABASE_URL` (Postgres connection string). Optional: `PORT`.

- **Conventions / patterns**
  - Routes export a default `Router` and are mounted in `app.ts`.
  - Use parameterized SQL queries with `pool.query(sql, [params])` — do not interpolate values directly.
  - Error handling: routes log errors with `console.error(...)` and return `500` with a JSON error message.
  - Auth: JWT payload contains `{ userId }` (middleware expects `id`/`userId` — the code reads `decoded.id` and sets `req.userId`). Keep JWT signing and verification consistent.

- **Integration notes**
  - DB SSL: `src/db.ts` sets `ssl: { rejectUnauthorized: false }` for hosted Postgres deployments — preserve when deploying to hosted DBs.
  - Schema expectations: `users` table derives `college` from email domain (`email.split('@')[1]`) during registration; `rooms`, `activity_members`, `room_members` are used in join flows.

- **Editing guidance for agents**
  - When adding endpoints, export them via a Router and mount in `src/app.ts`.
  - Keep SQL parameterized and return consistent JSON shapes (look at existing `res.json({ roomId })`, `res.json({ success: true })`).
  - For protected routes always use `authMiddleware` as the first middleware.

Examples (local testing):

Start backend (from workspace root):
```bash
cd campusconnect-backend
npm install
export JWT_SECRET=devsecret
export DATABASE_URL="postgres://user:pass@localhost:5432/dbname"
npm run dev
```

Call protected route (example):
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:5000/activities
```

Files to inspect first: `src/index.ts`, `src/app.ts`, `src/db.ts`, `src/middleware/auth.middleware.ts`, `src/routes/*.ts`.
