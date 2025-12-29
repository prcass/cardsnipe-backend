/**
 * Price/Market Value Service
 *
 * Fetches market values from multiple sources to calculate deal scores.
 * Sources: 130point (free), PSA Price Guide
 * NO ESTIMATES - returns Unknown if no real data found
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { PSAClient } from './psa.js';

const psa = new PSAClient();
const hasPSACredentials = process.env.PSA_USERNAME && process.env.PSA_PASSWORD;

export class PriceService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 60 * 60 * 1000; // 1 hour cache
  }

  /**
   * Get market value for a card from multiple sources
   * Returns source, URL, and date for transparency
   */
  async getMarketValue({ player, year, set, grade, parallel }) {
    const cacheKey = `${player}:${year}:${set}:${grade}:${parallel || 'base'}`.toLowerCase();

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.timestamp > Date.now() - this.cacheTTL) {
      return cached.data;
    }

    let marketValue = null;
    let source = null;
    let sourceUrl = null;

    // 1. Try PSA Price Guide (if credentials configured and card is PSA graded)
    if (hasPSACredentials && grade && grade.toLowerCase().includes('psa')) {
      try {
        const psaData = await psa.getMarketValue({ player, year, set, grade });
        if (psaData && psaData.marketValue) {
          marketValue = psaData.marketValue;
          source = 'psa';
          sourceUrl = 'https://www.psacard.com/auctionprices';
        }
      } catch (e) {
        console.log('PSA lookup failed:', e.message);
      }
    }

    // 2. Try 130point (free, eBay sold data)
    if (!marketValue) {
      try {
        const result130 = await this.fetch130Point({ player, year, set, grade });
        if (result130 && result130.value) {
          marketValue = result130.value;
          sourceUrl = result130.url;
          source = '130point';
        }
      } catch (e) {
        console.error('130point fetch failed:', e.message);
      }
    }

    // 3. No estimate - return unknown if no real data found
    if (!marketValue) {
      return {
        marketValue: null,
        source: 'unknown',
        sourceUrl: null,
        confidence: 'none',
        lastUpdated: new Date()
      };
    }

    const result = {
      marketValue,
      source,
      sourceUrl,
      confidence: 'high',
      lastUpdated: new Date()
    };

    // Cache the result
    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  }

  /**
   * Fetch recent sales from 130point.com
   * Returns value and URL for source tracking
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

      if (trimmed.length === 0) {
        return { value: prices[Math.floor(prices.length / 2)], url };
      }

      const average = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
      return { value: Math.round(average * 100) / 100, url };
    } catch (error) {
      console.error('130point scrape error:', error);
      return null;
    }
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
