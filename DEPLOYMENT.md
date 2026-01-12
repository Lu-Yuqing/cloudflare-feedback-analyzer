# Quick Deployment Guide

## Prerequisites

1. Cloudflare account with Workers enabled
2. Node.js 18+ installed
3. Wrangler CLI installed globally: `npm install -g wrangler`

## Step-by-Step Deployment

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Create D1 Database

```bash
wrangler d1 create feedback-db
```

Copy the `database_id` from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "feedback-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

### 4. Initialize Database

```bash
wrangler d1 execute feedback-db --file=./schema.sql
wrangler d1 execute feedback-db --file=./seed.sql
```

### 5. Enable Workers AI

1. Go to Cloudflare Dashboard → Workers & Pages
2. Navigate to Workers AI section
3. Enable Workers AI for your account (if not already enabled)

### 6. Deploy

```bash
wrangler deploy
```

### 7. Test Locally (Optional)

```bash
wrangler dev
```

Visit `http://localhost:8787` to see the dashboard.

## Post-Deployment

1. Access your deployed Worker URL (shown after deployment)
2. The dashboard should load with mock data
3. Use "Process Pending" button to analyze feedback with AI
4. Try the AI chat interface to ask questions about feedback

## Troubleshooting

### Workers AI Not Working

- Ensure Workers AI is enabled in your Cloudflare account
- Check that you have sufficient Workers AI credits
- Verify the model names are correct (they may vary by region)

### Database Issues

- Verify database ID in `wrangler.toml` matches your created database
- Run migrations again if schema errors occur
- Check database is accessible: `wrangler d1 execute feedback-db --command="SELECT COUNT(*) FROM feedback"`

### Deployment Errors

- Ensure all dependencies are installed
- Check `wrangler.toml` syntax is correct
- Verify you're logged in: `wrangler whoami`