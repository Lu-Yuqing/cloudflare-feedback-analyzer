# Feedback Aggregation & Analysis Tool

A Cloudflare Workers application that aggregates and analyzes product feedback using AI.

## Live Demo

https://feedback-aggregator.brittany-cloudflare.workers.dev

## Architecture

Built with Cloudflare Developer Platform:
- **Workers** - Serverless application runtime
- **D1 Database** - Feedback data storage
- **Workflows** - Orchestrate feedback processing pipeline
- **Workers AI** - Sentiment analysis & topic extraction

## Tech Stack

- TypeScript
- Cloudflare Workers
- Tailwind CSS (via CDN)
- Chart.js (via CDN)

## Setup

```bash
npm install
npm run db:create
npm run db:migrate
npm run dev
```

## Deploy

```bash
npx wrangler deploy
```

## Project Structure

```
/src
  - index.ts       # Main Worker & API endpoints
  - workflow.ts    # Feedback processing workflow
schema.sql         # Database schema
seed.sql           # Mock data
wrangler.toml      # Cloudflare configuration
```

## Features

- Real-time feedback aggregation
- AI-powered sentiment analysis
- Interactive dashboard with charts
- AI chat interface for insights
- Multi-source feedback support

---

Built for Cloudflare Product Manager Intern Assignment (2026)