import dotenv from 'dotenv';
dotenv.config();

export default {
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
      directory: './src/db/migrations'
    }
  },

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL + '?sslmode=require',
    pool: { min: 2, max: 20 },
    migrations: {
      directory: './src/db/migrations'
    }
  }
};
