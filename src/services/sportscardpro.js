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

    // Extract common set names
    const sets = ['Prizm', 'Optic', 'Select', 'Mosaic', 'Contenders', 'Hoops', 'Donruss',
                  'Topps Chrome', 'Bowman', 'Upper Deck', 'Fleer', 'Panini', 'Revolution'];
    let set = null;
    for (const s of sets) {
      if (titleUpper.includes(s.toUpperCase())) {
        set = s;
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
  async getMarketValue({ player, year, set, grade, cardNumber, imageUrl, sport }) {
    let searchYear = year;
    let searchSet = set;
    let searchNumber = cardNumber;
    let searchPlayer = player;
    let searchGrade = grade;
    let searchParallel = null;
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

      // Always parse title to extract clean details
      const parsed = this.parseTitle(player);
      if (parsed.year) searchYear = parsed.year;
      if (parsed.set) searchSet = parsed.set;
      if (parsed.player) searchPlayer = parsed.player;
      if (parsed.parallel) searchParallel = parsed.parallel;
      if (parsed.isAuto) searchIsAuto = parsed.isAuto;
    }

    // Build SIMPLE query - just player name + optional set
    // Extract player from known list to avoid sending full eBay titles
    const players = ['LeBron James', 'Victor Wembanyama', 'Luka Doncic', 'Anthony Edwards',
      'Stephen Curry', 'Shohei Ohtani', 'Mike Trout', 'Julio Rodriguez', 'Gunnar Henderson', 'Juan Soto'];
    let cleanPlayer = searchPlayer;
    for (const p of players) {
      if (player && player.toLowerCase().includes(p.toLowerCase())) {
        cleanPlayer = p;
        break;
      }
    }

    // SIMPLE query - just player name to avoid OR keyword matching issues
    // The API matches ANY keyword, so "LeBron James Prizm" matches cards with just "James"
    // We'll filter by set/year/number in the results instead
    let query = cleanPlayer || '';
    query = query.trim();

    if (!query || query.length < 5) {
      console.log('  SportsCardPro: Query too short, skipping');
      return null;
    }

    // Log what we're searching for - all criteria must match
    console.log(`  SportsCardPro: Searching "${query}" #${searchNumber || '?'} ${searchYear || '?'} ${searchSet || '?'} ${searchParallel || 'base'}`);

    try {
      const products = await this.searchCards(query, searchSport);

      if (!products || products.length === 0) {
        console.log('  SportsCardPro: No results found');
        return null;
      }

      // Find best matching product - check if it actually matches our search
      let product = null;
      // Use cleanPlayer (e.g., "LeBron James") for name matching, not the full title
      const playerLower = (cleanPlayer || searchPlayer || '').toLowerCase().trim();
      const playerParts = playerLower.split(/\s+/);
      const firstName = playerParts[0] || '';
      const lastName = playerParts.length > 1 ? playerParts[playerParts.length - 1] : '';

      let cardCount = 0;
      let nameMatchCount = 0;
      for (const p of products) {
        const productName = (p['product-name'] || '').toLowerCase();
        const consoleName = (p['console-name'] || '').toLowerCase();

        // MUST be actual trading cards - check for known card brands or card categories
        const brands = ['panini', 'topps', 'fleer', 'upper deck', 'bowman', 'donruss', 'prizm', 'select', 'mosaic', 'optic', 'chrome',
          'basketball cards', 'baseball cards', 'football cards', 'hockey cards', 'soccer cards'];
        // Must NOT be Funko POP
        if (consoleName.includes('funko') || productName.includes('funko')) {
          continue;
        }
        const isTradingCard = brands.some(b => consoleName.includes(b) || productName.includes(b));
        if (!isTradingCard) {
          continue;
        }
        cardCount++;

        // Require BOTH first and last name to be in the product name
        const hasFirstName = firstName && productName.includes(firstName);
        const hasLastName = lastName && productName.includes(lastName);

        if (!hasFirstName || !hasLastName) {
          continue; // Skip if doesn't have both names
        }
        nameMatchCount++;

        // STRICT MATCHING - ALL criteria must match or skip

        // 1. Card number MUST be present and match
        if (!searchNumber) {
          continue; // Can't match without card #
        }
        const hasCardNumber = productName.includes('#' + searchNumber);
        if (!hasCardNumber) {
          continue;
        }

        // 2. Year MUST be present and match
        if (!searchYear) {
          continue; // Can't match without year
        }
        const yearMatch = consoleName.includes(searchYear) || productName.includes(searchYear);
        if (!yearMatch) {
          continue;
        }

        // 3. Set MUST be present and match exactly
        if (!searchSet) {
          continue; // Can't match without set
        }
        const searchSetLower = searchSet.toLowerCase();
        const setInConsole = consoleName.includes(searchSetLower);
        const setInProduct = productName.includes(searchSetLower);
        if (!setInConsole && !setInProduct) {
          continue;
        }

        // 4. Parallel must match (base = no parallel keyword in product)
        const searchParallelLower = (searchParallel || '').toLowerCase();
        if (searchParallelLower) {
          // Looking for specific parallel - must be in product
          const hasParallel = productName.includes(searchParallelLower) || consoleName.includes(searchParallelLower);
          if (!hasParallel) {
            continue;
          }
        }
        // If no parallel specified (base card), that's fine - we don't require "base" keyword

        // 5. Autograph status must match
        const productIsAuto = productName.includes('auto') || productName.includes('autograph') || productName.includes('signed');
        if (searchIsAuto !== productIsAuto) {
          continue;
        }

        // ALL CRITERIA MATCHED!
        product = p;
        console.log(`  SportsCardPro: MATCH ${p['console-name']} - ${p['product-name']}`);
        console.log(`    #${searchNumber}, ${searchYear}, ${searchSet}, ${searchParallel || 'base'}, auto=${searchIsAuto}`);
        break;
      }

      if (!product) {
        console.log(`  SportsCardPro: No match in ${products.length} results (${cardCount} cards, ${nameMatchCount} with name)`);
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
