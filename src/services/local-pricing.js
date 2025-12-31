/**
 * Local Pricing Service
 *
 * Uses locally stored SportsCardPro price data instead of API calls.
 * Much faster and no rate limiting!
 */

import { db } from '../db/index.js';

export class LocalPricingService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minute cache
  }

  /**
   * Get market value for a card using local price data
   */
  async getMarketValue({ year, set, grade, cardNumber, parallel, sport }) {
    const cacheKey = `${year}:${set}:${cardNumber}:${parallel || 'base'}:${sport}`.toLowerCase();

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.timestamp > Date.now() - this.cacheTTL) {
      return cached.data;
    }

    try {
      // Build query
      let query = db('price_data')
        .where('year', String(year))
        .where('card_number', String(cardNumber));

      if (sport) {
        query = query.where('sport', sport);
      }

      // Set matching - flexible
      if (set) {
        query = query.whereRaw('LOWER(set_name) = ?', [set.toLowerCase()]);
      }

      // Parallel matching - flexible
      const parallelNorm = (parallel || '').toLowerCase().trim();
      if (parallelNorm) {
        query = query.where(function() {
          // Exact match
          this.whereRaw('LOWER(parallel) = ?', [parallelNorm])
            // Or one starts with the other (e.g., "silver" matches "silver prizm")
            .orWhereRaw('LOWER(parallel) LIKE ?', [parallelNorm + '%'])
            .orWhereRaw('? LIKE LOWER(parallel) || \'%\'', [parallelNorm]);
        });
      } else {
        // Base card - no parallel
        query = query.where(function() {
          this.whereNull('parallel').orWhere('parallel', '');
        });
      }

      const results = await query.limit(5);

      if (!results || results.length === 0) {
        return { error: 'no local price data' };
      }

      // Use first match
      const match = results[0];

      // Get price based on grade
      let price = null;
      let priceType = 'raw';
      const gradeUpper = (grade || '').toUpperCase();

      if (gradeUpper.includes('PSA 10') || gradeUpper.includes('BGS 10') || gradeUpper.includes('GEM')) {
        price = match.psa10_price || match.bgs10_price;
        priceType = 'psa10';
      } else if (gradeUpper.includes('PSA 9') || gradeUpper.includes('BGS 9')) {
        price = match.psa9_price;
        priceType = 'psa9';
      } else if (gradeUpper.includes('PSA 8') || gradeUpper.includes('BGS 8')) {
        price = match.psa8_price;
        priceType = 'psa8';
      } else {
        price = match.raw_price;
        priceType = 'raw';
      }

      if (!price || price <= 0) {
        return { error: 'no price for grade' };
      }

      // Convert from cents to dollars
      const marketValue = price / 100;

      const result = {
        marketValue,
        source: 'local',
        sourceUrl: `https://www.sportscardspro.com/console/${encodeURIComponent(match.console_name)}`,
        matchedTo: `${match.year} ${match.set_name} #${match.card_number} ${match.parallel || 'base'}`,
        priceType,
        confidence: 'high',
        lastUpdated: match.uploaded_at
      };

      // Cache the result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Check if we have local price data loaded
   */
  async hasData(sport) {
    try {
      const count = await db('price_data')
        .where(sport ? { sport } : {})
        .count('* as count')
        .first();
      return count && count.count > 0;
    } catch (e) {
      return false;
    }
  }
}
