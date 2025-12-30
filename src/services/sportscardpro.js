/**
 * SportsCardsPro API Integration
 *
 * Docs: https://www.sportscardspro.com/api-documentation
 * Requires paid subscription for API access
 */

import fetch from 'node-fetch';
import Tesseract from 'tesseract.js';
import { PSAClient } from './psa.js';

const psa = new PSAClient();
const hasPSACredentials = process.env.PSA_USERNAME && process.env.PSA_PASSWORD;

export class SportsCardProClient {
  constructor() {
    // Use sportscardspro.com for sports cards (pricecharting.com is for video games)
    this.baseUrl = 'https://www.sportscardspro.com';
    this.token = process.env.SPORTSCARDPRO_TOKEN;
  }

  /**
   * Extract PSA cert number from listing title
   * PSA certs are typically 8-10 digit numbers
   */
  extractPSACert(title) {
    // Look for patterns like "PSA 10 #12345678" or "Cert #12345678" or just long numbers
    const patterns = [
      /cert[#:\s]*(\d{7,10})/i,
      /psa[^0-9]*(\d{7,10})/i,
      /#(\d{8,10})\b/,
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match && match[1]) {
        // Verify it looks like a cert (not a card number which is usually 1-4 digits)
        const num = match[1];
        if (num.length >= 7) {
          return num;
        }
      }
    }
    return null;
  }


  /**
   * Extract PSA cert number from image using OCR
   * PSA slabs have the cert number printed on the label
   */
  async extractCertFromImage(imageUrl) {
    if (!imageUrl) return null;

    try {
      console.log(`  OCR: Scanning image for cert number...`);

      const { data: { text } } = await Tesseract.recognize(imageUrl, 'eng', {
        logger: () => {} // Suppress progress logs
      });

      // Look for cert number patterns in OCR text
      // PSA certs are typically 8-10 digit numbers
      const patterns = [
        /(\d{8,10})/g,  // Any 8-10 digit number
        /cert[#:\s]*(\d{7,10})/gi,
      ];

      for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
          for (const match of matches) {
            const num = match.replace(/\D/g, '');
            if (num.length >= 8 && num.length <= 10) {
              console.log(`  OCR: Found potential cert #${num}`);
              return num;
            }
          }
        }
      }

      console.log(`  OCR: No cert number found in image`);
      return null;
    } catch (e) {
      console.log(`  OCR failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Look up PSA cert to get exact card details
   */
  async lookupPSACert(certNumber) {
    if (!hasPSACredentials) return null;

    try {
      console.log(`  PSA: Looking up cert #${certNumber}`);
      const certInfo = await psa.getCertInfo(certNumber);

      if (certInfo && certInfo.PSACert) {
        const cert = certInfo.PSACert;
        console.log(`  PSA: Found ${cert.Year} ${cert.Brand} ${cert.Subject} #${cert.CardNumber}`);
        return {
          year: cert.Year,
          set: cert.Brand,
          player: cert.Subject,
          cardNumber: cert.CardNumber,
          grade: `PSA ${cert.CardGrade}`,
          category: cert.Category
        };
      }
    } catch (e) {
      console.log(`  PSA cert lookup failed: ${e.message}`);
    }
    return null;
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

    // Extract set from console name
    const consoleUpper = consoleName.toUpperCase();
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
    const parallels = ['silver', 'gold', 'blue', 'red', 'green', 'orange', 'purple', 'pink', 'black', 'white',
      'holo', 'refractor', 'wave', 'shimmer', 'disco', 'tiger', 'camo', 'ice', 'neon', 'pulsar', 'hyper',
      'pink ice', 'red ice', 'blue ice', 'green ice', 'purple ice', 'fast break', 'instant impact'];
    let parallel = null;
    for (const par of parallels) {
      if (titleUpper.includes(par.toUpperCase())) {
        parallel = par;
        break;
      }
    }

    // Check for autograph
    const isAuto = titleUpper.includes('AUTO') || titleUpper.includes('AUTOGRAPH') || titleUpper.includes('SIGNED');

    return { year, set, cardNumber, player, parallel, isAuto };
  }

  /**
   * Get market value for a card
   * Searches by title and returns appropriate graded price
   */
  async getMarketValue({ player, year, set, grade, cardNumber, parallel, imageUrl, sport }) {
    let searchYear = year;
    let searchSet = set;
    let searchNumber = cardNumber;
    let searchPlayer = player;
    let searchGrade = grade;
    let searchParallel = parallel || null;  // Use passed parallel if provided
    let searchIsAuto = false;
    const searchSport = sport;

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

    // If player is a full title, try to extract PSA cert first
    if (player && player.length > 30) {
      // Try to find PSA cert number in title
      let certNum = this.extractPSACert(player);
      if (certNum) {
        const certInfo = await this.lookupPSACert(certNum);
        if (certInfo) {
          // Use exact details from PSA database
          searchYear = certInfo.year;
          searchSet = certInfo.set;
          searchNumber = certInfo.cardNumber;
          searchPlayer = certInfo.player;
          searchGrade = certInfo.grade;
          console.log(`  Using PSA cert: ${searchYear} ${searchSet} ${searchPlayer} #${searchNumber}`);
        }
      }

      // If no cert in title, try OCR on image
      if (!certNum && imageUrl) {
        certNum = await this.extractCertFromImage(imageUrl);
        if (certNum) {
          const certInfo = await this.lookupPSACert(certNum);
          if (certInfo) {
            searchYear = certInfo.year;
            searchSet = certInfo.set;
            searchNumber = certInfo.cardNumber;
            searchPlayer = certInfo.player;
            searchGrade = certInfo.grade;
            console.log(`  Using OCR cert: ${searchYear} ${searchSet} ${searchPlayer} #${searchNumber}`);
          }
        }
      }

      // Parse title for player name and auto status only
      // Card number and parallel MUST come from eBay parser - no fallback
      const parsed = this.parseTitle(player);
      if (!searchYear && parsed.year) searchYear = parsed.year;
      if (!searchSet && parsed.set) searchSet = parsed.set;
      // NO fallback for cardNumber - must be provided by caller
      // NO fallback for parallel - must be provided by caller
      if (parsed.player) searchPlayer = parsed.player;
      if (parsed.isAuto) searchIsAuto = parsed.isAuto;
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
    // Format: "2019 Hoops Premium Stock LeBron James #87 Pulsar"
    const queryParts = [];
    if (searchYear) queryParts.push(searchYear);
    if (searchSet) queryParts.push(searchSet);
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
        const yearMatch = String(searchYear) === String(scpData.year);
        const setMatch = searchSet.toLowerCase() === (scpData.set || '').toLowerCase();
        const parallelMatch = (searchParallel || '').toLowerCase() === (scpData.parallel || '').toLowerCase();
        const autoMatch = searchIsAuto === scpData.isAuto;

        if (cardMatch && yearMatch && setMatch && parallelMatch && autoMatch) {
          product = p;
          console.log(`  SportsCardPro: EXACT MATCH found at result #${i + 1}`);
          console.log(`    ${scpData.year} ${scpData.set} #${scpData.cardNumber} ${scpData.parallel || 'base'}`);
          break;
        } else {
          // Log why it didn't match (only log if there are mismatches beyond parallel)
          const mismatches = [];
          if (!cardMatch) mismatches.push(`#${searchNumber}!=#${scpData.cardNumber}`);
          if (!yearMatch) mismatches.push(`yr${searchYear}!=yr${scpData.year}`);
          if (!setMatch) mismatches.push(`set`);
          if (!parallelMatch) mismatches.push(`par(${searchParallel || 'base'}!=${scpData.parallel || 'base'})`);
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

      console.log("  Grade for pricing: " + searchGrade); if (searchGrade) {
        const gradeUpper = searchGrade.toUpperCase();
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
