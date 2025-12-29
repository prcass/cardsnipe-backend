console.log("Starting CardSnipe server...");
import dotenv from "dotenv";
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { EbayClient } from './services/ebay.js';
import { PriceService } from './services/pricing.js';
import { db } from './db/index.js';
import crypto from 'crypto';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || '*' }
});

app.use(cors());
app.use(express.json());

// Initialize services
const ebay = new EbayClient();
const pricing = new PriceService();

// ============================================
// REST API ENDPOINTS
// ============================================

// Get all current deals with filters
app.get('/api/deals', async (req, res) => {
  try {
    const {
      sport,
      type, // 'auction' | 'buyNow' | 'all'
      minDealScore = 0,
      search,
      grade,
      sortBy = 'dealScore',
      limit = 50,
      offset = 0
    } = req.query;

    let query = db('listings')
      .where('is_active', true)
      .where('deal_score', '>=', parseInt(minDealScore));

    if (sport && sport !== 'all') {
      query = query.where('sport', sport);
    }

    if (type === 'auction') {
      query = query.where('is_auction', true);
    } else if (type === 'buyNow') {
      query = query.where('is_auction', false);
    }

    if (search) {
      query = query.whereRaw(
        'LOWER(title) LIKE ?',
        [`%${search.toLowerCase()}%`]
      );
    }

    if (grade === 'graded') {
      query = query.whereNot('grade', 'Raw');
    } else if (grade === 'raw') {
      query = query.where('grade', 'Raw');
    }

    // Sorting
    if (sortBy === 'dealScore') {
      query = query.orderBy('deal_score', 'desc');
    } else if (sortBy === 'endingSoon') {
      query = query.orderBy('auction_end_time', 'asc');
    } else if (sortBy === 'priceLow') {
      query = query.orderBy('current_price', 'asc');
    }

    const deals = await query.limit(parseInt(limit)).offset(parseInt(offset));

    res.json({
      success: true,
      count: deals.length,
      data: deals
    });
  } catch (error) {
    console.error('Error fetching deals:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single listing details
app.get('/api/deals/:id', async (req, res) => {
  try {
    const listing = await db('listings')
      .where('id', req.params.id)
      .first();

    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    // Get price history for this card
    const priceHistory = await db('market_values')
      .where('card_id', listing.card_id)
      .orderBy('last_updated', 'desc')
      .limit(30);

    res.json({
      success: true,
      data: { ...listing, priceHistory }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get market value for a specific card
app.get('/api/market-value', async (req, res) => {
  try {
    const { player, year, set, grade } = req.query;

    // Check cache first
    const cached = await db('market_values')
      .join('cards', 'cards.id', 'market_values.card_id')
      .where('cards.player_name', 'ilike', `%${player}%`)
      .where('market_values.grade', grade || 'Raw')
      .where('market_values.last_updated', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .first();

    if (cached) {
      return res.json({ success: true, data: cached, source: 'cache' });
    }

    // Fetch fresh data
    const marketValue = await pricing.getMarketValue({ player, year, set, grade });

    res.json({
      success: true,
      data: marketValue,
      source: 'fresh'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// User watchlist
app.post('/api/watchlist', async (req, res) => {
  try {
    const { userId, playerName, minDealScore = 20 } = req.body;

    const [watchItem] = await db('user_watchlists')
      .insert({
        user_id: userId,
        player_name: playerName,
        min_deal_score: minDealScore
      })
      .returning('*');

    res.json({ success: true, data: watchItem });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Clear all listings (for removing demo/test data)
app.delete('/api/clear-data', async (req, res) => {
  try {
    const deleted = await db('listings').del();
    console.log('Cleared ' + deleted + ' listings from database');
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('Error clearing data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ============================================
// EBAY MARKETPLACE ACCOUNT DELETION WEBHOOK
// ============================================

const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || 'cardsnipe_verification_token_2024_ebay_marketplace';

// GET - eBay challenge verification
app.get('/api/ebay/deletion', (req, res) => {
  const challengeCode = req.query.challenge_code;
  if (!challengeCode) {
    return res.status(400).json({ error: 'Missing challenge_code' });
  }
  const endpoint = process.env.EBAY_WEBHOOK_URL || 'https://' + req.get('host') + '/api/ebay/deletion';
  const hash = crypto.createHash('sha256').update(challengeCode + EBAY_VERIFICATION_TOKEN + endpoint).digest('hex');
  console.log('eBay verification challenge received');
  res.json({ challengeResponse: hash });
});

// POST - Receive deletion notifications
app.post('/api/ebay/deletion', (req, res) => {
  console.log('eBay deletion notification:', JSON.stringify(req.body));
  res.status(200).json({ success: true });
});


// ============================================
// SETTINGS API
// ============================================

// In-memory settings (persists until restart, could use DB for persistence)
let appSettings = {
  maxPrice: 500,        // Maximum price to search for
  minDealScore: 10,     // Minimum deal score to save
  scanInterval: 5       // Minutes between scans
};

// Get current settings
app.get('/api/settings', (req, res) => {
  res.json({ success: true, data: appSettings });
});

// Update settings
app.post('/api/settings', (req, res) => {
  const { maxPrice, minDealScore, scanInterval } = req.body;

  if (maxPrice !== undefined) appSettings.maxPrice = Number(maxPrice);
  if (minDealScore !== undefined) appSettings.minDealScore = Number(minDealScore);
  if (scanInterval !== undefined) appSettings.scanInterval = Number(scanInterval);

  console.log('Settings updated:', appSettings);
  res.json({ success: true, data: appSettings });
});

// Export settings for worker to use
export function getSettings() {
  return appSettings;
}

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db('listings')
      .where('is_active', true)
      .select(
        db.raw('COUNT(*) as total_deals'),
        db.raw('COUNT(*) FILTER (WHERE deal_score >= 30) as hot_deals'),
        db.raw('COUNT(*) FILTER (WHERE is_auction AND auction_end_time < NOW() + INTERVAL \'1 hour\') as ending_soon'),
        db.raw('SUM(market_value - current_price) as total_potential_profit'),
        db.raw('AVG(deal_score) as avg_deal_score')
      )
      .first();

    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// WEBSOCKET FOR REAL-TIME UPDATES
// ============================================

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join room based on filters
  socket.on('subscribe', (filters) => {
    const room = `deals:${filters.sport || 'all'}:${filters.type || 'all'}`;
    socket.join(room);
    console.log(`${socket.id} joined ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Broadcast new deals to connected clients
export function broadcastDealUpdate(deal) {
  const rooms = [
    `deals:all:all`,
    `deals:${deal.sport}:all`,
    `deals:all:${deal.is_auction ? 'auction' : 'buyNow'}`,
    `deals:${deal.sport}:${deal.is_auction ? 'auction' : 'buyNow'}`
  ];

  rooms.forEach(room => {
    io.to(room).emit('deal:update', deal);
  });
}

export function broadcastNewDeal(deal) {
  io.emit('deal:new', deal);
}

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 CardSnipe API running on port ${PORT}`);
});

export { app, io };
