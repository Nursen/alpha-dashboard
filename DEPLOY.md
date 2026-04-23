# Deployment Guide — Vercel + Railway

Frontend on Vercel (free), backend on Railway (free tier).

## Step 1: Deploy Backend on Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select `Nursen/alpha-dashboard`
3. Set **Root Directory** to `backend`
4. Railway auto-detects the `Procfile` and `requirements.txt`
5. Add environment variable: `ALLOWED_ORIGINS` = your Vercel URL (once you have it)
6. Deploy — you'll get a URL like `alpha-dashboard-production.up.railway.app`

## Step 2: Deploy Frontend on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → Import `Nursen/alpha-dashboard`
2. **Root Directory**: `.` (project root)
3. **Framework Preset**: Other
4. Add environment variable:
   - `VITE_API_URL` = `https://YOUR-RAILWAY-URL.up.railway.app/api`
5. Deploy

## Step 3: Update CORS

Go back to Railway → Variables → set:
```
ALLOWED_ORIGINS=https://your-app.vercel.app
```

## Step 4: Share with team

Share the Vercel URL. That's it.

## Local development

```bash
# Terminal 1: Backend
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev
```

Vite proxies `/api/*` to `localhost:8000` automatically.
