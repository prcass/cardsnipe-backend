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
  minDealScore: 10
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
        console.log('Settings loaded: minPrice=' + settings.minPrice + ', maxPrice=' + settings.maxPrice);
      }
    }
  } catch (e) {
    // Use defaults if server not available
  }
}

const MONITORED_PLAYERS = {
  basketball: ['LeBron James', 'Victor Wembanyama', 'Luka Doncic', 'Anthony Edwards', 'Stephen Curry'],
  baseball: ['Shohei Ohtani', 'Mike Trout', 'Julio Rodriguez', 'Gunnar Henderson', 'Juan Soto']
};

function buildQueries(player) {
  // Only search for PSA 9 and PSA 10 graded cards
  return [
    player + ' PSA 10',
    player + ' PSA 9',
    player + ' Prizm PSA 10',
    player + ' Prizm PSA 9'
  ];
}

async function getMarketValue(listing) {
  try {
    const result = await scraper130.getMarketValue({
      player: listing.title,
      grade: listing.grade
    });
    return result ? result.marketValue : pricing.estimateValue(listing);
  } catch (e) {
    return pricing.estimateValue(listing);
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

async function processListings(listings, sport, platform) {
  // Filter to only PSA 9 and 10
  listings = listings.filter(isPSA9or10);
  // Filter by price range
  listings = listings.filter(l => l.currentPrice >= settings.minPrice && l.currentPrice <= settings.maxPrice);
  let saved = 0;
  for (const listing of listings) {
    try {
      const marketValue = await getMarketValue(listing);
      const dealScore = calculateDealScore(listing.currentPrice, marketValue);
      if (dealScore < settings.minDealScore) continue;

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
          market_value: marketValue,
          deal_score: dealScore,
          image_url: listing.imageUrl,
          listing_url: listing.listingUrl,
          platform: platform,
          is_active: true
        });
        saved++;
        if (dealScore >= 25) {
          console.log('  HOT DEAL: ' + listing.title.substring(0, 50) + ' - Score: ' + dealScore);
        }
      }
    } catch (e) {
      console.log('  Error saving listing: ' + e.message);
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
      console.log('    Searching eBay: ' + query);
      try {
        const listings = await ebay.searchListings({ query, sport, limit: 20, maxPrice: settings.maxPrice });
        console.log('    eBay found ' + listings.length + ' listings');
        total += await processListings(listings, sport, 'ebay');
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.log('    eBay error: ' + e.message);
      }
    }

    // Also try COMC
    console.log('    Searching COMC: ' + query);
    try {
      const listings = await comc.searchListings({ query, sport, limit: 15 });
      console.log('    COMC found ' + listings.length + ' listings');
      total += await processListings(listings, sport, 'comc');
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.log('    COMC error: ' + e.message);
    }
  }
  return total;
}

async function runWorker() {
  console.log('CardSnipe Worker started');
  console.log('Sources: ' + (hasEbayKeys ? 'eBay + ' : '') + 'COMC');

  while (true) {
    try {
      console.log('');
      await fetchSettings();
      console.log('Starting scan at ' + new Date().toISOString());
      let totalNew = 0;

      console.log('');
      console.log('Basketball:');
      for (const player of MONITORED_PLAYERS.basketball) {
        console.log('  Scanning: ' + player);
        totalNew += await scanPlayer(player, 'basketball');
      }

      console.log('');
      console.log('Baseball:');
      for (const player of MONITORED_PLAYERS.baseball) {
        console.log('  Scanning: ' + player);
        totalNew += await scanPlayer(player, 'baseball');
      }

      const stats = await db('listings').where('is_active', true).count('* as count').first();
      console.log('');
      console.log('Scan complete. ' + totalNew + ' new. ' + stats.count + ' total active.');
      console.log('Waiting 5 minutes...');
      console.log('');
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));

    } catch (error) {
      console.error('Worker error: ' + error.message);
      await new Promise(r => setTimeout(r, 60 * 1000));
    }
  }
}

runWorker().catch(console.error);
