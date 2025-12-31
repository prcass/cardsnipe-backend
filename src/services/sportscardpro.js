/**
 * SportsCardsPro API Integration
 *
 * Docs: https://www.sportscardspro.com/api-documentation
 * Requires paid subscription for API access
 */

import fetch from 'node-fetch';
import { cardSets } from './card-sets.js';

export class SportsCardProClient {
  constructor() {
    // Use sportscardspro.com for sports cards (pricecharting.com is for video games)
    this.baseUrl = 'https://www.sportscardspro.com';
    this.token = process.env.SPORTSCARDPRO_TOKEN;

    // Rate limiting: max 2 requests per second to avoid 429 errors
    this.lastRequestTime = 0;
    this.minRequestInterval = 500; // 500ms between requests
  }

  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(r => setTimeout(r, this.minRequestInterval - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Get category name for sport
   */
  getCategoryForSport(sport) {
    const categories = {
      'basketball': 'Basketball Cards',
      'baseball': 'Baseball Cards',
      'football': 'Football Cards'
    };
    return categories[sport?.toLowerCase()] || null;
  }

  /**
   * Parse SportsCardPro product info to extract structured data
   * Example: console="2024 Panini Prizm", product="LeBron James [Green Pulsar] #130"
   */
  parseSCPProduct(consoleName, productName) {
    const result = {
      year: null,
      set: null,
      insertSet: null,  // Insert sets like Splash, Rainmakers, All-Stars
      cardNumber: null,
      parallel: null,
      isAuto: false
    };

    // Extract year from console name (e.g., "2024 Panini Prizm" → 2024)
    const yearMatch = consoleName.match(/\b(19[89]\d|20[0-2]\d)\b/);
    if (yearMatch) result.year = yearMatch[1];

    // Extract card number from product name (e.g., "#130" → "130")
    const cardMatch = productName.match(/#(\d{1,4})\b/);
    if (cardMatch) result.cardNumber = cardMatch[1];

    // Extract parallel from product name (e.g., "[Green Pulsar]" → "green pulsar")
    const parallelMatch = productName.match(/\[([^\]]+)\]/);
    if (parallelMatch) {
      result.parallel = parallelMatch[1].toLowerCase().trim();
    }

    // Also check console name for parallel indicators (e.g., "2012 Panini Prizm Silver")
    // This catches cases where parallel is in console name, not brackets
    if (!result.parallel) {
      const combined = (consoleName + ' ' + productName).toLowerCase();
      const parallelIndicators = [
        'silver prizm', 'gold prizm', 'blue prizm', 'red prizm', 'green prizm',
        'orange prizm', 'purple prizm', 'pink prizm', 'black prizm',
        'silver', 'gold', 'blue', 'red', 'green', 'orange', 'purple', 'pink', 'black',
        'holo', 'refractor', 'mojo', 'shimmer', 'ice', 'wave', 'velocity'
      ];
      for (const p of parallelIndicators) {
        // Check if it's actually a parallel marker, not just part of set name
        // Skip if it's just "Prizm" in "Panini Prizm" (set name)
        if (combined.includes(p) && !combined.match(new RegExp(`panini\\s+${p}\\b`))) {
          result.parallel = p;
          break;
        }
      }
    }

    // Extract insert set from console name using CardSets data service
    result.insertSet = cardSets.detectInsert(consoleName);

    // Extract set from console name
    const setPatterns = [
      { pattern: /PRIZM\s+GLOBAL\s+REACH/i, name: 'prizm global reach' },
      { pattern: /PRIZM\s+DRAFT\s+PICKS/i, name: 'prizm draft picks' },
      { pattern: /HOOPS\s*PREMIUM\s*STOCK/i, name: 'hoops premium stock' },
      { pattern: /TOPPS\s*CHROME/i, name: 'topps chrome' },
      { pattern: /BOWMAN\s*CHROME/i, name: 'bowman chrome' },
      { pattern: /\bPRIZM\b/i, name: 'prizm' },
      { pattern: /\bOPTIC\b/i, name: 'optic' },
      { pattern: /\bSELECT\b/i, name: 'select' },
      { pattern: /\bMOSAIC\b/i, name: 'mosaic' },
      { pattern: /\bHOOPS\b/i, name: 'hoops' },
      { pattern: /\bDONRUSS\b/i, name: 'donruss' },
      { pattern: /\bCONTENDERS\b/i, name: 'contenders' },
      { pattern: /\bBOWMAN\b/i, name: 'bowman' },
      { pattern: /\bTOPPS\b/i, name: 'topps' },
    ];
    for (const { pattern, name } of setPatterns) {
      if (pattern.test(consoleName)) {
        result.set = name;
        break;
      }
    }

    // Check for autograph
    const combined = (consoleName + ' ' + productName).toLowerCase();
    result.isAuto = combined.includes('auto') || combined.includes('autograph') || combined.includes('signed');

    return result;
  }

  /**
   * Search for cards and get prices
   * Returns up to 20 matching results
   */
  async searchCards(query, sport) {
    if (!this.token) {
      throw new Error('SPORTSCARDPRO_TOKEN not configured');
    }

    // Rate limit to avoid 429 errors
    await this.rateLimit();

    // Simple query - just the player name
    // API uses OR matching so extra keywords cause false matches
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
   * Parse card details from eBay listing title
   */
  parseTitle(title) {
    const titleUpper = title.toUpperCase();

    // Extract year (4 digits, typically 19xx or 20xx)
    const yearMatch = title.match(/\b(19[89]\d|20[0-2]\d)\b/);
    const year = yearMatch ? yearMatch[1] : null;

    // Extract card number - try multiple patterns
    let cardNumber = null;
    const cardNumPatterns = [
      /#(\d{1,4})\b/,           // #129, #1, #1234
      /\bNo\.?\s*(\d{1,4})\b/i, // No. 129, No 129
      /\bCard\s*#?(\d{1,4})\b/i, // Card #129, Card 129
      /\s(\d{1,4})\/\d+\b/,     // 129/500 (numbered cards)
    ];
    for (const pattern of cardNumPatterns) {
      const match = title.match(pattern);
      if (match && match[1]) {
        cardNumber = match[1];
        break;
      }
    }

    // Extract common set names - check for full set patterns first
    // Avoid matching parallel names like "Pulsar Prizm" as the set
    // Check specific insert sets FIRST, then base sets
    const setPatterns = [
      // Specific Prizm insert sets (must check before base "Prizm")
      { pattern: /PRIZM\s+GLOBAL\s+REACH/i, name: 'Prizm Global Reach' },
      { pattern: /PRIZM\s+DRAFT\s+PICKS/i, name: 'Prizm Draft Picks' },
      { pattern: /PRIZM\s+INSTANT\s+IMPACT/i, name: 'Prizm Instant Impact' },
      { pattern: /PRIZM\s+EMERGENT/i, name: 'Prizm Emergent' },
      { pattern: /PRIZM\s+SENSATIONAL/i, name: 'Prizm Sensational' },
      // Other specific sets
      { pattern: /HOOPS\s*PREMIUM\s*STOCK/i, name: 'Hoops Premium Stock' },
      { pattern: /TOPPS\s*CHROME/i, name: 'Topps Chrome' },
      { pattern: /BOWMAN\s*CHROME/i, name: 'Bowman Chrome' },
      { pattern: /UPPER\s*DECK/i, name: 'Upper Deck' },
      // Base sets - year + set name pattern (e.g., "2023 Prizm")
      { pattern: /\b20\d{2}[-\s]+PRIZM\b/i, name: 'Prizm' },
      { pattern: /\b20\d{2}[-\s]+OPTIC\b/i, name: 'Optic' },
      { pattern: /\b20\d{2}[-\s]+SELECT\b/i, name: 'Select' },
      { pattern: /\b20\d{2}[-\s]+MOSAIC\b/i, name: 'Mosaic' },
      { pattern: /PANINI\s+PRIZM\b/i, name: 'Prizm' },
      { pattern: /PANINI\s+OPTIC/i, name: 'Optic' },
      { pattern: /DONRUSS\s+OPTIC/i, name: 'Optic' },
      { pattern: /PANINI\s+SELECT/i, name: 'Select' },
      { pattern: /PANINI\s+MOSAIC/i, name: 'Mosaic' },
      { pattern: /PANINI\s+CONTENDERS/i, name: 'Contenders' },
      { pattern: /\bHOOPS\b/i, name: 'Hoops' },
      { pattern: /\bDONRUSS\b/i, name: 'Donruss' },
      { pattern: /\bBOWMAN\b/i, name: 'Bowman' },
      { pattern: /\bFLEER\b/i, name: 'Fleer' },
      { pattern: /\bREVOLUTION\b/i, name: 'Revolution' },
    ];
    let set = null;
    for (const { pattern, name } of setPatterns) {
      if (pattern.test(title)) {
        set = name;
        break;
      }
    }

    // Extract player name (look for known patterns)
    const playerPatterns = [
      /lebron james/i, /victor wembanyama/i, /luka doncic/i, /anthony edwards/i,
      /stephen curry/i, /shohei ohtani/i, /mike trout/i, /julio rodriguez/i,
      /gunnar henderson/i, /juan soto/i
    ];
    let player = null;
    for (const p of playerPatterns) {
      const match = title.match(p);
      if (match) {
        player = match[0];
        break;
      }
    }

    // Extract parallel/color variant using CardSets data service
    const parallel = cardSets.detectParallel(title);

    // Check for autograph
    const isAuto = titleUpper.includes('AUTO') || titleUpper.includes('AUTOGRAPH') || titleUpper.includes('SIGNED');

    // Extract insert set name using CardSets data service
    const insertSet = cardSets.detectInsert(title);

    return { year, set, cardNumber, player, parallel, isAuto, insertSet };
  }

  /**
   * Get market value for a card
   * Searches by title and returns appropriate graded price
   */
  async getMarketValue({ player, year, set, grade, cardNumber, parallel, imageUrl, sport }) {
    // Player name is now passed directly from the scanner (e.g., "Joel Embiid")
    const searchYear = year;
    const searchSet = set;
    const searchNumber = cardNumber;
    const searchGrade = grade;
    const searchParallel = parallel || null;
    const searchIsAuto = false;  // TODO: detect from eBay aspects if needed
    const searchInsertSet = null;  // TODO: detect from eBay aspects if needed
    const searchSport = sport;
    const cleanPlayer = player;  // Already clean from scanner

    // REQUIRED: Must have card number, year, and set to search
    if (!searchNumber) {
      console.log('  SportsCardPro: Card # not found, skipping');
      return null;
    }
    if (!searchYear) {
      console.log('  SportsCardPro: Year not found, skipping');
      return null;
    }
    if (!searchSet) {
      console.log('  SportsCardPro: Set not found, skipping');
      return null;
    }

    // BUILD SPECIFIC QUERY using all eBay data for exact match
    // Format: "2019 Optic Splash Stephen Curry #4 Holo"
    const queryParts = [];
    if (searchYear) queryParts.push(searchYear);
    if (searchSet) queryParts.push(searchSet);
    if (searchInsertSet) queryParts.push(searchInsertSet);  // Include insert set (Splash, Rainmakers, etc.)
    if (cleanPlayer) queryParts.push(cleanPlayer);
    if (searchNumber) queryParts.push('#' + searchNumber);
    if (searchParallel) queryParts.push(searchParallel);

    const query = queryParts.join(' ').trim();

    try {
      const products = await this.searchCards(query, searchSport);

      if (!products || products.length === 0) {
        return { error: 'no SCP results' };
      }

      // With specific query, check first few results for exact match
      let product = null;
      const maxToCheck = Math.min(products.length, 5); // Only check top 5 results

      for (let i = 0; i < maxToCheck; i++) {
        const p = products[i];
        const productName = (p['product-name'] || '');
        const consoleName = (p['console-name'] || '');

        // Skip non-cards
        if (consoleName.toLowerCase().includes('funko')) continue;

        // Parse SportsCardPro product
        const scpData = this.parseSCPProduct(consoleName, productName);

        // Check for EXACT match on all criteria (normalize types)
        const cardMatch = String(searchNumber) === String(scpData.cardNumber);
        const yearMatch = String(searchYear) === String(scpData.year);
        const setMatch = searchSet.toLowerCase() === (scpData.set || '').toLowerCase();

        // Parallel matching: be STRICT to avoid false matches
        // "Orange Prizm" is different from "Orange" - do NOT strip suffixes!
        const normalizeParallel = (p) => {
          if (!p) return '';
          return p.toLowerCase().trim();
        };

        // Simple color names (can use flexible matching with these only)
        const simpleColors = ['silver', 'gold', 'blue', 'red', 'green', 'orange', 'purple', 'pink', 'black', 'white', 'bronze', 'yellow'];

        const searchParNorm = normalizeParallel(searchParallel);
        const scpParNorm = normalizeParallel(scpData.parallel);

        // Parallel match logic:
        // - Base card (no parallel) should ONLY match base card
        // - Complex parallels (Fast Break, Velocity, Holo, etc.) require EXACT match
        // - Simple colors can match with prizm/refractor suffix variations
        let parallelMatch;
        if (!searchParNorm && !scpParNorm) {
          parallelMatch = true;  // Both are base cards
        } else if (!searchParNorm || !scpParNorm) {
          parallelMatch = false;  // One is base, one is parallel - no match
        } else if (searchParNorm === scpParNorm) {
          parallelMatch = true;  // Exact match after normalization
        } else if (simpleColors.includes(searchParNorm) && scpParNorm.endsWith(searchParNorm)) {
          // Allow "purple" to match "purple" in "fast break purple" only if search is simple color
          // BUT this is risky - "purple" should NOT match "fast break purple"
          // Only allow if SCP is just the color with common suffix
          parallelMatch = simpleColors.includes(scpParNorm) || scpParNorm === searchParNorm;
        } else if (simpleColors.includes(scpParNorm) && searchParNorm.endsWith(scpParNorm)) {
          parallelMatch = simpleColors.includes(searchParNorm) || searchParNorm === scpParNorm;
        } else {
          // Complex parallels must match exactly
          parallelMatch = false;
        }

        const autoMatch = searchIsAuto === scpData.isAuto;
        // Insert set must match if specified (e.g., Splash vs Rainmakers vs All-Stars)
        const insertMatch = !searchInsertSet || (searchInsertSet.toLowerCase() === (scpData.insertSet || '').toLowerCase());

        if (cardMatch && yearMatch && setMatch && parallelMatch && autoMatch && insertMatch) {
          product = p;
          product._matchedTo = `${scpData.year} ${scpData.set} ${scpData.insertSet || ''} #${scpData.cardNumber} ${scpData.parallel || 'base'}`.replace(/\s+/g, ' ').trim();
          break;
        } else {
          // Track closest mismatch reason for logging
          if (i === 0) {
            const mismatches = [];
            if (!parallelMatch) mismatches.push(`par:${searchParNorm || 'base'}!=${scpParNorm || 'base'}`);
            if (!setMatch) mismatches.push(`set:${searchSet}!=${scpData.set}`);
            if (!yearMatch) mismatches.push(`yr:${searchYear}!=${scpData.year}`);
            if (!cardMatch) mismatches.push(`#${searchNumber}!=#${scpData.cardNumber}`);
            if (!insertMatch) mismatches.push(`insert:${searchInsertSet}!=${scpData.insertSet || 'none'}`);
            product = { _noMatch: true, _reason: mismatches.join(', ') };
          }
        }
      }

      if (!product || product._noMatch) {
        return { error: product?._reason || 'no match in results' };
      }

      // Get price based on grade (prices are in pennies)
      let priceInPennies = null;
      let priceKey = 'loose-price';

      if (searchGrade) {
        const gradeUpper = searchGrade.toUpperCase();
        if (gradeUpper.includes('PSA 9') || gradeUpper.includes('BGS 9') || gradeUpper.includes('BGS 9.5')) {
          priceKey = 'graded-price';
          priceInPennies = product['graded-price'];
        } else if (gradeUpper.includes('PSA 10') || gradeUpper.includes('BGS 10') ||
                   (gradeUpper.includes('GEM') && gradeUpper.includes('10'))) {
          priceKey = 'manual-only-price';
          priceInPennies = product['manual-only-price'] || product['bgs-10-price'];
        } else if (gradeUpper.includes('PSA 8') || gradeUpper.includes('BGS 8')) {
          priceKey = 'new-price';
          priceInPennies = product['new-price'];
        }
      }

      // Fallback to loose price if graded price not available
      if (!priceInPennies) {
        priceInPennies = product['loose-price'];
        priceKey = 'loose-price';
      }

      if (!priceInPennies || priceInPennies <= 0) {
        return { error: 'no price data' };
      }

      const marketValue = priceInPennies / 100;
      const sourceUrl = product['product-url'] ||
        `https://www.sportscardspro.com/game/${encodeURIComponent(product['console-name'] || 'sports-cards')}/${encodeURIComponent(product['product-name'] || query)}`;

      return {
        marketValue,
        source: 'sportscardpro',
        sourceUrl,
        matchedTo: product._matchedTo,
        productName: product['product-name'],
        productId: product['id'],
        priceType: priceKey,
        lastUpdated: new Date()
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}
