/**
 * COMC (Check Out My Cards) Scraper with Puppeteer
 *
 * Uses headless Chrome to scrape checkoutmycards.com for sports card listings.
 */

import puppeteer from 'puppeteer';

let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    });
  }
  return browser;
}

export class COMCClient {
  constructor() {
    this.baseUrl = 'https://www.comc.com';
  }

  /**
   * Search for cards on COMC using Puppeteer
   */
  async searchListings({ query, sport, maxPrice = 500, limit = 30 }) {
    let page = null;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const searchUrl = `${this.baseUrl}/Cards?search=${encodeURIComponent(query)}&price_max=${maxPrice}`;
      console.log(`  COMC: Fetching ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for listings to load
      await page.waitForSelector('.cardResult, .result, .card-listing, table tr', { timeout: 10000 }).catch(() => {});

      // Extract listings from the page
      const listings = await page.evaluate((baseUrl, maxItems) => {
        const results = [];

        // Try multiple possible selectors for card listings
        const selectors = [
          '.cardResult',
          '.result',
          '.card-listing',
          'table.searchResults tr',
          '.itemCard'
        ];

        let items = [];
        for (const selector of selectors) {
          items = document.querySelectorAll(selector);
          if (items.length > 0) break;
        }

        // Also try the detail view table rows
        if (items.length === 0) {
          items = document.querySelectorAll('table tr[onclick], table tr[data-id]');
        }

        items.forEach((item, index) => {
          if (index >= maxItems) return;

          try {
            // Try to find title
            let title = '';
            const titleEl = item.querySelector('a[title], .title, .card-title, td:first-child a, .itemTitle');
            if (titleEl) {
              title = titleEl.textContent?.trim() || titleEl.getAttribute('title') || '';
            }

            // Try to find price
            let price = 0;
            const priceEl = item.querySelector('.price, .card-price, .item-price, td.price, [class*="price"]');
            if (priceEl) {
              const priceText = priceEl.textContent || '';
              const priceMatch = priceText.match(/[\d,.]+/);
              if (priceMatch) {
                price = parseFloat(priceMatch[0].replace(/,/g, ''));
              }
            }

            // Try to find image
            let imageUrl = '';
            const imgEl = item.querySelector('img');
            if (imgEl) {
              imageUrl = imgEl.src || imgEl.getAttribute('data-src') || '';
            }

            // Try to find listing URL
            let listingUrl = '';
            const linkEl = item.querySelector('a[href*="/Item/"]');
            if (linkEl) {
              listingUrl = linkEl.href;
            }

            if (title && price > 0) {
              results.push({
                title,
                currentPrice: price,
                imageUrl: imageUrl.startsWith('http') ? imageUrl : baseUrl + imageUrl,
                listingUrl: listingUrl.startsWith('http') ? listingUrl : baseUrl + listingUrl,
                platform: 'comc',
                isAuction: false,
                bidCount: 0
              });
            }
          } catch (e) {
            // Skip problematic items
          }
        });

        return results;
      }, this.baseUrl, limit);

      console.log(`  COMC found ${listings.length} listings for "${query}"`);

      // Parse card details for each listing
      return listings.map(listing => ({
        ...listing,
        ...this.parseCardDetails(listing.title)
      }));

    } catch (error) {
      console.error(`COMC search error: ${error.message}`);
      return [];
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
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

// Cleanup browser on process exit
process.on('exit', () => {
  if (browser) browser.close().catch(() => {});
});
process.on('SIGINT', () => {
  if (browser) browser.close().catch(() => {});
  process.exit();
});
