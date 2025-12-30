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
  // Only search for PSA 9 and PSA 10 graded cards
  const year = settings.cardYear ? settings.cardYear + ' ' : '';
  return [
    year + player + ' PSA 10',
    year + player + ' PSA 9',
    year + player + ' Prizm PSA 10',
    year + player + ' Prizm PSA 9'
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
      certNumber: listing.certNumber,  // PSA cert # for API lookup (most reliable!)
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

async function processListings(listings, sport, platform) {
  // Filter to only PSA 9 and 10
  const psa9or10 = listings.filter(isPSA9or10);
  const notPSA = listings.filter(l => !isPSA9or10(l));

  // Silently log non-PSA 9/10 as rejected (don't spam console)
  for (const listing of notPSA) {
    await logScan(listing, sport, platform, 'rejected', 'not PSA 9 or 10', null, null);
  }

  // Filter by price range
  const inPriceRange = psa9or10.filter(l => l.currentPrice >= settings.minPrice && l.currentPrice <= settings.maxPrice);
  const outOfRange = psa9or10.filter(l => l.currentPrice < settings.minPrice || l.currentPrice > settings.maxPrice);

  // Silently log out-of-range as rejected
  for (const listing of outOfRange) {
    await logScan(listing, sport, platform, 'rejected', `price $${listing.currentPrice} outside range`, null, null);
  }

  let saved = 0;
  for (const listing of inPriceRange) {
    try {
      const marketData = await getMarketValue(listing, sport);
      const card = shortCard(listing);

      // Skip if market value unknown
      if (!marketData || !marketData.value) {
        const reason = marketData?.error || 'no match';
        console.log(`  SKIP | $${listing.currentPrice} | ${card} | ${reason}`);
        await logScan(listing, sport, platform, 'rejected', reason, null, null);
        continue;
      }

      const dealScore = calculateDealScore(listing.currentPrice, marketData.value);
      const matchedTo = marketData.matchedTo || marketData.productName || '';

      if (dealScore < settings.minDealScore) {
        console.log(`  SKIP | $${listing.currentPrice} → $${marketData.value} (${dealScore}%) | ${card} | score < ${settings.minDealScore}%`);
        await logScan(listing, sport, platform, 'rejected', `score ${dealScore}% < min ${settings.minDealScore}%`, marketData, dealScore);
        continue;
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
        saved++;
        console.log(`  DEAL | $${listing.currentPrice} → $${marketData.value} (${dealScore}%) | ${card} → ${matchedTo}`);
        await logScan(listing, sport, platform, 'saved', null, marketData, dealScore);
      } else {
        await logScan(listing, sport, platform, 'matched', 'already exists', marketData, dealScore);
      }
    } catch (e) {
      await logScan(listing, sport, platform, 'rejected', 'error: ' + e.message, null, null);
    }
  }
  return saved;
}

async function scanPlayer(player, sport) {
  const queries = buildQueries(player);
  let total = 0;

  for (const query of queries) {
    // Try eBay if credentials are configured
    if (hasEbayKeys) {
      try {
        const listings = await ebay.searchListings({ query, sport, limit: 20, maxPrice: settings.maxPrice });
        if (listings.length > 0) {
          total += await processListings(listings, sport, 'ebay');
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        // Silent fail
      }
    }

    // Also try COMC
    try {
      const listings = await comc.searchListings({ query, sport, limit: 15 });
      if (listings.length > 0) {
        total += await processListings(listings, sport, 'comc');
      }
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      // Silent fail
    }
  }
  return total;
}

async function runWorker() {
  console.log('CardSnipe Worker | Sources: ' + (hasEbayKeys ? 'eBay + ' : '') + 'COMC');

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
