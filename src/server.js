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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const teamRosters = JSON.parse(readFileSync(join(__dirname, 'data/team-rosters.json'), 'utf-8'));

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
    let deletedListings = 0;
    let deletedScanLog = 0;

    // Delete listings
    try {
      deletedListings = await db('listings').del();
    } catch (e) {
      console.log('Could not clear listings:', e.message);
    }

    // Delete scan_log (table might not exist in older deployments)
    try {
      deletedScanLog = await db('scan_log').del();
    } catch (e) {
      console.log('Could not clear scan_log:', e.message);
    }

    // Reset scan counter
    scanCounter.total = 0;
    scanCounter.lastReset = new Date();
    console.log('Cleared ' + deletedListings + ' listings, ' + deletedScanLog + ' scan log entries, reset scan counter');
    res.json({ success: true, deleted: deletedListings, scanLogDeleted: deletedScanLog });
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
  minPrice: 0,          // Minimum price to search for
  maxPrice: 500,        // Maximum price to search for
  minDealScore: 10,     // Minimum deal score to save
  scanInterval: 5,      // Minutes between scans
  cardYear: null        // Filter to specific card year (null = all years)
};

// Scan counter (tracks cards scanned since last reset)
let scanCounter = {
  total: 0,
  lastReset: new Date()
};

// Get current settings
app.get('/api/settings', (req, res) => {
  res.json({ success: true, data: appSettings });
});

// Update settings
app.post('/api/settings', (req, res) => {
  const { minPrice, maxPrice, minDealScore, scanInterval, cardYear } = req.body;

  if (minPrice !== undefined) appSettings.minPrice = Number(minPrice);
  if (maxPrice !== undefined) appSettings.maxPrice = Number(maxPrice);
  if (minDealScore !== undefined) appSettings.minDealScore = Number(minDealScore);
  if (scanInterval !== undefined) appSettings.scanInterval = Number(scanInterval);
  if (cardYear !== undefined) appSettings.cardYear = cardYear ? Number(cardYear) : null;

  console.log('Settings updated:', appSettings);
  res.json({ success: true, data: appSettings });
});

// Export settings for worker to use
export function getSettings() {
  return appSettings;
}

// ============================================
// SCAN COUNTER API
// ============================================

// Get scan count
app.get('/api/scan-count', (req, res) => {
  res.json({ success: true, data: scanCounter });
});

// Increment scan count (called by worker)
app.post('/api/scan-count/increment', (req, res) => {
  const { count = 1 } = req.body;
  scanCounter.total += count;
  res.json({ success: true, data: scanCounter });
});

// Reset scan count
app.post('/api/scan-count/reset', (req, res) => {
  scanCounter.total = 0;
  scanCounter.lastReset = new Date();
  res.json({ success: true, data: scanCounter });
});

// ============================================
// SCAN LOG & REPORTING API
// ============================================

// Get scan log with filters
app.get('/api/scan-log', async (req, res) => {
  try {
    const {
      outcome,       // 'rejected', 'saved', 'matched', 'all'
      sport,
      limit = 100,
      offset = 0
    } = req.query;

    let query = db('scan_log').orderBy('scanned_at', 'desc');

    if (outcome && outcome !== 'all') {
      query = query.where('outcome', outcome);
    }

    if (sport && sport !== 'all') {
      query = query.where('sport', sport);
    }

    const logs = await query.limit(parseInt(limit)).offset(parseInt(offset));
    const total = await db('scan_log').count('* as count').first();

    res.json({
      success: true,
      count: logs.length,
      total: parseInt(total.count),
      data: logs
    });
  } catch (error) {
    console.error('Error fetching scan log:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get scan log summary stats
app.get('/api/scan-log/stats', async (req, res) => {
  try {
    const stats = await db('scan_log')
      .select('outcome')
      .count('* as count')
      .groupBy('outcome');

    const byReason = await db('scan_log')
      .where('outcome', 'rejected')
      .select('reject_reason')
      .count('* as count')
      .groupBy('reject_reason')
      .orderBy('count', 'desc')
      .limit(10);

    res.json({
      success: true,
      data: {
        byOutcome: stats,
        topRejectReasons: byReason
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Report a bad deal/mismatch
app.post('/api/report', async (req, res) => {
  try {
    const { listingId, ebayUrl, scpUrl, issue, notes } = req.body;

    await db('reported_issues').insert({
      listing_id: listingId || null,
      ebay_url: ebayUrl,
      scp_url: scpUrl,
      issue: issue,  // 'wrong_parallel', 'wrong_price', 'wrong_year', 'other'
      notes: notes,
      created_at: new Date()
    });

    res.json({ success: true, message: 'Report submitted' });
  } catch (error) {
    // Table might not exist yet
    console.error('Error saving report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get reported issues
app.get('/api/reports', async (req, res) => {
  try {
    const reports = await db('reported_issues')
      .orderBy('created_at', 'desc')
      .limit(50);

    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// MONITORED PLAYERS API
// ============================================

// Get all monitored players
app.get('/api/players', async (req, res) => {
  try {
    const players = await db('monitored_players')
      .orderBy('sport')
      .orderBy('name');
    res.json({ success: true, data: players });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a new player to monitor
app.post('/api/players', async (req, res) => {
  try {
    const { name, sport } = req.body;
    if (!name || !sport) {
      return res.status(400).json({ success: false, error: 'Name and sport are required' });
    }

    // Check if player already exists
    const existing = await db('monitored_players')
      .where({ name: name.trim(), sport: sport.toLowerCase() })
      .first();

    if (existing) {
      return res.status(400).json({ success: false, error: 'Player already exists' });
    }

    const [player] = await db('monitored_players')
      .insert({ name: name.trim(), sport: sport.toLowerCase(), active: true })
      .returning('*');

    console.log(`Added player: ${name} (${sport})`);
    res.json({ success: true, data: player });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle player active status
app.patch('/api/players/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const [player] = await db('monitored_players')
      .where({ id })
      .update({ active })
      .returning('*');

    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    console.log(`Player ${player.name} ${active ? 'enabled' : 'disabled'}`);
    res.json({ success: true, data: player });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a player
app.delete('/api/players/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const player = await db('monitored_players').where({ id }).first();
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    await db('monitored_players').where({ id }).del();
    console.log(`Deleted player: ${player.name}`);
    res.json({ success: true, message: `Deleted ${player.name}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// TEAM ROSTER API
// ============================================

// Get all teams grouped by sport
app.get('/api/teams', (req, res) => {
  const teams = {
    basketball: Object.keys(teamRosters.nba).sort(),
    baseball: Object.keys(teamRosters.mlb).sort()
  };
  res.json({ success: true, data: teams });
});

// Get players for a specific team
app.get('/api/teams/:sport/:team', (req, res) => {
  const { sport, team } = req.params;
  const sportKey = sport === 'basketball' ? 'nba' : sport === 'baseball' ? 'mlb' : 'nfl';
  const players = teamRosters[sportKey]?.[team];

  if (!players) {
    return res.status(404).json({ success: false, error: 'Team not found' });
  }

  res.json({ success: true, data: players });
});

// Import all players from a team
app.post('/api/players/import-team', async (req, res) => {
  try {
    const { sport, team } = req.body;
    if (!sport || !team) {
      return res.status(400).json({ success: false, error: 'Sport and team are required' });
    }

    const sportKey = sport === 'basketball' ? 'nba' : sport === 'baseball' ? 'mlb' : 'nfl';
    const players = teamRosters[sportKey]?.[team];

    if (!players) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    let added = 0;
    let skipped = 0;

    for (const name of players) {
      // Check if player already exists
      const existing = await db('monitored_players')
        .where({ name, sport })
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      await db('monitored_players').insert({ name, sport, active: true });
      added++;
    }

    console.log(`Imported ${team}: ${added} added, ${skipped} already existed`);
    res.json({
      success: true,
      message: `Added ${added} players from ${team}`,
      added,
      skipped
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
