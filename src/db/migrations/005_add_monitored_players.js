/**
 * Migration: Add monitored_players table for configurable player searches
 */

export async function up(knex) {
  await knex.schema.createTable('monitored_players', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('sport').notNullable(); // 'basketball', 'baseball', 'football'
    table.boolean('active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Seed with default players
  await knex('monitored_players').insert([
    // Basketball
    { name: 'LeBron James', sport: 'basketball', active: true },
    { name: 'Victor Wembanyama', sport: 'basketball', active: true },
    { name: 'Luka Doncic', sport: 'basketball', active: true },
    { name: 'Anthony Edwards', sport: 'basketball', active: true },
    { name: 'Stephen Curry', sport: 'basketball', active: true },
    // Baseball
    { name: 'Shohei Ohtani', sport: 'baseball', active: true },
    { name: 'Mike Trout', sport: 'baseball', active: true },
    { name: 'Julio Rodriguez', sport: 'baseball', active: true },
    { name: 'Gunnar Henderson', sport: 'baseball', active: true },
    { name: 'Juan Soto', sport: 'baseball', active: true },
  ]);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('monitored_players');
}
