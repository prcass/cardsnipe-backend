/**
 * COMC (Check Out My Cards) Scraper
 *
 * Scrapes checkoutmycards.com for sports card listings.
 * No API key required - uses web scraping.
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export class COMCClient {
  constructor() {
    this.baseUrl = 'https://www.comc.com';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    };
  }

  /**
   * Search for cards on COMC
   */
  async searchListings({ query, sport, maxPrice = 500, limit = 50 }) {
    try {
      const searchUrl = `${this.baseUrl}/Cards?search=${encodeURIComponent(query)}&price_max=${maxPrice}`;

      const response = await fetch(searchUrl, { headers: this.headers });

      if (!response.ok) {
        console.error(`COMC search failed: ${response.status}`);
        return [];
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const listings = [];

      // Parse COMC listing cards
      $('.itemCard, .card-item, .listing-item').slice(0, limit).each((i, el) => {
        try {
          const $el = $(el);

          const title = $el.find('.title, .card-title, .item-title, a').first().text().trim();
          const priceText = $el.find('.price, .card-price, .item-price').text().trim();
          const price = parseFloat(priceText.replace(/[$,]/g, '')) || 0;
          const imageUrl = $el.find('img').attr('src') || $el.find('img').attr('data-src');
          const listingUrl = $el.find('a').attr('href');

          if (title && price > 0) {
            listings.push({
              title,
              currentPrice: price,
              imageUrl: imageUrl?.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`,
              listingUrl: listingUrl?.startsWith('http') ? listingUrl : `${this.baseUrl}${listingUrl}`,
              platform: 'comc',
              isAuction: false,
              bidCount: 0,
              ...this.parseCardDetails(title)
            });
          }
        } catch (e) {
          // Skip problematic listings
        }
      });

      console.log(`  COMC found ${listings.length} listings for "${query}"`);
      return listings;

    } catch (error) {
      console.error(`COMC search error: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract card details from title
   */
  parseCardDetails(title) {
    const result = {
      year: null,
      playerName: null,
      setName: null,
      grade: 'Raw',
      parallel: null,
      sport: null
    };

    if (!title) return result;

    const titleUpper = title.toUpperCase();

    // Extract year
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) result.year = parseInt(yearMatch[0]);

    // Extract grade
    const gradePatterns = [
      /PSA\s*(\d+)/i,
      /BGS\s*([\d.]+)/i,
      /SGC\s*(\d+)/i,
      /CGC\s*([\d.]+)/i
    ];

    for (const pattern of gradePatterns) {
      const match = title.match(pattern);
      if (match) {
        const grader = pattern.source.split('\\')[0].toUpperCase();
        result.grader = grader;
        result.grade = `${grader} ${match[1]}`;
        break;
      }
    }

    // Detect sport
    const basketballKeywords = ['PRIZM', 'OPTIC', 'SELECT', 'MOSAIC', 'HOOPS', 'NBA', 'BASKETBALL'];
    const baseballKeywords = ['TOPPS', 'BOWMAN', 'CHROME', 'MLB', 'BASEBALL'];

    if (basketballKeywords.some(kw => titleUpper.includes(kw))) {
      result.sport = 'basketball';
    } else if (baseballKeywords.some(kw => titleUpper.includes(kw))) {
      result.sport = 'baseball';
    }

    return result;
  }
}
