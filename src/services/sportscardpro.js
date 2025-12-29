/**
 * SportsCardsPro API Integration
 *
 * Docs: https://www.sportscardspro.com/api-documentation
 * Requires paid subscription for API access
 */

import fetch from 'node-fetch';

export class SportsCardProClient {
  constructor() {
    this.baseUrl = 'https://www.pricecharting.com';
    this.token = process.env.SPORTSCARDPRO_TOKEN;
  }

  /**
   * Search for cards and get prices
   * Returns up to 20 matching results
   */
  async searchCards(query) {
    if (!this.token) {
      throw new Error('SPORTSCARDPRO_TOKEN not configured');
    }

    const url = `${this.baseUrl}/api/products?t=${this.token}&q=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid SportsCardPro API token');
        }
        throw new Error(`SportsCardPro API error: ${response.status}`);
      }

      const data = await response.json();
      return data.products || [];
    } catch (error) {
      console.error('SportsCardPro search error:', error.message);
      throw error;
    }
  }

  /**
   * Get price for a specific product by ID
   */
  async getProductById(productId) {
    if (!this.token) {
      throw new Error('SPORTSCARDPRO_TOKEN not configured');
    }

    const url = `${this.baseUrl}/api/product?t=${this.token}&id=${productId}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      console.error('SportsCardPro product error:', error.message);
      return null;
    }
  }

  /**
   * Get market value for a card
   * Searches by title and returns appropriate graded price
   */
  async getMarketValue({ player, year, set, grade, cardNumber }) {
    // Build search query - be specific for exact match
    let query = '';
    if (year) query += year + ' ';
    query += player;
    if (set) query += ' ' + set;
    if (cardNumber) query += ' #' + cardNumber;

    console.log(`  SportsCardPro: Searching "${query}"`);

    try {
      const products = await this.searchCards(query);

      if (!products || products.length === 0) {
        console.log('  SportsCardPro: No results found');
        return null;
      }

      // Find best matching product
      const product = products[0]; // Most relevant match

      // Get price based on grade (prices are in pennies)
      let priceInPennies = null;
      let priceKey = 'loose-price'; // default to ungraded

      if (grade) {
        const gradeUpper = grade.toUpperCase();
        if (gradeUpper.includes('PSA 10') || gradeUpper.includes('BGS 10') || gradeUpper.includes('GEM')) {
          priceKey = 'manual-only-price'; // Top grade (PSA 10/BGS 10)
          priceInPennies = product['manual-only-price'] || product['bgs-10-price'];
        } else if (gradeUpper.includes('PSA 9') || gradeUpper.includes('BGS 9')) {
          priceKey = 'graded-price'; // PSA 9 / BGS 9
          priceInPennies = product['graded-price'];
        } else if (gradeUpper.includes('PSA 8') || gradeUpper.includes('BGS 8')) {
          priceKey = 'new-price'; // PSA 8 / BGS 8.5
          priceInPennies = product['new-price'];
        }
      }

      // Fallback to loose price if graded price not available
      if (!priceInPennies) {
        priceInPennies = product['loose-price'];
        priceKey = 'loose-price';
      }

      if (!priceInPennies || priceInPennies <= 0) {
        console.log('  SportsCardPro: No price data for this card');
        return null;
      }

      // Convert pennies to dollars
      const marketValue = priceInPennies / 100;

      // Build source URL
      const sourceUrl = product['product-url'] ||
        `https://www.sportscardspro.com/game/${encodeURIComponent(product['console-name'] || 'sports-cards')}/${encodeURIComponent(product['product-name'] || query)}`;

      console.log(`  SportsCardPro: ${product['product-name']} = $${marketValue} (${priceKey})`);

      return {
        marketValue,
        source: 'sportscardpro',
        sourceUrl,
        productName: product['product-name'],
        productId: product['id'],
        priceType: priceKey,
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('  SportsCardPro error:', error.message);
      return null;
    }
  }
}
