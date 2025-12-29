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
    return this.transformListings(data.itemSummaries || []);
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
    return items.map(item => ({
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
      
      // We'll parse these from the title
      ...this.parseCardDetails(item.title)
    }));
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

    // Extract card number
    const numberMatch = title.match(/#\s*(\d+)/);
    if (numberMatch) result.cardNumber = numberMatch[1];

    // Detect parallels
    const parallels = ['SILVER', 'GOLD', 'RED', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE', 'BLACK', 'PINK', 
                       'SHIMMER', 'HOLO', 'REFRACTOR', 'MOJO', 'SCOPE', 'WAVE'];
    for (const parallel of parallels) {
      if (titleUpper.includes(parallel)) {
        result.parallel = parallel.charAt(0) + parallel.slice(1).toLowerCase();
        break;
      }
    }

    // Detect set names
    const sets = ['PRIZM', 'OPTIC', 'SELECT', 'MOSAIC', 'HOOPS', 'CONTENDERS', 'CHRONICLES',
                  'TOPPS CHROME', 'BOWMAN CHROME', 'BOWMAN', 'STADIUM CLUB', 'DONRUSS'];
    for (const set of sets) {
      if (titleUpper.includes(set)) {
        result.setName = set.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
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
