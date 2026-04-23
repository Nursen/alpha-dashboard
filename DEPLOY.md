# Deployment Guide — Vercel (single platform)

Everything deploys to Vercel: frontend (Vite/React) as static files, backend (FastAPI) as a Python serverless function.

## Prerequisites
- GitHub account
- Vercel account (free) — vercel.com

## Step 1: Push to GitHub

```bash
cd portfolio-dashboard
git init
git add .
git commit -m "Alpha Dashboard v1.0"
git remote add origin https://github.com/YOUR_USERNAME/alpha-dashboard.git
git push -u origin main
```

## Step 2: Deploy on Vercel

1. Go to vercel.com -> New Project -> Import your GitHub repo
2. **Root directory**: leave as `.` (project root, NOT frontend/)
3. **Framework preset**: Other (or leave auto-detected)
4. No environment variables needed for basic setup
5. Click Deploy

Vercel will:
- Build the frontend (`cd frontend && npm install && npm run build`)
- Serve static files from `frontend/dist/`
- Route `/api/*` requests to the Python serverless function

## Step 3: Share with team

Share the Vercel URL. Anyone with the link can access the dashboard.

## How it works

| Component | How it deploys |
|-----------|---------------|
| Frontend (React/Vite) | Built to `frontend/dist/`, served as static files |
| Backend (FastAPI) | `api/index.py` wraps the FastAPI app as a Vercel serverless function |
| Database | JSON file fallback (ephemeral — data resets on cold starts) |
| SPA routing | Catch-all rewrite to `/index.html` |

## Environment variables (optional)

Set these in Vercel dashboard -> Settings -> Environment Variables if needed:

| Variable | Purpose | Default |
|----------|---------|---------|
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | `http://localhost:5173,http://localhost:5174` |
| `MONGODB_URI` | MongoDB connection string | Empty (uses JSON fallback) |
| `DB_NAME` | MongoDB database name | `alpha_dashboard` |

Note: On Vercel serverless, the filesystem is read-only except `/tmp`. The JSON file DB works per-invocation but data won't persist across cold starts. This is fine for the class demo. For persistent data, set up MongoDB Atlas (free tier) and add the `MONGODB_URI` env var.

## Local development

Local dev still works the same way:

```bash
# Terminal 1: Backend
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev
```

The Vite dev server proxies `/api/*` to `localhost:8000` automatically.

## Troubleshooting

**Build fails?**
- Check that `frontend/package.json` has a valid `build` script
- Check Vercel build logs for missing dependencies

**API returns 500?**
- Check Vercel function logs (Vercel dashboard -> Deployments -> Functions tab)
- Most likely a missing Python dependency — check `requirements.txt` at project root

**CORS errors?**
- Any `*.vercel.app` origin is automatically allowed
- For custom domains, add them to `ALLOWED_ORIGINS` env var
