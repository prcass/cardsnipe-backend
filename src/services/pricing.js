/**
 * Price/Market Value Service
 *
 * Fetches market values from SportsCardPro API only
 * NO ESTIMATES - returns Unknown if no real data found
 */

import { SportsCardProClient } from './sportscardpro.js';

const sportsCardPro = new SportsCardProClient();
const hasSportsCardProToken = !!process.env.SPORTSCARDPRO_TOKEN;

export class PriceService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 60 * 60 * 1000; // 1 hour cache
  }

  /**
   * Get market value for a card using SportsCardPro
   * certNumber: PSA certification number for direct API lookup (most accurate)
   */
  async getMarketValue({ player, year, set, grade, cardNumber, parallel, imageUrl, sport, certNumber }) {
    // Include certNumber in cache key if available
    const cacheKey = `${certNumber || ''}:${player}:${year}:${set}:${grade}:${cardNumber || ''}:${parallel || ''}:${sport || ''}`.toLowerCase();

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.timestamp > Date.now() - this.cacheTTL) {
      return cached.data;
    }

    let result = null;

    // Use SportsCardPro (with PSA lookup for structured data if certNumber provided)
    if (hasSportsCardProToken) {
      try {
        result = await sportsCardPro.getMarketValue({ player, year, set, grade, cardNumber, parallel, imageUrl, sport, certNumber });
        if (result && result.marketValue) {
          result.confidence = certNumber ? 'very-high' : 'high';  // Higher confidence when using PSA data
        }
      } catch (e) {
        console.log('SportsCardPro lookup failed:', e.message);
      }
    } else {
      console.log('SportsCardPro: No API token configured');
    }

    // No data found - return unknown
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
