/**
 * Migration: Add scan_log table to track all scanned cards and their outcomes
 */

export async function up(knex) {
  await knex.schema.createTable('scan_log', (table) => {
    table.increments('id').primary();
    table.string('ebay_item_id').index();
    table.string('platform').defaultTo('ebay');
    table.string('sport');
    table.string('title');
    table.decimal('price', 10, 2);
    table.string('grade');
    table.string('year');
    table.string('set_name');
    table.string('card_number');
    table.string('parallel');
    table.string('insert_set');
    table.string('outcome').index();  // 'matched', 'rejected', 'saved'
    table.string('reject_reason');     // Why it was rejected
    table.decimal('market_value', 10, 2);
    table.string('market_source');
    table.integer('deal_score');
    table.string('listing_url');
    table.string('image_url');
    table.timestamp('scanned_at').defaultTo(knex.fn.now()).index();
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('scan_log');
}
