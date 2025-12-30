/**
 * Price/Market Value Service
 *
 * Fetches market values from SportsCardPro API
 * NO ESTIMATES - returns Unknown if no real data found
 */

import { SportsCardProClient } from './sportscardpro.js';
import { PSAClient } from './psa.js';

const sportsCardPro = new SportsCardProClient();
const psa = new PSAClient();

const hasSportsCardProToken = !!process.env.SPORTSCARDPRO_TOKEN;
const hasPSACredentials = process.env.PSA_ACCESS_TOKEN || (process.env.PSA_USERNAME && process.env.PSA_PASSWORD);

export class PriceService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 60 * 60 * 1000; // 1 hour cache
  }

  /**
   * Get market value for a card
   * Returns source, URL, and date for transparency
   */
  async getMarketValue({ player, year, set, grade, cardNumber, parallel, imageUrl, sport }) {
    const cacheKey = `${player}:${year}:${set}:${grade}:${cardNumber || ''}:${parallel || ''}:${sport || ''}`.toLowerCase();

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.timestamp > Date.now() - this.cacheTTL) {
      return cached.data;
    }

    let result = null;

    // 1. Try SportsCardPro (primary source)
    if (hasSportsCardProToken) {
      try {
        result = await sportsCardPro.getMarketValue({ player, year, set, grade, cardNumber, parallel, imageUrl, sport });
        if (result && result.marketValue) {
          result.confidence = 'high';
        }
      } catch (e) {
        console.log('SportsCardPro lookup failed:', e.message);
      }
    } else {
      console.log('SportsCardPro: No API token configured');
    }

    // 2. Fallback to PSA (if credentials configured and card is PSA graded)
    if (!result && hasPSACredentials && grade && grade.toLowerCase().includes('psa')) {
      try {
        const psaData = await psa.getMarketValue({ player, year, set, grade });
        if (psaData && psaData.marketValue) {
          result = {
            marketValue: psaData.marketValue,
            source: 'psa',
            sourceUrl: 'https://www.psacard.com/auctionprices',
            confidence: 'high',
            lastUpdated: new Date()
          };
        }
      } catch (e) {
        console.log('PSA lookup failed:', e.message);
      }
    }

    // 3. No data found - return unknown (NO ESTIMATES)
    if (!result) {
      return {
        marketValue: null,
        source: 'unknown',
        sourceUrl: null,
        confidence: 'none',
        lastUpdated: new Date()
      };
    }

    // Cache the result
    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  }

  /**
   * Calculate deal score based on current price vs market value
   */
  calculateDealScore(listing, marketValue) {
    if (!marketValue || marketValue <= 0) return 0;

    const currentPrice = listing.currentPrice;
    const discount = (marketValue - currentPrice) / marketValue;

    let score = discount * 100;

    // Boost for auctions ending soon with few bids
    if (listing.isAuction && listing.auctionEndTime) {
      const hoursLeft = (new Date(listing.auctionEndTime) - Date.now()) / (1000 * 60 * 60);

      if (hoursLeft < 1 && listing.bidCount < 5) {
        score += 10;
      }
      if (hoursLeft < 0.25 && listing.bidCount < 3) {
        score += 15;
      }
    }

    // Boost for trusted sellers
    if (listing.sellerRating >= 99.5) score += 5;
    if (listing.sellerFeedbackCount >= 1000) score += 3;

    // Penalty for shipping
    if (listing.shippingCost && listing.shippingCost > 5) {
      score -= 5;
    }

    return Math.min(Math.max(Math.round(score), 0), 100);
  }
}
