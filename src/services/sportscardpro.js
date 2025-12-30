/**
 * SportsCardsPro API Integration
 *
 * Docs: https://www.sportscardspro.com/api-documentation
 * Requires paid subscription for API access
 */

import fetch from 'node-fetch';
import { PSAClient } from './psa.js';

const psa = new PSAClient();
const hasPSACredentials = process.env.PSA_ACCESS_TOKEN || (process.env.PSA_USERNAME && process.env.PSA_PASSWORD);

export class SportsCardProClient {
  constructor() {
    // Use sportscardspro.com for sports cards (pricecharting.com is for video games)
    this.baseUrl = 'https://www.sportscardspro.com';
    this.token = process.env.SPORTSCARDPRO_TOKEN;
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

    // Extract insert set from console name (e.g., "2019 Panini Donruss Optic Splash" → "splash")
    const insertPatterns = [
      // Multi-word inserts (check first)
      't minus 3 2 1', 't-minus 3 2 1', 't-minus 3, 2, 1',  // T-Minus 3 2 1 insert
      'star gazing', 'lights out', 'express lane', 'winner stays', 'my house',
      'fantasy stars', 'zero gravity', 'game 7', 'instant impact', 'elite dominators',
      'global reach',
      // Single-word inserts
      'splash', 'rainmakers', 'all-stars', 'all stars', 'slam', 'courtside', 'skyview',
      'hoopla', 'ignition', 'superstars', 'emergent', 'sensational', 'supernova', 'vortex'
    ];
    const consoleLower = consoleName.toLowerCase();
    for (const insert of insertPatterns) {
      if (consoleLower.includes(insert)) {
        // Normalize all T-Minus variants to "t minus 3 2 1"
        let normalized = insert.replace(/-/g, ' ').replace(/,/g, '');
        result.insertSet = normalized;
        break;
      }
    }

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

    // Extract parallel/color variant
    // IMPORTANT: Check multi-word parallels FIRST before single colors
    // Otherwise "Blue Velocity" matches "Blue" and stops
    const parallels = [
      // Multi-word parallels (must check first)
      'red/white/blue', 'red white blue', 'red, white, blue', 'red white and blue',  // RWB variants
      'blue velocity', 'red velocity', 'green velocity', 'orange velocity', 'purple velocity',
      'blue pulsar', 'green pulsar', 'red pulsar', 'orange pulsar', 'purple pulsar',
      'pink ice', 'red ice', 'blue ice', 'green ice', 'purple ice',
      'fast break', 'instant impact', 'black gold',
      'blue shimmer', 'gold shimmer', 'red shimmer',
      'blue wave', 'red wave', 'gold wave',
      'hyper blue', 'hyper pink', 'hyper red',
      'neon green', 'neon orange', 'neon pink',
      'tiger camo', 'blue camo', 'green camo',
      'disco blue', 'disco red', 'disco gold',
      // Single-word parallels (check after compound names)
      'silver', 'gold', 'blue', 'red', 'green', 'orange', 'purple', 'pink', 'black', 'white',
      'holo', 'refractor', 'wave', 'shimmer', 'disco', 'tiger', 'camo', 'ice', 'neon', 'pulsar',
      'hyper', 'velocity', 'prizm', 'mojo', 'scope', 'fluorescent'
    ];
    let parallel = null;
    for (const par of parallels) {
      if (titleUpper.includes(par.toUpperCase())) {
        // Normalize variants to standard form
        if (par.includes('red') && par.includes('white') && par.includes('blue')) {
          parallel = 'red white blue';
        } else {
          parallel = par;
        }
        break;
      }
    }

    // Check for autograph
    const isAuto = titleUpper.includes('AUTO') || titleUpper.includes('AUTOGRAPH') || titleUpper.includes('SIGNED');

    // Extract insert set name (e.g., "Splash", "Rainmakers", "All-Stars")
    const insertPatterns = [
      // Multi-word inserts (check first)
      't minus 3 2 1', 't-minus 3 2 1', 't-minus 3, 2, 1',  // T-Minus 3 2 1 insert
      'star gazing', 'lights out', 'express lane', 'winner stays', 'my house',
      'fantasy stars', 'zero gravity', 'game 7', 'instant impact', 'elite dominators',
      'global reach',
      // Single-word inserts
      'splash', 'rainmakers', 'all-stars', 'all stars', 'slam', 'courtside', 'skyview',
      'hoopla', 'ignition', 'superstars', 'emergent', 'sensational', 'supernova', 'vortex'
    ];
    let insertSet = null;
    const titleLower = title.toLowerCase();
    for (const insert of insertPatterns) {
      if (titleLower.includes(insert)) {
        // Normalize all variants (hyphens, commas) to consistent format
        insertSet = insert.replace(/-/g, ' ').replace(/,/g, '');
        break;
      }
    }

    return { year, set, cardNumber, player, parallel, isAuto, insertSet };
  }

  /**
   * Get market value for a card
   * Searches by title and returns appropriate graded price
   */
  async getMarketValue({ player, year, set, grade, cardNumber, parallel, imageUrl, sport, certNumber }) {
    let searchYear = year;
    let searchSet = set;
    let searchNumber = cardNumber;
    let searchPlayer = player;
    let searchGrade = grade;
    let searchParallel = parallel || null;  // Use passed parallel if provided
    let searchIsAuto = false;
    let searchInsertSet = null;  // Insert sets like Splash, Rainmakers, All-Stars
    const searchSport = sport;

    // PRIORITY: If we have a PSA cert number, look it up for EXACT structured data
    if (certNumber && hasPSACredentials) {
      try {
        console.log(`  PSA: Looking up cert #${certNumber}`);
        const psaData = await psa.getCertInfo(certNumber);

        if (psaData && psaData.PSACert) {
          const cert = psaData.PSACert;
          console.log(`  PSA: Found ${cert.Year} ${cert.Brand} ${cert.Subject} #${cert.CardNumber} [${cert.Variety || 'Base'}]`);

          // Use PSA's structured data - much more reliable than title parsing!
          if (cert.Year) searchYear = cert.Year;
          if (cert.Brand) searchSet = cert.Brand;
          if (cert.CardNumber) searchNumber = cert.CardNumber;
          if (cert.Subject) searchPlayer = cert.Subject;
          if (cert.CardGrade) searchGrade = `PSA ${cert.CardGrade}`;
          if (cert.Variety) {
            // PSA Variety field contains parallel info (e.g., "Blue Wave Prizm", "Silver")
            searchParallel = cert.Variety.toLowerCase();
          }
          // Check if it's an auto from PSA data
          if (cert.Category && cert.Category.toLowerCase().includes('auto')) {
            searchIsAuto = true;
          }
        }
      } catch (e) {
        console.log(`  PSA lookup failed: ${e.message}`);
        // Fall back to title parsing
      }
    }

    // Extract grade from title if not provided
    if (!searchGrade && player) {
      const titleUpper = player.toUpperCase();
      if (titleUpper.includes("PSA 10") || titleUpper.includes("GEM MINT")) {
        searchGrade = "PSA 10";
      } else if (titleUpper.includes("PSA 9")) {
        searchGrade = "PSA 9";
      } else if (titleUpper.includes("BGS 10")) {
        searchGrade = "BGS 10";
      } else if (titleUpper.includes("BGS 9")) {
        searchGrade = "BGS 9";
      }
    }

    // Parse title for player name, auto status, and insert set (fallback if PSA lookup didn't populate)
    if (player && player.length > 30) {
      const parsed = this.parseTitle(player);
      if (!searchYear && parsed.year) searchYear = parsed.year;
      if (!searchSet && parsed.set) searchSet = parsed.set;
      if (parsed.player) searchPlayer = parsed.player;
      if (parsed.isAuto) searchIsAuto = parsed.isAuto;
      if (parsed.insertSet) searchInsertSet = parsed.insertSet;
    }

    // Extract clean player name from known list
    const players = ['LeBron James', 'Victor Wembanyama', 'Luka Doncic', 'Anthony Edwards',
      'Stephen Curry', 'Shohei Ohtani', 'Mike Trout', 'Julio Rodriguez', 'Gunnar Henderson', 'Juan Soto'];
    let cleanPlayer = searchPlayer;
    for (const p of players) {
      if (player && player.toLowerCase().includes(p.toLowerCase())) {
        cleanPlayer = p;
        break;
      }
    }

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

    console.log(`  SportsCardPro: Searching "${query}"`);

    try {
      const products = await this.searchCards(query, searchSport);

      if (!products || products.length === 0) {
        console.log('  SportsCardPro: No results found');
        return null;
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
        // Year match: allow +/- 1 year for seasons spanning two calendar years (e.g., 2019-20 season)
        const searchYearNum = parseInt(searchYear, 10);
        const scpYearNum = parseInt(scpData.year, 10);
        const yearMatch = !isNaN(searchYearNum) && !isNaN(scpYearNum) && Math.abs(searchYearNum - scpYearNum) <= 1;
        const setMatch = searchSet.toLowerCase() === (scpData.set || '').toLowerCase();

        // Parallel matching: be STRICT to avoid false matches
        // "Fast Break Purple" is NOT the same as "Purple Holo" - different parallel lines!
        const normalizeParallel = (p) => {
          if (!p) return '';
          return p.toLowerCase()
            .replace(/ prizm$/, '')  // "green prizm" → "green"
            .replace(/ refractor$/, '')  // "blue refractor" → "blue"
            .trim();
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
          console.log(`  SportsCardPro: EXACT MATCH found at result #${i + 1}`);
          console.log(`    ${scpData.year} ${scpData.set} ${scpData.insertSet || ''} #${scpData.cardNumber} ${scpData.parallel || 'base'}`);
          break;
        } else {
          // Log why it didn't match
          const mismatches = [];
          if (!cardMatch) mismatches.push(`#${searchNumber}!=#${scpData.cardNumber}`);
          if (!yearMatch) mismatches.push(`yr${searchYear}!=yr${scpData.year}`);
          if (!setMatch) mismatches.push(`set(${searchSet}!=${scpData.set})`);
          if (!parallelMatch) mismatches.push(`par(${searchParNorm || 'base'}!=${scpParNorm || 'base'})`);
          if (!insertMatch) mismatches.push(`insert(${searchInsertSet}!=${scpData.insertSet || 'none'})`);
          if (mismatches.length > 0) {
            console.log(`    #${i + 1}: ${mismatches.join(', ')}`);
          }
        }
      }

      if (!product) {
        console.log(`  SportsCardPro: No exact match in top ${maxToCheck} results`);
        return null;
      }

      // Get price based on grade (prices are in pennies)
      let priceInPennies = null;
      let priceKey = 'loose-price'; // default to ungraded

      console.log("  Grade for pricing: " + searchGrade);
      if (searchGrade) {
        const gradeUpper = searchGrade.toUpperCase();
        // IMPORTANT: Check for specific grades (PSA 9, PSA 10) BEFORE generic terms like "GEM"
        // This prevents "Gem Mint" without a number from defaulting to PSA 10
        if (gradeUpper.includes('PSA 9') || gradeUpper.includes('BGS 9') || gradeUpper.includes('BGS 9.5')) {
          priceKey = 'graded-price'; // PSA 9 / BGS 9 / BGS 9.5
          priceInPennies = product['graded-price'];
        } else if (gradeUpper.includes('PSA 10') || gradeUpper.includes('BGS 10') ||
                   (gradeUpper.includes('GEM') && gradeUpper.includes('10'))) {
          priceKey = 'manual-only-price'; // Top grade (PSA 10/BGS 10)
          priceInPennies = product['manual-only-price'] || product['bgs-10-price'];
        } else if (gradeUpper.includes('PSA 8') || gradeUpper.includes('BGS 8')) {
          priceKey = 'new-price'; // PSA 8 / BGS 8.5
          priceInPennies = product['new-price'];
        }
      }

      // Fallback to loose price if graded price not available
      if (!priceInPennies) console.log('  No graded price. PSA10=' + product['manual-only-price'] + ' PSA9=' + product['graded-price'] + ' loose=' + product['loose-price']);
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
