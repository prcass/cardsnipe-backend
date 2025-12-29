/**
 * Price/Market Value Service
 * 
 * Fetches market values from multiple sources to calculate deal scores.
 * Sources: 130point (free), PSA Price Guide, CardLadder, etc.
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export class PriceService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 60 * 60 * 1000; // 1 hour cache
  }

  /**
   * Get market value for a card from multiple sources
   */
  async getMarketValue({ player, year, set, grade, parallel }) {
    const cacheKey = `${player}:${year}:${set}:${grade}:${parallel || 'base'}`.toLowerCase();
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.timestamp > Date.now() - this.cacheTTL) {
      return cached.data;
    }

    // Try multiple sources in order of preference
    let marketValue = null;
    let source = null;

    // 1. Try 130point (free, eBay sold data)
    try {
      marketValue = await this.fetch130Point({ player, year, set, grade });
      if (marketValue) source = '130point';
    } catch (e) {
      console.error('130point fetch failed:', e.message);
    }

    // 2. Fallback: estimate based on similar sales
    if (!marketValue) {
      marketValue = this.estimateValue({ player, year, set, grade, parallel });
      source = 'estimate';
    }

    const result = {
      marketValue,
      source,
      confidence: source === '130point' ? 'high' : 'medium',
      lastUpdated: new Date()
    };

    // Cache the result
    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  }

  /**
   * Fetch recent sales from 130point.com
   * This scrapes their free sold listings data
   */
  async fetch130Point({ player, year, set, grade }) {
    const query = encodeURIComponent(`${year || ''} ${player} ${set || ''} ${grade || ''}`.trim());
    const url = `https://130point.com/sales/?search=${query}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) return null;

      const html = await response.text();
      const $ = cheerio.load(html);

      // Parse the sold listings table
      const prices = [];
      $('table tbody tr').each((i, row) => {
        const priceCell = $(row).find('td').eq(1).text();
        const price = parseFloat(priceCell.replace(/[$,]/g, ''));
        if (!isNaN(price) && price > 0) {
          prices.push(price);
        }
      });

      if (prices.length === 0) return null;

      // Calculate average of recent sales (excluding outliers)
      prices.sort((a, b) => a - b);
      const trimmed = prices.slice(
        Math.floor(prices.length * 0.1),
        Math.floor(prices.length * 0.9)
      );

      if (trimmed.length === 0) return prices[Math.floor(prices.length / 2)];

      const average = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
      return Math.round(average * 100) / 100;
    } catch (error) {
      console.error('130point scrape error:', error);
      return null;
    }
  }

  /**
   * Estimate value based on known factors when no sales data available
   */
  estimateValue({ player, year, set, grade, parallel }) {
    // Base values by player tier (this would come from a database in production)
    const playerTiers = {
      // Tier 1: Superstars
      'lebron james': 1.5,
      'michael jordan': 2.0,
      'kobe bryant': 1.4,
      'shohei ohtani': 1.6,
      'mike trout': 1.3,
      'victor wembanyama': 1.8,
      
      // Tier 2: Stars
      'luka doncic': 1.3,
      'jayson tatum': 1.1,
      'anthony edwards': 1.2,
      'julio rodriguez': 1.1,
      
      // Default
      'default': 1.0
    };

    const setMultipliers = {
      'prizm': 1.4,
      'optic': 1.2,
      'select': 1.3,
      'national treasures': 2.5,
      'topps chrome': 1.3,
      'bowman chrome': 1.4,
      'bowman': 1.1,
      'default': 1.0
    };

    const gradeMultipliers = {
      'psa 10': 3.5,
      'psa 9': 1.5,
      'bgs 10': 5.0,
      'bgs 9.5': 2.5,
      'sgc 10': 2.0,
      'raw': 1.0,
      'default': 1.0
    };

    const parallelMultipliers = {
      'gold': 3.0,
      'silver': 1.5,
      'red': 2.5,
      'blue': 1.8,
      'green': 2.0,
      'shimmer': 4.0,
      'default': 1.0
    };

    // Calculate base value
    let baseValue = 25; // Minimum base

    // Apply multipliers
    const playerKey = player?.toLowerCase() || 'default';
    const setKey = set?.toLowerCase() || 'default';
    const gradeKey = grade?.toLowerCase() || 'default';
    const parallelKey = parallel?.toLowerCase() || 'default';

    baseValue *= playerTiers[playerKey] || playerTiers.default;
    baseValue *= setMultipliers[setKey] || setMultipliers.default;
    baseValue *= gradeMultipliers[gradeKey] || gradeMultipliers.default;
    baseValue *= parallelMultipliers[parallelKey] || parallelMultipliers.default;

    // Adjust for year (newer rookies = more value, vintage = more value)
    const cardYear = parseInt(year);
    if (cardYear) {
      const age = new Date().getFullYear() - cardYear;
      if (age <= 2) baseValue *= 1.3; // Recent/rookie
      else if (age >= 30) baseValue *= 1.5; // Vintage
    }

    return Math.round(baseValue);
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
        score += 15; // Last 15 minutes with few bids = hot!
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

  /**
   * Batch process listings to add market values and deal scores
   */
  async enrichListings(listings) {
    const enriched = [];

    for (const listing of listings) {
      const valueData = await this.getMarketValue({
        player: listing.playerName,
        year: listing.year,
        set: listing.setName,
        grade: listing.grade,
        parallel: listing.parallel
      });

      const dealScore = this.calculateDealScore(listing, valueData.marketValue);

      enriched.push({
        ...listing,
        marketValue: valueData.marketValue,
        marketValueSource: valueData.source,
        dealScore
      });
    }

    // Sort by deal score
    return enriched.sort((a, b) => b.dealScore - a.dealScore);
  }
}
