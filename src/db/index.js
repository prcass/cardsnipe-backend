/**
 * Database Configuration
 */

import knex from 'knex';

const dbConfig = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cardsnipe_dev',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
  },
  pool: { min: 2, max: 10 }
};

console.log('Connecting to database...');
export const db = knex(dbConfig);

export default dbConfig;
