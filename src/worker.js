/**
 * Background Worker
 * 
 * Continuously fetches listings from eBay, enriches with market data,
 * and updates the database. Run this as a separate process.
 * 
 * Usage: node src/worker.js
 */

import { EbayClient } from './services/ebay.js';
import { PriceService } from './services/pricing.js';
import { db } from './db/index.js';
import { broadcastNewDeal, broadcastDealUpdate } from './server.js';

const ebay = new EbayClient();
const pricing = new PriceService();

// Players to monitor (expand this list!)
const MONITORED_PLAYERS = {
  basketball: [
    'LeBron James',
    'Victor Wembanyama',
    'Luka Doncic',
    'Anthony Edwards',
    'Jayson Tatum',
    'Giannis Antetokounmpo',
    'Stephen Curry',
    'Kevin Durant',
    'Ja Morant',
    'Paolo Banchero',
    'Chet Holmgren',
    'Shai Gilgeous-Alexander'
  ],
  baseball: [
    'Shohei Ohtani',
    'Mike Trout',
    'Julio Rodriguez',
    'Gunnar Henderson',
    'Elly De La Cruz',
    'Corbin Carroll',
    'Adley Rutschman',
    'Bobby Witt Jr',
    'Ronald Acuna Jr',
    'Juan Soto',
    'Mookie Betts'
  ]
};

// Premium sets to prioritize
const PRIORITY_SETS = [
  'Prizm',
  'Optic',
  'Select',
  'Mosaic',
  'National Treasures',
  'Topps Chrome',
  'Bowman Chrome',
  'Bowman 1st'
];

/**
 * Build search queries for a player
 */
function buildQueries(player, sport) {
  const queries = [];
  
  // Base player search
  queries.push(`${player} card`);
  
  // Add set-specific searches for better coverage
  PRIORITY_SETS.slice(0, 4).forEach(set => {
    queries.push(`${player} ${set}`);
  });
  
  // Graded cards
  queries.push(`${player} PSA 10`);
  queries.push(`${player} BGS 9.5`);
  
  return queries;
}

/**
 * Process and save listings to database
 */
async function processListings(listings, sport) {
  const enrichedListings = await pricing.enrichListings(listings);
  
  for (const listing of enrichedListings) {
    // Skip if deal score is too low
    if (listing.dealScore < 10) continue;
    
    try {
      // Check if listing exists
      const existing = await db('listings')
        .where('ebay_item_id', listing.ebayItemId)
        .first();
      
      if (existing) {
        // Update existing listing
        await db('listings')
          .where('id', existing.id)
          .update({
            current_price: listing.currentPrice,
            bid_count: listing.bidCount,
            deal_score: listing.dealScore,
            market_value: listing.marketValue,
            last_updated: new Date()
          });
        
        // Broadcast update if deal score improved significantly
        if (listing.dealScore > existing.deal_score + 5) {
          broadcastDealUpdate({ ...listing, id: existing.id });
        }
      } else {
        // Insert new listing
        const [newListing] = await db('listings')
          .insert({
            ebay_item_id: listing.ebayItemId,
            sport,
            title: listing.title,
            current_price: listing.currentPrice,
            is_auction: listing.isAuction,
            auction_end_time: listing.auctionEndTime,
            bid_count: listing.bidCount,
            grade: listing.grade,
            market_value: listing.marketValue,
            deal_score: listing.dealScore,
            image_url: listing.imageUrl,
            listing_url: listing.listingUrl,
            seller_name: listing.sellerName,
            seller_rating: listing.sellerRating,
            platform: 'ebay',
            is_active: true
          })
          .returning('*');
        
        // Broadcast new hot deal
        if (listing.dealScore >= 25) {
          broadcastNewDeal(newListing);
          console.log(`🔥 NEW HOT DEAL: ${listing.title} - ${listing.dealScore}% off`);
        }
      }
    } catch (error) {
      console.error(`Failed to save listing ${listing.ebayItemId}:`, error.message);
    }
  }
}

/**
 * Mark ended auctions as inactive
 */
async function cleanupEndedListings() {
  const count = await db('listings')
    .where('is_auction', true)
    .where('auction_end_time', '<', new Date())
    .where('is_active', true)
    .update({ is_active: false });
  
  if (count > 0) {
    console.log(`🧹 Marked ${count} ended auctions as inactive`);
  }
}

/**
 * Main worker loop
 */
async function runWorker() {
  console.log('🚀 CardSnipe Worker started');
  
  while (true) {
    try {
      console.log(`\n📡 Starting scan at ${new Date().toISOString()}`);
      
      // Scan basketball players
      for (const player of MONITORED_PLAYERS.basketball) {
        console.log(`  Scanning: ${player} (basketball)`);
        
        const queries = buildQueries(player, 'basketball');
        
        for (const query of queries) {
          try {
            const listings = await ebay.searchListings({
              query,
              sport: 'basketball',
              buyingOption: 'ALL',
              maxPrice: 1000,
              limit: 25
            });
            
            if (listings.length > 0) {
              await processListings(listings, 'basketball');
            }
            
            // Rate limiting
            await new Promise(r => setTimeout(r, 2000));
          } catch (error) {
            console.error(`  Query failed: ${query}`, error.message);
          }
        }
      }
      
      // Scan baseball players
      for (const player of MONITORED_PLAYERS.baseball) {
        console.log(`  Scanning: ${player} (baseball)`);
        
        const queries = buildQueries(player, 'baseball');
        
        for (const query of queries) {
          try {
            const listings = await ebay.searchListings({
              query,
              sport: 'baseball',
              buyingOption: 'ALL',
              maxPrice: 1000,
              limit: 25
            });
            
            if (listings.length > 0) {
              await processListings(listings, 'baseball');
            }
            
            await new Promise(r => setTimeout(r, 2000));
          } catch (error) {
            console.error(`  Query failed: ${query}`, error.message);
          }
        }
      }
      
      // Cleanup
      await cleanupEndedListings();
      
      // Stats
      const stats = await db('listings')
        .where('is_active', true)
        .count('* as count')
        .first();
      
      console.log(`\n✅ Scan complete. ${stats.count} active listings.`);
      
      // Wait before next full scan (5 minutes)
      console.log('⏳ Waiting 5 minutes before next scan...');
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
      
    } catch (error) {
      console.error('❌ Worker error:', error);
      // Wait 1 minute on error before retrying
      await new Promise(r => setTimeout(r, 60 * 1000));
    }
  }
}

// Run the worker
runWorker().catch(console.error);
