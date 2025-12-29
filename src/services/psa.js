/**
 * PSA Public API Integration
 *
 * Docs: https://www.psacard.com/publicapi/documentation
 * Free tier: 100 calls/day
 */

import fetch from 'node-fetch';

export class PSAClient {
  constructor() {
    this.baseUrl = 'https://api.psacard.com/publicapi';
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get OAuth access token using PSA credentials
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    const username = process.env.PSA_USERNAME;
    const password = process.env.PSA_PASSWORD;

    if (!username || !password) {
      throw new Error('PSA credentials not configured');
    }

    // Use URLSearchParams for reliable encoding of special characters
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username', username);
    params.append('password', password);

    console.log('PSA: Auth attempt for ' + username.substring(0, 3) + '***');

    const response = await fetch('https://api.psacard.com/publicapi/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      console.log('PSA: Auth failed - ' + response.status);
      throw new Error(`PSA auth failed: ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;

    console.log('PSA OAuth token obtained');
    return this.accessToken;
  }

  /**
   * Look up a graded card by PSA cert number
   */
  async getCertInfo(certNumber) {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}/cert/GetByCertNumber/${certNumber}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  /**
   * Get price guide data for a card (if available)
   * Note: This endpoint may require paid tier
   */
  async getPriceGuide(params) {
    const token = await this.getAccessToken();

    // Build search params
    const query = new URLSearchParams();
    if (params.sport) query.append('sport', params.sport);
    if (params.year) query.append('year', params.year);
    if (params.playerName) query.append('playerName', params.playerName);
    if (params.cardSet) query.append('cardSet', params.cardSet);
    if (params.grade) query.append('grade', params.grade);

    const response = await fetch(`${this.baseUrl}/prices/GetPrices?${query}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      console.log('PSA price guide not available:', response.status);
      return null;
    }

    return response.json();
  }

  /**
   * Get population report for a card
   */
  async getPopulationReport(params) {
    const token = await this.getAccessToken();

    const query = new URLSearchParams();
    if (params.specId) query.append('specId', params.specId);
    if (params.sport) query.append('sport', params.sport);
    if (params.year) query.append('year', params.year);

    const response = await fetch(`${this.baseUrl}/pop/GetPopulation?${query}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  /**
   * Extract market value from PSA data
   */
  async getMarketValue({ player, year, set, grade }) {
    try {
      const priceData = await this.getPriceGuide({
        playerName: player,
        year: year,
        cardSet: set,
        grade: grade
      });

      if (priceData && priceData.price) {
        return {
          marketValue: priceData.price,
          source: 'psa',
          confidence: 'high'
        };
      }

      return null;
    } catch (error) {
      console.error('PSA market value error:', error.message);
      return null;
    }
  }
}
