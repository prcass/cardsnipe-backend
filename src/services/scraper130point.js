/**
 * 130point.com Scraper
 *
 * Scrapes 130point.com for eBay sold data to get accurate market values.
 * This site aggregates eBay sold listings - perfect for price research.
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export class Scraper130Point {
  constructor() {
    this.baseUrl = 'https://130point.com';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    };
  }

  /**
   * Get recent sold prices for a card search
   */
  async getSoldPrices(query) {
    try {
      const searchUrl = `${this.baseUrl}/sales/?search=${encodeURIComponent(query)}`;

      const response = await fetch(searchUrl, {
        headers: this.headers,
        timeout: 10000
      });

      if (!response.ok) {
        console.error(`130point fetch failed: ${response.status}`);
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const sales = [];

      // Parse the sales table
      $('table tbody tr').each((i, row) => {
        try {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const title = $(cells[0]).text().trim();
            const priceText = $(cells[1]).text().trim();
            const dateText = $(cells[2]).text().trim();

            const price = parseFloat(priceText.replace(/[$,]/g, ''));

            if (!isNaN(price) && price > 0) {
              sales.push({
                title,
                price,
                date: dateText,
                source: '130point'
              });
            }
          }
        } catch (e) {
          // Skip problematic rows
        }
      });

      if (sales.length === 0) {
        return null;
      }

      // Calculate market value statistics
      const prices = sales.map(s => s.price).sort((a, b) => a - b);

      // Remove outliers (bottom 10% and top 10%)
      const trimStart = Math.floor(prices.length * 0.1);
      const trimEnd = Math.floor(prices.length * 0.9);
      const trimmedPrices = prices.slice(trimStart, trimEnd || prices.length);

      const average = trimmedPrices.length > 0
        ? trimmedPrices.reduce((a, b) => a + b, 0) / trimmedPrices.length
        : prices[Math.floor(prices.length / 2)];

      const median = prices[Math.floor(prices.length / 2)];
      const lowest = prices[0];
      const highest = prices[prices.length - 1];

      return {
        marketValue: Math.round(average * 100) / 100,
        median: Math.round(median * 100) / 100,
        lowest,
        highest,
        sampleSize: sales.length,
        recentSales: sales.slice(0, 10),
        source: '130point'
      };

    } catch (error) {
      console.error(`130point scrape error: ${error.message}`);
      return null;
    }
  }

  /**
   * Get market value for a specific card
   */
  async getMarketValue({ player, year, set, grade }) {
    // Build search query
    let query = player;
    if (year) query = `${year} ${query}`;
    if (set) query = `${query} ${set}`;
    if (grade && grade !== 'Raw') query = `${query} ${grade}`;

    const result = await this.getSoldPrices(query);

    if (result) {
      console.log(`  130point: ${player} ${grade || 'Raw'} = $${result.marketValue} (${result.sampleSize} sales)`);
    }

    return result;
  }
}
