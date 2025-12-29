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
        const rows = document.querySelectorAll('table tr');
        const anchors = document.querySelectorAll('a');
        let sampleRow = rows.length > 2 ? rows[2].innerText?.substring(0, 150) : '';
        let sampleAnchor = '';
        for (const a of anchors) {
          if (a.href && a.href.includes('comc.com') && a.textContent?.length > 10) {
            sampleAnchor = a.textContent.substring(0, 80) + ' -> ' + a.href.substring(0, 50);
            break;
          }
        }
        return { rowCount: rows.length, anchorCount: anchors.length, sampleRow, sampleAnchor };
      });
      console.log(`  COMC Debug: ${debug.rowCount} rows, ${debug.anchorCount} anchors`);
      if (debug.sampleRow) console.log(`  Sample row: ${debug.sampleRow}`);
      if (debug.sampleAnchor) console.log(`  Sample link: ${debug.sampleAnchor}`);

      // Extract listings from table rows
      const listings = await page.evaluate((baseUrl, maxItems) => {
        const results = [];
        const rows = document.querySelectorAll('table tr');

        rows.forEach((row, index) => {
          if (results.length >= maxItems) return;

          try {
            const rowText = row.innerText || '';
            // Must have a dollar sign to be a listing
            if (!rowText.includes('$')) return;

            // Get any link
            const link = row.querySelector('a');
            const listingUrl = link?.href || '';

            // Get title from link or first cell
            let title = link?.textContent?.trim() || '';
            if (!title) {
              const firstCell = row.querySelector('td');
              title = firstCell?.textContent?.trim() || '';
            }

            // Extract price
            let price = 0;
            const priceMatches = rowText.match(/\$[\d,.]+/g);
            if (priceMatches) {
              for (const pm of priceMatches) {
                const val = parseFloat(pm.replace(/[$,]/g, ''));
                if (val >= 1 && val < 5000) {
                  price = val;
                  break;
                }
              }
            }

            // Get image
            const img = row.querySelector('img');
            const imageUrl = img?.src || '';

            if (title.length > 5 && price > 0) {
              results.push({
                title: title.substring(0, 200),
                currentPrice: price,
                imageUrl,
                listingUrl,
                platform: 'comc',
                isAuction: false,
                bidCount: 0
              });
            }
          } catch (e) {}
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
