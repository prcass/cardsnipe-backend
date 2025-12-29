import dotenv from 'dotenv';
dotenv.config();

const config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cardsnipe_dev',
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './src/db/migrations'
  }
};

export default config;
