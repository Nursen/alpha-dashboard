# Deployment Guide

## Prerequisites
- GitHub account
- Vercel account (free) -- vercel.com
- Railway account (free) -- railway.app
- MongoDB Atlas account (free) -- mongodb.com/atlas

## Step 1: Push to GitHub

1. Create a new repo on GitHub (e.g., `alpha-dashboard`)
2. From the portfolio-dashboard directory:
   ```bash
   git init
   git add .
   git commit -m "Alpha Dashboard v1.0"
   git remote add origin https://github.com/YOUR_USERNAME/alpha-dashboard.git
   git push -u origin main
   ```

## Step 2: Set up MongoDB Atlas (free tier)

1. Go to mongodb.com/atlas -> Create free account
2. Create a free cluster (M0, AWS, us-east-1)
3. Create a database user (username/password)
4. Add 0.0.0.0/0 to Network Access (allows Railway to connect)
5. Click "Connect" -> "Connect your application" -> Copy the connection string
6. Replace `<password>` with your actual password
7. Save this as your MONGODB_URI

## Step 3: Deploy Backend on Railway

1. Go to railway.app -> New Project -> Deploy from GitHub repo
2. Select your repo, set the root directory to `backend`
3. Add environment variables:
   - `MONGODB_URI` = your Atlas connection string
   - `DB_NAME` = alpha_dashboard
   - `ALLOWED_ORIGINS` = https://your-app.vercel.app
   - `PORT` = 8000
4. Railway will auto-detect Python and deploy
5. Copy your Railway public URL (e.g., https://alpha-dashboard-api.up.railway.app)

## Step 4: Seed the database

```bash
MONGODB_URI="your_atlas_connection_string" python backend/seed_data.py
```

## Step 5: Deploy Frontend on Vercel

1. Go to vercel.com -> New Project -> Import GitHub repo
2. Set root directory to `frontend`
3. Framework preset: Vite
4. Add environment variable:
   - `VITE_API_URL` = https://your-railway-url.up.railway.app/api
5. Deploy!

## Step 6: Update CORS

Go back to Railway and update ALLOWED_ORIGINS to include your actual Vercel URL.

## Sharing with team

Share the Vercel URL with your team. They can access the dashboard from any browser.
For now, auth is in dev bypass mode -- anyone with the URL can access it.

## Troubleshooting

**Backend not starting?**
- Check Railway logs for import errors
- Make sure all env vars are set
- Verify MONGODB_URI is correct (try connecting from local first)

**CORS errors?**
- Make sure ALLOWED_ORIGINS on Railway includes your exact Vercel URL (no trailing slash)
- Any *.vercel.app preview URL is automatically allowed

**Data not showing?**
- Run the seed script (Step 4) after MongoDB is set up
- Without MongoDB, data is ephemeral on Railway (resets on each deploy)
