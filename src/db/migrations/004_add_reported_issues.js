/**
 * Migration: Add reported_issues table for tracking bad matches
 */

export async function up(knex) {
  await knex.schema.createTable('reported_issues', (table) => {
    table.increments('id').primary();
    table.integer('listing_id').references('id').inTable('listings');
    table.string('ebay_url');
    table.string('scp_url');
    table.string('issue');  // 'wrong_parallel', 'wrong_price', 'wrong_year', 'other'
    table.text('notes');
    table.boolean('resolved').defaultTo(false);
    table.text('resolution_notes');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('resolved_at');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('reported_issues');
}
