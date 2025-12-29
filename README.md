# CardSnipe 🃏

Real-time sports card deal finder for basketball and baseball cards.

## Quick Start

### 1. Get eBay API Keys
1. Go to [developer.ebay.com](https://developer.ebay.com)
2. Create Application → Get **Production** keys
3. Note your Client ID and Client Secret

### 2. Set Up Database
Option A: **Supabase** (easiest, free tier)
```bash
# Create project at supabase.com
# Copy connection string from Settings > Database
```

Option B: **Local PostgreSQL**
```bash
createdb cardsnipe_dev
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your API keys and database URL
```

### 4. Install & Run
```bash
# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Start the API server
npm run dev

# In another terminal: start the worker
npm run worker
```

### 5. Connect Frontend
Update your React app to point to `http://localhost:3001/api`

## Architecture

```
cardsnipe-production/
├── src/
│   ├── server.js      # Express API + WebSocket server
│   ├── worker.js      # Background job that fetches listings
│   ├── services/
│   │   ├── ebay.js    # eBay Browse API integration
│   │   └── pricing.js # Market value lookups & deal scores
│   └── db/
│       └── index.js   # Database connection
├── .env.example       # Environment template
└── package.json
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/deals` | Get all active deals (with filters) |
| `GET /api/deals/:id` | Single listing details |
| `GET /api/stats` | Dashboard statistics |
| `POST /api/watchlist` | Add player to watchlist |
| `WebSocket /` | Real-time deal updates |

## Costs Estimate

| Service | Free Tier | Paid |
|---------|-----------|------|
| Supabase DB | 500MB | $25/mo |
| Railway/Render | 500hrs/mo | $5-20/mo |
| Upstash Redis | 10k cmds/day | $0.20/100k |
| eBay API | 5k calls/day | Contact eBay |

**Total: $0-50/month** depending on scale.

## Next Steps

1. ✅ Get eBay API keys
2. ✅ Set up database
3. ⬜ Deploy backend to Railway/Render
4. ⬜ Deploy frontend to Vercel
5. ⬜ Add more players to monitor
6. ⬜ Set up email alerts for hot deals
7. ⬜ Add eBay affiliate links for revenue

## Support

Questions? Open an issue or reach out!
