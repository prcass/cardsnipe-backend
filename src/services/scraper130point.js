/**
 * 130point.com Scraper with Puppeteer
 *
 * Uses headless Chrome to scrape 130point.com for eBay sold data.
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

export class Scraper130Point {
  constructor() {
    this.baseUrl = 'https://130point.com';
  }

  /**
   * Get recent sold prices for a card search
   */
  async getSoldPrices(query) {
    let page = null;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const searchUrl = `${this.baseUrl}/sales/?search=${encodeURIComponent(query)}`;
      console.log(`  130point: Fetching ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for the sales table to load
      await page.waitForSelector('table tbody tr, .sales-table tr, #salesDataTable', { timeout: 15000 }).catch(() => {});

      // Give extra time for dynamic content
      await new Promise(r => setTimeout(r, 2000));

      // Extract sales data from the page
      const sales = await page.evaluate(() => {
        const results = [];

        // Try multiple selectors for the sales table
        const rows = document.querySelectorAll('table tbody tr, .sales-table tr, #salesDataTable tbody tr');

        rows.forEach((row) => {
          try {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
              // Try to get title from first cell
              let title = cells[0]?.textContent?.trim() || '';

              // Try to get price - look for dollar sign
              let price = 0;
              for (let i = 0; i < cells.length; i++) {
                const text = cells[i]?.textContent || '';
                if (text.includes('$')) {
                  const match = text.match(/\$?([\d,.]+)/);
                  if (match) {
                    price = parseFloat(match[1].replace(/,/g, ''));
                    break;
                  }
                }
              }

              // Get date if available
              let date = '';
              if (cells.length >= 3) {
                date = cells[2]?.textContent?.trim() || '';
              }

              if (title && price > 0) {
                results.push({
                  title,
                  price,
                  date,
                  source: '130point'
                });
              }
            }
          } catch (e) {
            // Skip problematic rows
          }
        });

        return results;
      });

      if (sales.length === 0) {
        console.log(`  130point: No sales found for "${query}"`);
        return null;
      }

      // Calculate market value statistics
      const prices = sales.map(s => s.price).sort((a, b) => a - b);

      // Remove outliers (bottom 10% and top 10%)
      const trimStart = Math.floor(prices.length * 0.1);
      const trimEnd = Math.floor(prices.length * 0.9);
      const trimmedPrices = prices.slice(trimStart, trimEnd || prices.length);

      const average = trimmedPrices.length > 0
        ? trimmedPrices.reduce((a, b) => a + b, 0) / trimmedPrices.length
        : prices[Math.floor(prices.length / 2)];

      const median = prices[Math.floor(prices.length / 2)];
      const lowest = prices[0];
      const highest = prices[prices.length - 1];

      console.log(`  130point: Found ${sales.length} sales, avg $${Math.round(average)}`);

      return {
        marketValue: Math.round(average * 100) / 100,
        median: Math.round(median * 100) / 100,
        lowest,
        highest,
        sampleSize: sales.length,
        recentSales: sales.slice(0, 10),
        source: '130point'
      };

    } catch (error) {
      console.error(`130point scrape error: ${error.message}`);
      return null;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Get market value for a specific card
   */
  async getMarketValue({ player, year, set, grade }) {
    // Build search query
    let query = player;
    if (year) query = `${year} ${query}`;
    if (set) query = `${query} ${set}`;
    if (grade && grade !== 'Raw') query = `${query} ${grade}`;

    const result = await this.getSoldPrices(query);

    if (result) {
      console.log(`  130point: ${player} ${grade || 'Raw'} = $${result.marketValue} (${result.sampleSize} sales)`);
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
