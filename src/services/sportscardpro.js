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
    this.baseUrl = 'https://www.pricecharting.com';
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
   * Parse card details from eBay listing title
   */
  parseTitle(title) {
    const titleUpper = title.toUpperCase();

    // Extract year (4 digits, typically 19xx or 20xx)
    const yearMatch = title.match(/\b(19[89]\d|20[0-2]\d)\b/);
    const year = yearMatch ? yearMatch[1] : null;

    // Extract card number
    const numMatch = title.match(/#(\d+)/);
    const cardNumber = numMatch ? numMatch[1] : null;

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

    return { year, set, cardNumber, player };
  }

  /**
   * Get market value for a card
   * Searches by title and returns appropriate graded price
   */
  async getMarketValue({ player, year, set, grade, cardNumber, imageUrl }) {
    let searchYear = year;
    let searchSet = set;
    let searchNumber = cardNumber;
    let searchPlayer = player;
    let searchGrade = grade;

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

    let query = cleanPlayer || '';
    if (searchSet) query += ' ' + searchSet;
    if (searchYear) query += ' ' + searchYear;
    query = query.trim();

    if (!query || query.length < 5) {
      console.log('  SportsCardPro: Query too short, skipping');
      return null;
    }

    console.log(`  SportsCardPro: Searching "${query}"`);

    try {
      const products = await this.searchCards(query);

      if (!products || products.length === 0) {
        console.log('  SportsCardPro: No results found');
        return null;
      }

      // Find best matching product - check if it actually matches our search
      let product = null;
      const playerLower = (searchPlayer || '').toLowerCase().trim();
      const playerParts = playerLower.split(/\s+/);
      const firstName = playerParts[0] || '';
      const lastName = playerParts[playerParts.length - 1] || '';

      for (const p of products) {
        const productName = (p['product-name'] || '').toLowerCase();
        const consoleName = (p['console-name'] || '').toLowerCase();

        // MUST be actual cards, not Funko POPs
        if (!consoleName.includes('cards')) {
          continue;
        }

        // Require BOTH first and last name to be in the product name
        // This prevents "James Bond" matching for "LeBron James"
        const hasFirstName = firstName && productName.includes(firstName);
        const hasLastName = lastName && productName.includes(lastName);

        if (!hasFirstName || !hasLastName) {
          continue; // Skip if doesn't have both names
        }

        // Prefer if year matches
        if (!searchYear || productName.includes(searchYear)) {
          product = p;
          break;
        }
        if (!product) product = p; // Take first player match as fallback
      }

      if (!product) {
        console.log('  SportsCardPro: No matching product found in ' + products.length + ' results');
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
