/**
 * Database Configuration
 * 
 * Uses Knex.js for query building and migrations.
 * Supports PostgreSQL (recommended for production).
 */

import knex from 'knex';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'cardsnipe_dev'
    },
    pool: { min: 2, max: 10 },
    migrations: {
      directory: './db/migrations'
    },
    seeds: {
      directory: './db/seeds'
    }
  },
  
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 20 },
    migrations: {
      directory: './db/migrations'
    }
  }
};

const environment = process.env.NODE_ENV || 'development';
export const db = knex(config[environment]);

export default config;
