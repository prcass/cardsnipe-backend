/**
 * Background Worker - Multi-Source Card Scanner
 */

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

const MONITORED_PLAYERS = {
  basketball: ['LeBron James', 'Victor Wembanyama', 'Luka Doncic', 'Anthony Edwards', 'Stephen Curry'],
  baseball: ['Shohei Ohtani', 'Mike Trout', 'Julio Rodriguez', 'Gunnar Henderson', 'Juan Soto']
};

function buildQueries(player) {
  return [player + ' card', player + ' Prizm', player + ' PSA 10'];
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

async function processListings(listings, sport, platform) {
  let saved = 0;
  for (const listing of listings) {
    try {
      const marketValue = await getMarketValue(listing);
      const dealScore = calculateDealScore(listing.currentPrice, marketValue);
      if (dealScore < 10) continue;

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
    } catch (e) { /* skip */ }
  }
  return saved;
}

async function scanPlayer(player, sport) {
  const queries = buildQueries(player);
  let total = 0;

  for (const query of queries) {
    // Try eBay if configured
    if (hasEbayKeys) {
      try {
        const listings = await ebay.searchListings({ query, sport, maxPrice: 500, limit: 15 });
        total += await processListings(listings, sport, 'ebay');
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) { /* eBay failed */ }
    }

    // Try COMC (no API key needed)
    try {
      const listings = await comc.searchListings({ query, sport, maxPrice: 500, limit: 15 });
      total += await processListings(listings, sport, 'comc');
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.log('  COMC: ' + e.message);
    }
  }
  return total;
}

async function runWorker() {
  console.log('CardSnipe Worker started');
  console.log('Sources: ' + (hasEbayKeys ? 'eBay, ' : '') + 'COMC, 130point');

  while (true) {
    try {
      console.log('\nStarting scan at ' + new Date().toISOString());
      let totalNew = 0;

      console.log('\nBasketball:');
      for (const player of MONITORED_PLAYERS.basketball) {
        console.log('  ' + player);
        totalNew += await scanPlayer(player, 'basketball');
      }

      console.log('\nBaseball:');
      for (const player of MONITORED_PLAYERS.baseball) {
        console.log('  ' + player);
        totalNew += await scanPlayer(player, 'baseball');
      }

      const stats = await db('listings').where('is_active', true).count('* as count').first();
      console.log('\nScan complete. ' + totalNew + ' new. ' + stats.count + ' total.');
      console.log('Waiting 5 minutes...\n');
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));

    } catch (error) {
      console.error('Worker error: ' + error.message);
      await new Promise(r => setTimeout(r, 60 * 1000));
    }
  }
}

runWorker().catch(console.error);
