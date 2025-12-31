/**
 * Background Worker - Multi-Source Card Scanner
 */

import dotenv from 'dotenv';
dotenv.config();

import { EbayClient } from './services/ebay.js';
import { COMCClient } from './services/comc.js';
import { Scraper130Point } from './services/scraper130point.js';
import { PriceService } from './services/pricing.js';
import { db } from './db/index.js';

const ebay = new EbayClient();
const comc = new COMCClient();
const scraper130 = new Scraper130Point();
const pricing = new PriceService();

const hasEbayKeys = process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET;

// Default settings (can be overridden via API)
let settings = {
  minPrice: 0,
  maxPrice: 500,
  minDealScore: 10,
  cardYear: null
};

// Fetch settings from server API
async function fetchSettings() {
  try {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
    const response = await fetch(serverUrl + '/api/settings');
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        settings = data.data;
        console.log('Settings loaded: minPrice=' + settings.minPrice + ', maxPrice=' + settings.maxPrice + ', year=' + (settings.cardYear || 'all'));
      }
    }
  } catch (e) {
    // Use defaults if server not available
  }
}

// Players are now loaded from database - see getMonitoredPlayers()
async function getMonitoredPlayers() {
  try {
    const players = await db('monitored_players').where({ active: true });
    const result = { basketball: [], baseball: [] };
    for (const p of players) {
      if (result[p.sport]) {
        result[p.sport].push(p.name);
      }
    }
    return result;
  } catch (e) {
    console.log('Failed to load players from DB, using defaults:', e.message);
    // Fallback to defaults if DB not ready
    return {
      basketball: ['LeBron James', 'Victor Wembanyama', 'Luka Doncic', 'Anthony Edwards', 'Stephen Curry'],
      baseball: ['Shohei Ohtani', 'Mike Trout', 'Julio Rodriguez', 'Gunnar Henderson', 'Juan Soto']
    };
  }
}

function buildQueries(player) {
  // Simplified queries for speed - just PSA 10 and PSA 9
  const year = settings.cardYear ? settings.cardYear + ' ' : '';
  return [
    year + player + ' PSA 10',
    year + player + ' PSA 9'
  ];
}

async function getMarketValue(listing, sport) {
  // Use parsed card details from eBay client for exact matching
  try {
    const result = await pricing.getMarketValue({
      player: listing.title,  // Full title for player name extraction
      year: listing.year,
      set: listing.setName,  // Use setName from eBay parser (not 'set')
      grade: listing.grade,
      cardNumber: listing.cardNumber,  // Card # is KEY for matching
      parallel: listing.parallel,  // Color/variant must match
      imageUrl: listing.imageUrl,
      sport: sport  // For category filtering (basketball, baseball, football)
    });
    // Return null if unknown - don't estimate
    if (!result || result.source === 'unknown' || !result.marketValue) {
      return null;
    }
    // Return full result with source info
    return {
      value: result.marketValue,
      source: result.source,
      sourceUrl: result.sourceUrl,
      date: result.lastUpdated
    };
  } catch (e) {
    console.log('  Price lookup failed: ' + e.message);
    return null;
  }
}

function calculateDealScore(price, marketValue) {
  if (!marketValue || marketValue <= 0) return 0;
  const discount = (marketValue - price) / marketValue;
  return Math.min(Math.max(Math.round(discount * 100), 0), 100);
}

// Only accept PSA 9 or PSA 10 graded cards
function isPSA9or10(listing) {
  const title = (listing.title || '').toUpperCase();
  const grade = (listing.grade || '').toUpperCase();
  return title.includes('PSA 10') || title.includes('PSA 9') ||
         grade.includes('PSA 10') || grade.includes('PSA 9');
}

async function logScan(listing, sport, platform, outcome, rejectReason, marketData, dealScore) {
  try {
    const itemId = listing.ebayItemId || (platform + '-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    await db('scan_log').insert({
      ebay_item_id: itemId,
      platform: platform,
      sport: sport,
      title: listing.title,
      price: listing.currentPrice,
      grade: listing.grade || null,
      year: listing.year || null,
      set_name: listing.setName || null,
      card_number: listing.cardNumber || null,
      parallel: listing.parallel || null,
      insert_set: listing.insertSet || null,
      outcome: outcome,
      reject_reason: rejectReason,
      market_value: marketData?.value || null,
      market_source: marketData?.source || null,
      deal_score: dealScore || null,
      listing_url: listing.listingUrl,
      image_url: listing.imageUrl
    });
  } catch (e) {
    // Don't fail the scan if logging fails
    console.log('  Log error: ' + e.message);
  }
}

// Format a short card description for logging
function shortCard(listing) {
  const year = listing.year || '';
  const set = listing.setName || '';
  const num = listing.cardNumber ? '#' + listing.cardNumber : '';
  const par = listing.parallel || 'base';
  const grade = listing.grade || '';
  return `${year} ${set} ${num} ${par} ${grade}`.replace(/\s+/g, ' ').trim().substring(0, 50);
}

// Increment scan counter on server
async function incrementScanCount(count) {
  if (count <= 0) return;
  try {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
    console.log(`  [Scan count +${count}] → ${serverUrl}`);
    const resp = await fetch(serverUrl + '/api/scan-count/increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count })
    });
    if (!resp.ok) {
      console.log(`  [Scan count error: ${resp.status}]`);
    }
  } catch (e) {
    console.log(`  [Scan count failed: ${e.message}]`);
  }
}

async function processListings(listings, sport, platform) {
  // Listings are already filtered to PSA 9/10 by the eBay client

  // Filter by price range
  const inPriceRange = listings.filter(l => l.currentPrice >= settings.minPrice && l.currentPrice <= settings.maxPrice);

  // Skip cards missing essential info (no card # = can't match)
  const matchable = inPriceRange.filter(l => l.cardNumber && l.setName);
  const skipped = inPriceRange.length - matchable.length;

  console.log(`  [${platform}] ${listings.length} cards → ${matchable.length} matchable (${skipped} missing card#/set)`);

  // Increment scan count
  incrementScanCount(matchable.length);  // Don't await - fire and forget for speed

  // Process in parallel batches of 10
  let saved = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < matchable.length; i += BATCH_SIZE) {
    const batch = matchable.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(batch.map(async (listing) => {
      try {
        const marketData = await getMarketValue(listing, sport);
        const card = shortCard(listing);

        if (!marketData || !marketData.value) {
          // Log to scan_log - no market value found
          logScan(listing, sport, platform, 'rejected', 'no_market_value', null, null);
          return null;
        }

        const dealScore = calculateDealScore(listing.currentPrice, marketData.value);

        if (dealScore < settings.minDealScore) {
          // Log to scan_log - deal score too low
          logScan(listing, sport, platform, 'rejected', `score_${dealScore}%_below_${settings.minDealScore}%`, marketData, dealScore);
          return null;
        }

        const itemId = listing.ebayItemId || (platform + '-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        const existing = await db('listings').where('ebay_item_id', itemId).first();

        if (!existing) {
          await db('listings').insert({
            ebay_item_id: itemId,
            sport: sport,
            title: listing.title,
            current_price: listing.currentPrice,
            is_auction: listing.isAuction || false,
            bid_count: listing.bidCount || 0,
            grade: listing.grade || 'Raw',
            market_value: marketData.value,
            market_value_source: marketData.source,
            market_value_url: marketData.sourceUrl,
            market_value_date: marketData.date,
            deal_score: dealScore,
            image_url: listing.imageUrl,
            listing_url: listing.listingUrl,
            platform: platform,
            is_active: true
          });
          // Log to scan_log - saved as deal
          logScan(listing, sport, platform, 'saved', null, marketData, dealScore);
          console.log(`  DEAL | $${listing.currentPrice} → $${marketData.value} (${dealScore}%) | ${card}`);
          return 1;
        }
        // Log to scan_log - already exists
        logScan(listing, sport, platform, 'duplicate', 'already_exists', marketData, dealScore);
        return 0;
      } catch (e) {
        return 0;
      }
    }));

    saved += results.filter(r => r === 1).length;
  }

  return saved;
}

async function scanPlayer(player, sport) {
  const queries = buildQueries(player);
  let total = 0;

  // Run both queries in parallel for speed
  if (hasEbayKeys) {
    try {
      const allListings = await Promise.all(
        queries.map(query => ebay.searchListings({ query, sport, limit: 20, maxPrice: settings.maxPrice }).catch(() => []))
      );

      // Combine and dedupe by itemId
      const seen = new Set();
      const combined = [];
      for (const listings of allListings) {
        for (const l of listings) {
          if (!seen.has(l.ebayItemId)) {
            seen.add(l.ebayItemId);
            combined.push(l);
          }
        }
      }

      if (combined.length > 0) {
        total = await processListings(combined, sport, 'ebay');
      }
    } catch (e) {
      // Silent fail
    }
  }

  return total;
}

async function runWorker() {
  console.log('CardSnipe Worker | Source: eBay' + (hasEbayKeys ? '' : ' (no keys configured!)'));
  console.log('SERVER_URL: ' + (process.env.SERVER_URL || 'NOT SET (using localhost:3001)'));

  while (true) {
    try {
      await fetchSettings();
      const monitoredPlayers = await getMonitoredPlayers();

      console.log('\n=== SCAN ' + new Date().toLocaleTimeString() + ' ===');
      let totalNew = 0;

      if (monitoredPlayers.basketball.length > 0) {
        console.log('Basketball:');
        for (const player of monitoredPlayers.basketball) {
          console.log(' ' + player + ':');
          totalNew += await scanPlayer(player, 'basketball');
        }
      }

      if (monitoredPlayers.baseball.length > 0) {
        console.log('Baseball:');
        for (const player of monitoredPlayers.baseball) {
          console.log(' ' + player + ':');
          totalNew += await scanPlayer(player, 'baseball');
        }
      }

      const stats = await db('listings').where('is_active', true).count('* as count').first();
      console.log('=== DONE: ' + totalNew + ' new deals | ' + stats.count + ' total ===\n');
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));

    } catch (error) {
      console.error('Worker error: ' + error.message);
      await new Promise(r => setTimeout(r, 60 * 1000));
    }
  }
}

runWorker().catch(console.error);
