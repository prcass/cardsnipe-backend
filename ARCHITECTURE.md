# CardSnipe: Production Architecture Guide

## Overview

To make CardSnipe production-ready, you need 4 core components:

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│                 (React App - You have this!)                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │ WebSocket + REST API
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND SERVER                              │
│              (Node.js/Express or Python/FastAPI)                 │
│  • eBay OAuth handling                                           │
│  • Deal score calculation                                        │
│  • WebSocket for real-time updates                               │
│  • User auth & watchlists                                        │
└───────┬─────────────────┬─────────────────┬─────────────────────┘
        │                 │                 │
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   DATABASE    │ │  REDIS CACHE  │ │  JOB QUEUE    │
│  (PostgreSQL) │ │  (Hot deals)  │ │  (Bull/Celery)│
└───────────────┘ └───────────────┘ └───────────────┘
        │                 │                 │
        └─────────────────┴─────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA FETCHER WORKERS                         │
│  • eBay Browse API polling (every 1-5 min)                       │
│  • Price guide scraping/API calls                                │
│  • Deal score recalculation                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Get Your API Keys

### eBay Developer Account (Required)
1. Go to https://developer.ebay.com
2. Create account → Create Application
3. Get **Production** keys (not Sandbox)
4. You'll receive:
   - `Client ID` (App ID)
   - `Client Secret` (Cert ID)
5. Set up OAuth: You need "Browse API" access

### Price Data Sources (Pick 1-2)
| Source | Type | Cost | Best For |
|--------|------|------|----------|
| **PSA Price Guide** | Official API | $$ | Graded card values |
| **130point.com** | Scraping | Free | eBay sold comps |
| **Market Movers** | API | $$ | Real-time market data |
| **CardLadder** | API | $$$ | Premium analytics |
| **PriceCharting** | API | Free tier | Quick lookups |

---

## Step 2: Database Schema

```sql
-- Core tables you'll need

CREATE TABLE cards (
  id SERIAL PRIMARY KEY,
  sport VARCHAR(20),
  player_name VARCHAR(100),
  year INTEGER,
  set_name VARCHAR(100),
  card_number VARCHAR(20),
  parallel VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE market_values (
  id SERIAL PRIMARY KEY,
  card_id INTEGER REFERENCES cards(id),
  grade VARCHAR(20),
  market_value DECIMAL(10,2),
  source VARCHAR(50),
  last_updated TIMESTAMP DEFAULT NOW()
);

CREATE TABLE listings (
  id SERIAL PRIMARY KEY,
  card_id INTEGER REFERENCES cards(id),
  ebay_item_id VARCHAR(50) UNIQUE,
  platform VARCHAR(20) DEFAULT 'ebay',
  title VARCHAR(200),
  current_price DECIMAL(10,2),
  is_auction BOOLEAN,
  auction_end_time TIMESTAMP,
  bid_count INTEGER,
  grade VARCHAR(20),
  market_value DECIMAL(10,2),
  deal_score INTEGER,
  image_url TEXT,
  listing_url TEXT,
  seller_name VARCHAR(100),
  seller_rating DECIMAL(3,2),
  is_active BOOLEAN DEFAULT true,
  first_seen TIMESTAMP DEFAULT NOW(),
  last_updated TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_watchlists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  player_name VARCHAR(100),
  min_deal_score INTEGER DEFAULT 20,
  notify_email BOOLEAN DEFAULT true,
  notify_push BOOLEAN DEFAULT false
);

-- Indexes for fast queries
CREATE INDEX idx_listings_deal_score ON listings(deal_score DESC);
CREATE INDEX idx_listings_auction_end ON listings(auction_end_time);
CREATE INDEX idx_listings_active ON listings(is_active);
```

---

## Step 3: Backend Implementation

### Tech Stack Recommendation
- **Runtime**: Node.js 20+ or Python 3.11+
- **Framework**: Express/Fastify or FastAPI
- **Database**: PostgreSQL (Supabase or Railway for easy hosting)
- **Cache**: Redis (Upstash for serverless)
- **Job Queue**: BullMQ (Node) or Celery (Python)
- **Hosting**: Railway, Render, or Fly.io (~$5-20/month)

### Key API Endpoints
```
GET  /api/deals              - Get current deals (with filters)
GET  /api/deals/:id          - Single listing details
GET  /api/deals/stream       - WebSocket for real-time updates
POST /api/watchlist          - Add to watchlist
GET  /api/market-value/:card - Get market value for a card
```

---

## Step 4: eBay API Integration

### Authentication Flow
eBay uses OAuth 2.0 Client Credentials for Browse API:

```
1. Base64 encode: {Client ID}:{Client Secret}
2. POST to https://api.ebay.com/identity/v1/oauth2/token
3. Get access_token (valid 2 hours)
4. Use token in Browse API calls
```

### Key Browse API Endpoints
```
GET /buy/browse/v1/item_summary/search
  ?q=lebron+james+prizm+psa+10
  &category_ids=212  (Sports Trading Cards)
  &filter=buyingOptions:{FIXED_PRICE|AUCTION}
  &filter=price:[50..500]
  &sort=endingSoonest
  &limit=50
```

---

## Step 5: Deal Score Algorithm

```javascript
function calculateDealScore(listing, marketValue) {
  // Base discount percentage
  const discount = (marketValue - listing.price) / marketValue;
  
  // Adjustments
  let score = discount * 100;
  
  // Boost for auctions ending soon with low bids
  if (listing.isAuction) {
    const hoursLeft = (listing.endTime - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft < 1 && listing.bidCount < 5) score += 10;
    if (hoursLeft < 0.25) score += 15; // Last 15 min!
  }
  
  // Boost for high-rated sellers
  if (listing.sellerRating > 99) score += 5;
  
  // Penalize if market data is stale
  if (marketDataAge > 7) score -= 10;
  
  return Math.min(Math.max(Math.round(score), 0), 100);
}
```

---

## Step 6: Deployment Checklist

### Environment Variables
```env
# eBay API
EBAY_CLIENT_ID=your_client_id
EBAY_CLIENT_SECRET=your_client_secret
EBAY_ENVIRONMENT=PRODUCTION

# Database
DATABASE_URL=postgresql://user:pass@host:5432/cardsnipe

# Redis
REDIS_URL=redis://...

# Optional: Price APIs
PSA_API_KEY=...
CARDLADDER_API_KEY=...
```

### Recommended Hosting Stack
| Component | Service | Cost |
|-----------|---------|------|
| Backend | Railway / Render | $5-20/mo |
| Database | Supabase / Railway | Free-$25/mo |
| Redis | Upstash | Free tier |
| Frontend | Vercel / Netlify | Free |
| Domain | Namecheap | $10/yr |

---

## Step 7: Scaling Considerations

### When you get traction:
1. **Rate Limits**: eBay allows 5,000 calls/day on basic tier. Cache aggressively.
2. **Background Jobs**: Use workers to fetch data, not API endpoints.
3. **WebSockets**: Use Socket.io or Pusher for real-time updates.
4. **Mobile App**: React Native shares most of this codebase.

### Revenue Ideas
- Premium tier with faster alerts
- Affiliate links to eBay (eBay Partner Network)
- Sponsored placement for card shops
- Historical analytics dashboard

---

## Quick Start Commands

```bash
# Clone and setup
git clone <your-repo>
cd cardsnipe-backend
npm install

# Set up database
npx prisma migrate dev

# Start development
npm run dev

# Start worker (separate terminal)
npm run worker
```

---

## Need Help?

Key resources:
- eBay Browse API Docs: https://developer.ebay.com/api-docs/buy/browse/overview.html
- PSA Price Guide: https://www.psacard.com/auctionprices
- 130point (free comps): https://130point.com/sales/
