/**
 * Card Sets Data Service
 *
 * Provides structured data about Panini card sets, parallels, and inserts
 * Used for accurate matching between eBay listings and SportsCardPro prices
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class CardSetsService {
  constructor() {
    this.data = null;
    this.allParallels = new Set();
    this.allInserts = new Set();
    this.compoundParallels = [];  // Multi-word parallels (check first)
    this.simpleParallels = [];    // Single-word parallels (check after)
    this.setNames = new Map();    // Map of variations to canonical names
    this.load();
  }

  load() {
    try {
      const dataPath = join(__dirname, '../data/panini-sets.json');
      const raw = readFileSync(dataPath, 'utf-8');
      this.data = JSON.parse(raw);
      this.buildIndexes();
      console.log(`CardSets: Loaded ${this.allParallels.size} parallels, ${this.allInserts.size} inserts`);
    } catch (e) {
      console.error('CardSets: Failed to load data:', e.message);
      this.data = { sets: {}, commonParallels: [], commonInserts: [] };
    }
  }

  buildIndexes() {
    // Build set name mappings
    for (const [key, set] of Object.entries(this.data.sets)) {
      const canonical = set.name.toLowerCase();
      this.setNames.set(canonical, canonical);
      this.setNames.set(key, canonical);
      if (set.alternateNames) {
        for (const alt of set.alternateNames) {
          this.setNames.set(alt.toLowerCase(), canonical);
        }
      }

      // Collect all parallels from this set
      if (set.parallels) {
        for (const p of set.parallels) {
          this.allParallels.add(p.toLowerCase());
        }
      }

      // Collect all inserts from this set
      if (set.inserts) {
        for (const i of set.inserts) {
          this.allInserts.add(i.toLowerCase());
        }
      }
    }

    // Add common parallels and inserts
    for (const p of this.data.commonParallels || []) {
      this.allParallels.add(p.toLowerCase());
    }
    for (const i of this.data.commonInserts || []) {
      this.allInserts.add(i.toLowerCase());
    }

    // Sort parallels: compound (multi-word) first, then simple (single-word)
    const allParallelsArray = Array.from(this.allParallels);
    this.compoundParallels = allParallelsArray
      .filter(p => p.includes(' ') || p.includes('-') || p.includes('/'))
      .sort((a, b) => b.length - a.length);  // Longer first
    this.simpleParallels = allParallelsArray
      .filter(p => !p.includes(' ') && !p.includes('-') && !p.includes('/'))
      .sort((a, b) => b.length - a.length);  // Longer first
  }

  /**
   * Get ordered list of parallels for detection (compound first, then simple)
   */
  getParallelsForDetection() {
    return [...this.compoundParallels, ...this.simpleParallels];
  }

  /**
   * Get all insert set names for detection
   */
  getInsertsForDetection() {
    // Sort by length descending so longer matches are checked first
    return Array.from(this.allInserts).sort((a, b) => b.length - a.length);
  }

  /**
   * Check if a string is a known parallel
   */
  isParallel(name) {
    if (!name) return false;
    return this.allParallels.has(name.toLowerCase());
  }

  /**
   * Check if a string is a known insert set
   */
  isInsert(name) {
    if (!name) return false;
    return this.allInserts.has(name.toLowerCase());
  }

  /**
   * Get canonical set name from a variation
   */
  getCanonicalSetName(name) {
    if (!name) return null;
    return this.setNames.get(name.toLowerCase()) || null;
  }

  /**
   * Get set data by name
   */
  getSet(name) {
    if (!name) return null;
    const key = name.toLowerCase().replace(/\s+/g, '-');
    return this.data.sets[key] || null;
  }

  /**
   * Detect parallel from title text
   * Returns the detected parallel or null
   */
  detectParallel(title) {
    if (!title) return null;
    const titleLower = title.toLowerCase();
    const titleUpper = title.toUpperCase();

    // Check compound parallels first (e.g., "blue velocity" before "blue")
    for (const parallel of this.compoundParallels) {
      if (titleLower.includes(parallel)) {
        return this.normalizeParallel(parallel);
      }
    }

    // Then check simple parallels
    for (const parallel of this.simpleParallels) {
      // Skip "prizm" if it's just part of set name
      if (parallel === 'prizm') {
        const hasPrizmParallel = /\b(SILVER|GOLD|BLUE|RED|GREEN|ORANGE|PURPLE|PINK|BLACK|WHITE)\s+PRIZM\b/i.test(title);
        if (!hasPrizmParallel) continue;
      }

      if (titleLower.includes(parallel)) {
        return this.normalizeParallel(parallel);
      }
    }

    return null;
  }

  /**
   * Detect insert set from title text
   * Returns the detected insert or null
   */
  detectInsert(title) {
    if (!title) return null;
    const titleLower = title.toLowerCase();

    for (const insert of this.getInsertsForDetection()) {
      if (titleLower.includes(insert)) {
        return this.normalizeInsert(insert);
      }
    }

    return null;
  }

  /**
   * Normalize parallel name for consistent matching
   */
  normalizeParallel(parallel) {
    if (!parallel) return null;
    let p = parallel.toLowerCase().trim();

    // Normalize red/white/blue variants
    if (p.includes('red') && p.includes('white') && p.includes('blue')) {
      return 'red white blue';
    }

    // Remove common suffixes for matching
    p = p.replace(/ prizm$/, '');
    p = p.replace(/ refractor$/, '');
    p = p.replace(/ holo$/, '');

    return p;
  }

  /**
   * Normalize insert name for consistent matching
   */
  normalizeInsert(insert) {
    if (!insert) return null;
    return insert.toLowerCase()
      .replace(/-/g, ' ')
      .replace(/,/g, '')
      .trim();
  }

  /**
   * Check if two parallels match (with normalization)
   */
  parallelsMatch(p1, p2) {
    const n1 = this.normalizeParallel(p1);
    const n2 = this.normalizeParallel(p2);

    // Both null/empty = base cards = match
    if (!n1 && !n2) return true;

    // One is base, one is parallel = no match
    if (!n1 || !n2) return false;

    // Exact match after normalization
    return n1 === n2;
  }

  /**
   * Get all data for debugging
   */
  getStats() {
    return {
      sets: Object.keys(this.data.sets).length,
      parallels: this.allParallels.size,
      compoundParallels: this.compoundParallels.length,
      simpleParallels: this.simpleParallels.length,
      inserts: this.allInserts.size
    };
  }
}

// Singleton instance
export const cardSets = new CardSetsService();
export default cardSets;
