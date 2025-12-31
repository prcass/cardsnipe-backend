/**
 * Migration: Add price_data table for local SportsCardPro price lookups
 *
 * This replaces API calls with fast local database queries.
 * Data is populated by uploading CSV exports from SportsCardPro.
 */

export async function up(knex) {
  await knex.schema.createTable('price_data', (table) => {
    table.increments('id').primary();
    table.string('scp_id').index();  // SportsCardPro product ID
    table.string('console_name');     // Set name (e.g., "2023 Panini Prizm")
    table.string('product_name');     // Full product name from SCP
    table.string('sport').index();    // basketball, baseball, football

    // Parsed fields for matching
    table.string('year').index();
    table.string('set_name').index();
    table.string('card_number').index();
    table.string('parallel');
    table.string('player_name');

    // Prices (stored in cents)
    table.integer('raw_price');       // loose-price
    table.integer('psa8_price');      // new-price
    table.integer('psa9_price');      // graded-price
    table.integer('psa10_price');     // manual-only-price
    table.integer('bgs10_price');     // bgs-10-price

    table.string('source_file');      // Which CSV this came from
    table.timestamp('uploaded_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Compound index for fast lookups
    table.index(['year', 'set_name', 'card_number', 'parallel']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('price_data');
}
