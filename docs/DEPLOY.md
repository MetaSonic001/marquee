# Deploy (no Docker)

## 1. Database — Supabase
Use the **session pooler** URL (IPv4): `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. Tables are created on startup.

## 2. Backend — Render (native Python)
1. Push the repo to GitHub.
2. Render → **New → Blueprint** → select the repo. `render.yaml` creates `marquee-api` (rootDir `apps/api`).
3. Fill the secret env vars: `QLOO_API_KEY`, `GROQ_API_KEY`, `DATABASE_URL`, `FRONTEND_ORIGIN` (your Vercel URL, comma-separated if several).
4. The build runs `render-build.sh`: `pip install`, a Node 22 download into `./.node` if Render's Node is older than 22.19, `npm install` of `@qloo/qloo-harness`, and it logs `node --version` / `qloo --version`.
5. Start: `uvicorn app.main:app --workers 1`, with `./.node/bin` on `PATH`.
6. Check `https://<service>.onrender.com/health` → `{"ok":true,"db":true,"qloo_ready":true}`.
7. The demo data already lives in Supabase (seeded locally), so there's nothing to seed on Render.

**Free-tier notes:** about 512 MB RAM — single worker, PDF pages rendered one at a time at 110 DPI, images downscaled, small LRU only. The service sleeps after 15 minutes idle: add a free keep-alive ping (cron-job.org or UptimeRobot) to `/health` every 10 minutes during judging. The frontend shows "Waking up the stage…" while it boots. If memory or cold starts hurt, switch the same service to the **Starter** plan with no code changes.

## 3. Frontend — Vercel
1. Vercel → **New Project** → import the repo → Root Directory **`apps/web`** (framework auto-detected: Next.js).
2. Env var: `NEXT_PUBLIC_API_URL=https://<service>.onrender.com`
3. Deploy, then put the Vercel URL into Render's `FRONTEND_ORIGIN` and redeploy the API. `*.vercel.app` URLs starting with `marquee` are also allowed by a CORS regex.

## Memory check
Run an intake with a 15 MB PDF + 5 images while watching RSS (`app/memlog.py` logs RSS incl. the `qloo mcp` child at every pipeline stage). Locally the steady state is uvicorn ≈ 150 MB + qloo mcp ≈ 90 MB.
