/**
 * eBay Browse API Integration
 * 
 * Handles OAuth authentication and listing searches for sports cards.
 * Docs: https://developer.ebay.com/api-docs/buy/browse/overview.html
 */

import fetch from 'node-fetch';

export class EbayClient {
  constructor() {
    this.clientId = process.env.EBAY_CLIENT_ID;
    this.clientSecret = process.env.EBAY_CLIENT_SECRET;
    this.environment = process.env.EBAY_ENVIRONMENT || 'PRODUCTION';
    
    this.baseUrl = this.environment === 'PRODUCTION'
      ? 'https://api.ebay.com'
      : 'https://api.sandbox.ebay.com';
    
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(`${this.baseUrl}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`eBay OAuth failed: ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1 min buffer

    console.log('✅ eBay OAuth token refreshed');
    return this.accessToken;
  }

  // ============================================
  // SEARCH LISTINGS
  // ============================================

  /**
   * Search for sports card listings
   * @param {Object} params - Search parameters
   * @param {string} params.query - Search query (e.g., "LeBron James Prizm PSA 10")
   * @param {string} params.sport - 'basketball' | 'baseball'
   * @param {string} params.buyingOption - 'FIXED_PRICE' | 'AUCTION' | 'ALL'
   * @param {number} params.minPrice - Minimum price filter
   * @param {number} params.maxPrice - Maximum price filter
   * @param {string} params.sort - 'endingSoonest' | 'price' | 'newlyListed'
   * @param {number} params.limit - Results per page (max 200)
   */
  async searchListings(params = {}) {
    const token = await this.getAccessToken();

    // eBay category IDs
    const categoryMap = {
      basketball: '214', // Basketball Cards
      baseball: '213',   // Baseball Cards
      all: '212'         // Sports Trading Cards (parent)
    };

    const categoryId = categoryMap[params.sport] || categoryMap.all;

    // Build filter string
    const filters = [];
    
    if (params.buyingOption && params.buyingOption !== 'ALL') {
      filters.push(`buyingOptions:{${params.buyingOption}}`);
    }
    
    if (params.minPrice || params.maxPrice) {
      const min = params.minPrice || 0;
      const max = params.maxPrice || 10000;
      filters.push(`price:[${min}..${max}]`);
    }

    // Build URL
    const queryParams = new URLSearchParams({
      q: params.query || '',
      category_ids: categoryId,
      limit: Math.min(params.limit || 50, 200).toString(),
      sort: params.sort || 'endingSoonest'
    });

    if (filters.length > 0) {
      queryParams.append('filter', filters.join(','));
    }

    const url = `${this.baseUrl}/buy/browse/v1/item_summary/search?${queryParams}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<YOUR_CAMPAIGN_ID>' // Optional: for affiliate $
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`eBay search failed: ${error}`);
    }

    const data = await response.json();
    const listings = this.transformListings(data.itemSummaries || []);

    // Filter to only PSA 9 and PSA 10 graded cards
    return listings.filter(listing => this.isPSA9or10(listing));
  }

  /**
   * Check if a listing is PSA 9 or PSA 10
   */
  isPSA9or10(listing) {
    const title = (listing.title || '').toUpperCase();
    const grade = (listing.grade || '').toUpperCase();
    return title.includes('PSA 10') || title.includes('PSA 9') ||
           grade.includes('PSA 10') || grade.includes('PSA 9');
  }

  /**
   * Get single item details
   */
  async getItemDetails(itemId) {
    const token = await this.getAccessToken();

    const response = await fetch(
      `${this.baseUrl}/buy/browse/v1/item/${itemId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch item ${itemId}`);
    }

    return response.json();
  }

  // ============================================
  // DATA TRANSFORMATION
  // ============================================

  transformListings(items) {
    return items.map(item => {
      // Extract structured data from eBay's localizedAspects (item specifics)
      const aspects = this.extractAspects(item.localizedAspects || []);

      // Log cert-related aspects for debugging
      this.logAspects(item.localizedAspects, item.title);

      // ALWAYS parse title for parallel detection (eBay aspects often have generic "Blue" instead of "Blue Velocity")
      // Also parse for other fields if aspects are missing
      const parsedFromTitle = this.parseCardDetails(item.title);

      return {
        ebayItemId: item.itemId,
        title: item.title,
        currentPrice: parseFloat(item.price?.value || 0),
        currency: item.price?.currency || 'USD',
        isAuction: item.buyingOptions?.includes('AUCTION') || false,
        auctionEndTime: item.itemEndDate ? new Date(item.itemEndDate) : null,
        bidCount: item.bidCount || 0,
        imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl,
        listingUrl: item.itemWebUrl,
        condition: item.condition,
        sellerName: item.seller?.username,
        sellerRating: item.seller?.feedbackPercentage,
        sellerFeedbackCount: item.seller?.feedbackScore,
        location: item.itemLocation?.postalCode,
        shippingCost: item.shippingOptions?.[0]?.shippingCost?.value || null,
        watchCount: item.watchCount || 0,

        // Prefer structured eBay aspects, fall back to parsed title
        year: aspects.year || parsedFromTitle.year,
        setName: aspects.setName || parsedFromTitle.setName,
        cardNumber: aspects.cardNumber || parsedFromTitle.cardNumber,
        // For parallel: prefer the MORE SPECIFIC name (title often has "Blue Velocity" while aspects just say "Blue")
        parallel: this.getBetterParallel(aspects.parallel, parsedFromTitle.parallel),
        playerName: aspects.playerName || parsedFromTitle.playerName,
        grader: aspects.grader || parsedFromTitle.grader,
        grade: aspects.grade || parsedFromTitle.grade,
        certNumber: aspects.certNumber || this.extractCertFromTitle(item.title),  // PSA cert for API lookup
        sport: aspects.sport || parsedFromTitle.sport,
        isAuto: aspects.isAuto || parsedFromTitle.isAuto || false,
      };
    });
  }

  /**
   * Choose the more specific parallel name between aspects and title parsing
   * eBay aspects might say "Blue" while title has "Blue Velocity" - prefer the longer/more specific one
   */
  getBetterParallel(aspectsParallel, titleParallel) {
    if (!aspectsParallel && !titleParallel) return null;
    if (!aspectsParallel) return titleParallel;
    if (!titleParallel) return aspectsParallel;

    const aspectsLower = aspectsParallel.toLowerCase();
    const titleLower = titleParallel.toLowerCase();

    // If title parallel contains the aspect parallel, title is more specific
    // e.g., aspects="blue", title="blue velocity" → use "blue velocity"
    if (titleLower.includes(aspectsLower) && titleLower.length > aspectsLower.length) {
      return titleParallel;
    }

    // If aspect parallel contains the title parallel, aspect is more specific
    if (aspectsLower.includes(titleLower) && aspectsLower.length > titleLower.length) {
      return aspectsParallel;
    }

    // If they're different (not substrings of each other), prefer title parsing
    // because it uses our curated list of compound parallels
    if (titleLower !== aspectsLower) {
      return titleParallel;
    }

    return aspectsParallel;
  }

  /**
   * Extract PSA cert number from listing title
   * PSA certs are typically 8-10 digit numbers
   */
  extractCertFromTitle(title) {
    if (!title) return null;

    // Look for patterns like "Cert #12345678" or "PSA 10 #12345678" or standalone 8-10 digit numbers
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
   * Log available aspects for debugging (first few listings only)
   */
  logAspects(aspects, title) {
    if (!aspects || aspects.length === 0) return;
    // Find cert-related aspects
    const certAspects = aspects.filter(a =>
      a.name.toLowerCase().includes('cert') ||
      a.name.toLowerCase().includes('psa') ||
      a.name.toLowerCase().includes('grading')
    );
    if (certAspects.length > 0) {
      console.log(`  eBay aspects with cert/psa/grading: ${certAspects.map(a => `${a.name}=${a.value}`).join(', ')}`);
    }
  }

  /**
   * Extract structured data from eBay's localizedAspects
   * These are seller-provided item specifics - much more reliable than title parsing
   */
  extractAspects(localizedAspects) {
    const result = {
      year: null,
      setName: null,
      cardNumber: null,
      parallel: null,
      playerName: null,
      grader: null,
      grade: null,
      certNumber: null,  // PSA/BGS certification number for API lookup
      sport: null,
      isAuto: false,
    };

    for (const aspect of localizedAspects) {
      const name = (aspect.name || '').toLowerCase();
      const value = aspect.value || '';

      // Year/Season
      if (name === 'year' || name === 'season' || name === 'year manufactured') {
        const yearMatch = value.match(/\b(19[89]\d|20[0-2]\d)\b/);
        if (yearMatch) result.year = parseInt(yearMatch[1]);
      }
      // Set/Series
      else if (name === 'set' || name === 'series' || name === 'product') {
        result.setName = value;
      }
      // Card Number
      else if (name === 'card number' || name === 'card #') {
        result.cardNumber = value.replace(/^#/, '').trim();
      }
      // Parallel/Variation
      else if (name === 'parallel/variety' || name === 'parallel' || name === 'variation' || name === 'insert') {
        result.parallel = value.toLowerCase();
      }
      // Player/Athlete
      else if (name === 'player' || name === 'athlete' || name === 'player/athlete') {
        result.playerName = value;
      }
      // Grading Company
      else if (name === 'professional grader' || name === 'grader' || name === 'grading company') {
        result.grader = value.toUpperCase();
      }
      // Grade
      else if (name === 'grade') {
        result.grade = value;
      }
      // Certification Number (PSA cert # for API lookup)
      else if (name === 'certification number' || name === 'cert number' || name === 'psa certification number' ||
               name === 'certification' || name === 'psa #' || name === 'psa number' ||
               name === 'grading certification number' || name === 'cert #') {
        // Extract just the numeric part (PSA certs are 8-10 digits)
        const certMatch = value.match(/\d{7,10}/);
        if (certMatch) {
          result.certNumber = certMatch[0];
        }
      }
      // Sport
      else if (name === 'sport') {
        result.sport = value.toLowerCase();
      }
      // Autograph
      else if (name === 'autograph' || name === 'autographed') {
        result.isAuto = value.toLowerCase() === 'yes' || value.toLowerCase() === 'true';
      }
      // Features (may include autograph info)
      else if (name === 'features') {
        if (value.toLowerCase().includes('auto')) {
          result.isAuto = true;
        }
      }
    }

    return result;
  }

  /**
   * Extract card details from listing title
   * Example: "2020 Panini Prizm LeBron James #1 PSA 10 Silver"
   */
  parseCardDetails(title) {
    const result = {
      year: null,
      playerName: null,
      setName: null,
      cardNumber: null,
      grade: 'Raw',
      grader: null,
      parallel: null,
      sport: null
    };

    if (!title) return result;

    const titleUpper = title.toUpperCase();

    // Extract year (4 digits starting with 19 or 20)
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

    // Detect sport from keywords
    const basketballKeywords = ['PRIZM', 'OPTIC', 'SELECT', 'MOSAIC', 'HOOPS', 'NBA', 'BASKETBALL'];
    const baseballKeywords = ['TOPPS', 'BOWMAN', 'CHROME', 'MLB', 'BASEBALL', 'SAPPHIRE'];

    if (basketballKeywords.some(kw => titleUpper.includes(kw))) {
      result.sport = 'basketball';
    } else if (baseballKeywords.some(kw => titleUpper.includes(kw))) {
      result.sport = 'baseball';
    }

    // Extract card number - try multiple patterns
    const cardNumPatterns = [
      /#\s*(\d{1,4})\b/,           // #129, # 129
      /\bNo\.?\s*(\d{1,4})\b/i,    // No. 129, No 129
      /\bCard\s*#?(\d{1,4})\b/i,   // Card #129, Card 129
      /\s(\d{1,4})\/\d+\b/,        // 129/500 (numbered cards)
    ];
    for (const pattern of cardNumPatterns) {
      const match = title.match(pattern);
      if (match && match[1]) {
        result.cardNumber = match[1];
        break;
      }
    }

    // Detect parallels - IMPORTANT: Check multi-word parallels FIRST before single colors
    const parallels = [
      // Multi-word parallels (must check first)
      'RED/WHITE/BLUE', 'RED WHITE BLUE', 'RED, WHITE, BLUE',
      'BLUE VELOCITY', 'RED VELOCITY', 'GREEN VELOCITY', 'ORANGE VELOCITY', 'PURPLE VELOCITY',
      'BLUE PULSAR', 'GREEN PULSAR', 'RED PULSAR', 'ORANGE PULSAR', 'PURPLE PULSAR',
      'PINK ICE', 'RED ICE', 'BLUE ICE', 'GREEN ICE', 'PURPLE ICE',
      'FAST BREAK', 'BLACK GOLD', 'BLUE SHIMMER', 'GOLD SHIMMER', 'RED SHIMMER',
      'BLUE WAVE', 'RED WAVE', 'GOLD WAVE', 'HYPER BLUE', 'HYPER PINK', 'HYPER RED',
      'NEON GREEN', 'NEON ORANGE', 'NEON PINK', 'TIGER CAMO',
      // Single-word parallels (check after compound names)
      'SILVER', 'GOLD', 'BLUE', 'RED', 'GREEN', 'ORANGE', 'PURPLE', 'BLACK', 'PINK', 'WHITE',
      'SHIMMER', 'HOLO', 'REFRACTOR', 'MOJO', 'SCOPE', 'WAVE', 'PULSAR', 'HYPER',
      'DISCO', 'TIGER', 'CAMO', 'ICE', 'NEON', 'LASER', 'VELOCITY', 'PRIZM'
    ];
    for (const parallel of parallels) {
      if (titleUpper.includes(parallel)) {
        // Normalize RWB variants
        if (parallel.includes('RED') && parallel.includes('WHITE') && parallel.includes('BLUE')) {
          result.parallel = 'red white blue';
        } else {
          result.parallel = parallel.toLowerCase();
        }
        break;
      }
    }

    // Detect set names - use patterns to avoid matching parallels like "Pulsar Prizm"
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
      { pattern: /STADIUM\s*CLUB/i, name: 'Stadium Club' },
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
      { pattern: /PANINI\s+CHRONICLES/i, name: 'Chronicles' },
      { pattern: /\bHOOPS\b/i, name: 'Hoops' },
      { pattern: /\bDONRUSS\b/i, name: 'Donruss' },
      { pattern: /\bBOWMAN\b/i, name: 'Bowman' },
    ];
    for (const { pattern, name } of setPatterns) {
      if (pattern.test(title)) {
        result.setName = name;
        break;
      }
    }

    return result;
  }

  // ============================================
  // BULK SEARCH (for worker jobs)
  // ============================================

  /**
   * Search multiple queries and aggregate results
   */
  async bulkSearch(queries, options = {}) {
    const allResults = [];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    for (const query of queries) {
      try {
        const results = await this.searchListings({ query, ...options });
        allResults.push(...results);
        
        // Rate limiting: eBay allows ~5000 calls/day = ~3.5 calls/min
        // Be conservative with 1 call per 2 seconds for bulk operations
        await delay(2000);
      } catch (error) {
        console.error(`Search failed for "${query}":`, error.message);
      }
    }

    // Dedupe by itemId
    const seen = new Set();
    return allResults.filter(item => {
      if (seen.has(item.ebayItemId)) return false;
      seen.add(item.ebayItemId);
      return true;
    });
  }
}

// Example usage:
// const ebay = new EbayClient();
// const listings = await ebay.searchListings({
//   query: 'LeBron James Prizm PSA 10',
//   sport: 'basketball',
//   buyingOption: 'AUCTION',
//   maxPrice: 500,
//   sort: 'endingSoonest'
// });
