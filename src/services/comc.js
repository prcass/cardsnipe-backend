/**
 * COMC (Check Out My Cards) Client
 *
 * Scrapes comc.com for sports card listings using fetch + cheerio
 * No Puppeteer required - works on Railway without Chrome
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { cardSets } from './card-sets.js';

export class COMCClient {
  constructor() {
    this.baseUrl = 'https://www.comc.com';
  }

  /**
   * Search for cards on COMC
   * Note: COMC doesn't filter well by search query, so we fetch and filter client-side
   */
  async searchListings({ query, sport, limit = 30 }) {
    try {
      // Extract player name from query for filtering
      const playerPatterns = [
        /lebron james/i, /victor wembanyama/i, /luka doncic/i, /anthony edwards/i,
        /stephen curry/i, /shohei ohtani/i, /mike trout/i, /julio rodriguez/i,
        /gunnar henderson/i, /juan soto/i, /zion williamson/i, /ja morant/i
      ];
      let playerName = null;
      for (const p of playerPatterns) {
        if (p.test(query)) {
          playerName = query.match(p)[0].toLowerCase();
          break;
        }
      }

      // Build COMC search URL
      const searchTerm = query.replace(/\s+/g, '+');
      const searchUrl = `${this.baseUrl}/Cards,sb,i100,${searchTerm}`;
      console.log(`  COMC: Fetching ${searchUrl}`);

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const listings = [];

      // COMC uses divs with class "cardinfo searchresult" for card listings
      $('.cardinfo.searchresult').each((i, el) => {
        if (listings.length >= limit) return;

        try {
          const $card = $(el);
          const text = $card.text();

          // Get the card link - usually in the title area
          const $link = $card.find('a').first();
          let title = $link.text().trim();
          const listingUrl = $link.attr('href');

          // If no title from link, try carddata
          if (!title) {
            title = $card.find('.carddata').text().trim();
          }

          // Clean up title - remove extra whitespace and newlines
          title = title.replace(/\s+/g, ' ').trim();

          // Skip if no title
          if (!title || title.length < 10) return;

          // Filter by player name if we have one
          if (playerName && !title.toLowerCase().includes(playerName)) {
            return;  // Skip cards that don't match player
          }

          // Extract price - look for dollar amounts
          const priceMatches = text.match(/\$[\d,]+\.?\d*/g);
          let price = 0;
          if (priceMatches) {
            for (const pm of priceMatches) {
              const val = parseFloat(pm.replace(/[$,]/g, ''));
              if (val >= 1 && val < 10000) {
                price = val;
                break;
              }
            }
          }

          // Get image
          const $img = $card.find('img').first();
          let imageUrl = $img.attr('src') || '';
          if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = `https://img.comc.com${imageUrl}`;
          }

          if (price > 0) {
            const parsed = this.parseCardDetails(title);
            listings.push({
              title: title.substring(0, 200),
              currentPrice: price,
              imageUrl,
              listingUrl: listingUrl ? (listingUrl.startsWith('http') ? listingUrl : `${this.baseUrl}${listingUrl}`) : '',
              platform: 'comc',
              isAuction: false,
              bidCount: 0,
              ...parsed
            });
          }
        } catch (e) {
          // Skip malformed cards
        }
      });

      // Fallback: try table rows if no cardinfo elements found
      if (listings.length === 0) {
        $('table tr').each((i, row) => {
          if (listings.length >= limit) return;

          try {
            const $row = $(row);
            const rowText = $row.text();
            if (!rowText.includes('$')) return;

            const $link = $row.find('a').first();
            let title = $link.text().trim();
            const listingUrl = $link.attr('href');

            const priceMatches = rowText.match(/\$[\d,]+\.?\d*/g);
            let price = 0;
            if (priceMatches) {
              for (const pm of priceMatches) {
                const val = parseFloat(pm.replace(/[$,]/g, ''));
                if (val >= 1 && val < 10000) {
                  price = val;
                  break;
                }
              }
            }

            const $img = $row.find('img').first();
            const imageUrl = $img.attr('src') || '';

            if (title.length > 10 && price > 0) {
              const parsed = this.parseCardDetails(title);
              listings.push({
                title: title.substring(0, 200),
                currentPrice: price,
                imageUrl: imageUrl.startsWith('http') ? imageUrl : '',
                listingUrl: listingUrl ? `${this.baseUrl}${listingUrl}` : '',
                platform: 'comc',
                isAuction: false,
                bidCount: 0,
                ...parsed
              });
            }
          } catch (e) {}
        });
      }

      console.log(`  COMC found ${listings.length} listings`);
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
      setName: null,
      cardNumber: null,
      grade: 'Raw',
      parallel: null,
      insertSet: null,
      sport: null
    };

    if (!title) return result;

    const titleUpper = title.toUpperCase();

    // Extract year
    const yearMatch = title.match(/\b(19[89]\d|20[0-2]\d)\b/);
    if (yearMatch) result.year = yearMatch[0];

    // Extract card number
    const numMatch = title.match(/#(\d{1,4})\b/);
    if (numMatch) result.cardNumber = numMatch[1];

    // Extract grade
    const gradePatterns = [
      { pattern: /PSA\s*(\d+)/i, grader: 'PSA' },
      { pattern: /BGS\s*([\d.]+)/i, grader: 'BGS' },
      { pattern: /SGC\s*(\d+)/i, grader: 'SGC' },
      { pattern: /CGC\s*([\d.]+)/i, grader: 'CGC' },
      { pattern: /CSG\s*(\d+)/i, grader: 'CSG' }
    ];

    for (const { pattern, grader } of gradePatterns) {
      const match = title.match(pattern);
      if (match) {
        result.grade = `${grader} ${match[1]}`;
        break;
      }
    }

    // Extract parallel using CardSets service
    result.parallel = cardSets.detectParallel(title);

    // Extract insert set using CardSets service
    result.insertSet = cardSets.detectInsert(title);

    // Detect set name
    const setPatterns = [
      { pattern: /PRIZM/i, name: 'Prizm' },
      { pattern: /OPTIC/i, name: 'Optic' },
      { pattern: /SELECT/i, name: 'Select' },
      { pattern: /MOSAIC/i, name: 'Mosaic' },
      { pattern: /HOOPS/i, name: 'Hoops' },
      { pattern: /DONRUSS/i, name: 'Donruss' },
      { pattern: /TOPPS\s*CHROME/i, name: 'Topps Chrome' },
      { pattern: /BOWMAN\s*CHROME/i, name: 'Bowman Chrome' },
      { pattern: /TOPPS/i, name: 'Topps' },
      { pattern: /BOWMAN/i, name: 'Bowman' }
    ];

    for (const { pattern, name } of setPatterns) {
      if (pattern.test(title)) {
        result.setName = name;
        break;
      }
    }

    // Detect sport
    const basketballKeywords = ['PRIZM', 'OPTIC', 'SELECT', 'MOSAIC', 'HOOPS', 'NBA', 'BASKETBALL', 'PANINI'];
    const baseballKeywords = ['TOPPS', 'BOWMAN', 'MLB', 'BASEBALL'];
    const footballKeywords = ['FOOTBALL', 'NFL'];

    if (basketballKeywords.some(kw => titleUpper.includes(kw))) {
      result.sport = 'basketball';
    } else if (baseballKeywords.some(kw => titleUpper.includes(kw))) {
      result.sport = 'baseball';
    } else if (footballKeywords.some(kw => titleUpper.includes(kw))) {
      result.sport = 'football';
    }

    return result;
  }
}
