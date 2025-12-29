/**
 * Database Migration: Add market value source tracking
 */

export async function up(knex) {
  await knex.schema.alterTable('listings', (table) => {
    table.string('market_value_source', 50);  // 'psa', '130point', 'unknown'
    table.text('market_value_url');            // Link to source
    table.timestamp('market_value_date');      // When price was fetched
  });

  console.log('✅ Added market value source columns');
}

export async function down(knex) {
  await knex.schema.alterTable('listings', (table) => {
    table.dropColumn('market_value_source');
    table.dropColumn('market_value_url');
    table.dropColumn('market_value_date');
  });
}
