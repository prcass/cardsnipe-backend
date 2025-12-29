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
  async searchListings({ query, sport, limit = 30 }) {
    let page = null;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const searchUrl = `${this.baseUrl}/Cards?search=${encodeURIComponent(query)}`;
      console.log(`  COMC: Fetching ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for page to fully render
      await new Promise(r => setTimeout(r, 2000));

      // Debug: Check what's on the page
      const debug = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="Item"]');
        const tables = document.querySelectorAll('table');
        const allText = document.body.innerText.substring(0, 300);
        return { linkCount: links.length, tableCount: tables.length, preview: allText };
      });
      console.log(`  COMC Debug: ${debug.linkCount} item links, ${debug.tableCount} tables`);

      // Extract listings from the page
      const listings = await page.evaluate((baseUrl, maxItems) => {
        const results = [];

        // Find all links to item pages
        const itemLinks = document.querySelectorAll('a[href*="/Item/"]');

        itemLinks.forEach((link, index) => {
          if (index >= maxItems) return;

          try {
            const href = link.href;
            // Get the row or container this link is in
            const container = link.closest('tr') || link.closest('div') || link.parentElement;
            if (!container) return;

            // Get title
            let title = link.textContent?.trim() || link.getAttribute('title') || '';

            // Find price in the container text
            let price = 0;
            const containerText = container.innerText || '';
            const priceMatches = containerText.match(/\$[\d,.]+/g);
            if (priceMatches) {
              for (const pm of priceMatches) {
                const val = parseFloat(pm.replace(/[$,]/g, ''));
                if (val > 0.5 && val < 5000) {
                  price = val;
                  break;
                }
              }
            }

            // Find image
            let imageUrl = '';
            const img = container.querySelector('img');
            if (img) {
              imageUrl = img.src || img.getAttribute('data-src') || '';
            }

            if (title.length > 10 && price > 0) {
              results.push({
                title: title.substring(0, 200),
                currentPrice: price,
                imageUrl: imageUrl,
                listingUrl: href,
                platform: 'comc',
                isAuction: false,
                bidCount: 0
              });
            }
          } catch (e) {
            // Skip
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
