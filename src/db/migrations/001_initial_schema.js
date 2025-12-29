/**
 * Database Migration: Initial Schema
 * 
 * Run with: npm run db:migrate
 */

export async function up(knex) {
  // Cards table - stores unique card identities
  await knex.schema.createTable('cards', (table) => {
    table.increments('id').primary();
    table.string('sport', 20).notNullable();
    table.string('player_name', 100).notNullable();
    table.integer('year');
    table.string('set_name', 100);
    table.string('card_number', 20);
    table.string('parallel', 50);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Index for lookups
    table.index(['player_name', 'year', 'set_name']);
  });

  // Market values - historical price data
  await knex.schema.createTable('market_values', (table) => {
    table.increments('id').primary();
    table.integer('card_id').references('id').inTable('cards').onDelete('CASCADE');
    table.string('grade', 20).notNullable();
    table.decimal('market_value', 10, 2).notNullable();
    table.string('source', 50);
    table.timestamp('last_updated').defaultTo(knex.fn.now());
    
    table.index(['card_id', 'grade']);
  });

  // Listings - active eBay listings
  await knex.schema.createTable('listings', (table) => {
    table.increments('id').primary();
    table.integer('card_id').references('id').inTable('cards').onDelete('SET NULL');
    table.string('ebay_item_id', 50).unique();
    table.string('platform', 20).defaultTo('ebay');
    table.string('sport', 20);
    table.string('title', 300);
    table.decimal('current_price', 10, 2);
    table.boolean('is_auction').defaultTo(false);
    table.timestamp('auction_end_time');
    table.integer('bid_count').defaultTo(0);
    table.string('grade', 30);
    table.decimal('market_value', 10, 2);
    table.integer('deal_score').defaultTo(0);
    table.text('image_url');
    table.text('listing_url');
    table.string('seller_name', 100);
    table.decimal('seller_rating', 5, 2);
    table.integer('seller_feedback_count');
    table.decimal('shipping_cost', 6, 2);
    table.boolean('is_active').defaultTo(true);
    table.timestamp('first_seen').defaultTo(knex.fn.now());
    table.timestamp('last_updated').defaultTo(knex.fn.now());
    
    // Indexes for fast queries
    table.index('deal_score');
    table.index('auction_end_time');
    table.index('is_active');
    table.index('sport');
  });

  // Users table
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 255).unique().notNullable();
    table.string('password_hash', 255);
    table.string('name', 100);
    table.boolean('email_verified').defaultTo(false);
    table.string('subscription_tier', 20).defaultTo('free');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('last_login');
  });

  // User watchlists
  await knex.schema.createTable('user_watchlists', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.string('player_name', 100);
    table.string('sport', 20);
    table.string('set_name', 100);
    table.string('grade', 30);
    table.integer('min_deal_score').defaultTo(20);
    table.decimal('max_price', 10, 2);
    table.boolean('notify_email').defaultTo(true);
    table.boolean('notify_push').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index('user_id');
  });

  // Alert history
  await knex.schema.createTable('alerts_sent', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.integer('listing_id').references('id').inTable('listings').onDelete('CASCADE');
    table.string('alert_type', 20);
    table.timestamp('sent_at').defaultTo(knex.fn.now());
    
    // Prevent duplicate alerts
    table.unique(['user_id', 'listing_id', 'alert_type']);
  });

  console.log('✅ All tables created successfully');
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('alerts_sent');
  await knex.schema.dropTableIfExists('user_watchlists');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('listings');
  await knex.schema.dropTableIfExists('market_values');
  await knex.schema.dropTableIfExists('cards');
  
  console.log('✅ All tables dropped');
}
