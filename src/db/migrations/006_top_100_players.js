/**
 * Migration: Seed Top 100 most collectible players
 * Curated list of players whose cards have the most value/demand
 */

export async function up(knex) {
  // Clear existing players
  await knex('monitored_players').del();

  const players = [
    // ========== BASKETBALL (40 players) ==========
    // Current Superstars
    { name: 'LeBron James', sport: 'basketball', active: true },
    { name: 'Stephen Curry', sport: 'basketball', active: true },
    { name: 'Kevin Durant', sport: 'basketball', active: true },
    { name: 'Giannis Antetokounmpo', sport: 'basketball', active: true },
    { name: 'Nikola Jokic', sport: 'basketball', active: true },
    { name: 'Luka Doncic', sport: 'basketball', active: true },
    { name: 'Joel Embiid', sport: 'basketball', active: true },
    { name: 'Jayson Tatum', sport: 'basketball', active: true },
    { name: 'Anthony Edwards', sport: 'basketball', active: true },
    { name: 'Shai Gilgeous-Alexander', sport: 'basketball', active: true },
    // Rising Stars & Rookies
    { name: 'Victor Wembanyama', sport: 'basketball', active: true },
    { name: 'Chet Holmgren', sport: 'basketball', active: true },
    { name: 'Paolo Banchero', sport: 'basketball', active: true },
    { name: 'Tyrese Haliburton', sport: 'basketball', active: true },
    { name: 'Tyrese Maxey', sport: 'basketball', active: true },
    { name: 'Evan Mobley', sport: 'basketball', active: true },
    { name: 'Scottie Barnes', sport: 'basketball', active: true },
    { name: 'Jalen Brunson', sport: 'basketball', active: true },
    { name: 'De\'Aaron Fox', sport: 'basketball', active: true },
    { name: 'Ja Morant', sport: 'basketball', active: true },
    // All-Stars
    { name: 'Donovan Mitchell', sport: 'basketball', active: true },
    { name: 'Devin Booker', sport: 'basketball', active: true },
    { name: 'Trae Young', sport: 'basketball', active: true },
    { name: 'Zion Williamson', sport: 'basketball', active: true },
    { name: 'LaMelo Ball', sport: 'basketball', active: true },
    { name: 'Anthony Davis', sport: 'basketball', active: true },
    { name: 'Kawhi Leonard', sport: 'basketball', active: true },
    { name: 'Jimmy Butler', sport: 'basketball', active: true },
    { name: 'Damian Lillard', sport: 'basketball', active: true },
    { name: 'Kyrie Irving', sport: 'basketball', active: true },
    // Legends (cards still highly traded)
    { name: 'Michael Jordan', sport: 'basketball', active: true },
    { name: 'Kobe Bryant', sport: 'basketball', active: true },
    { name: 'Shaquille O\'Neal', sport: 'basketball', active: true },
    // 2024 Draft Class
    { name: 'Zaccharie Risacher', sport: 'basketball', active: true },
    { name: 'Alex Sarr', sport: 'basketball', active: true },
    { name: 'Reed Sheppard', sport: 'basketball', active: true },
    { name: 'Stephon Castle', sport: 'basketball', active: true },
    { name: 'Matas Buzelis', sport: 'basketball', active: true },
    { name: 'Dalton Knecht', sport: 'basketball', active: true },
    { name: 'Rob Dillingham', sport: 'basketball', active: true },

    // ========== BASEBALL (35 players) ==========
    // Current Superstars
    { name: 'Shohei Ohtani', sport: 'baseball', active: true },
    { name: 'Mike Trout', sport: 'baseball', active: true },
    { name: 'Mookie Betts', sport: 'baseball', active: true },
    { name: 'Ronald Acuna Jr', sport: 'baseball', active: true },
    { name: 'Juan Soto', sport: 'baseball', active: true },
    { name: 'Freddie Freeman', sport: 'baseball', active: true },
    { name: 'Corey Seager', sport: 'baseball', active: true },
    { name: 'Trea Turner', sport: 'baseball', active: true },
    { name: 'Bryce Harper', sport: 'baseball', active: true },
    { name: 'Aaron Judge', sport: 'baseball', active: true },
    // Rising Stars & Rookies
    { name: 'Gunnar Henderson', sport: 'baseball', active: true },
    { name: 'Julio Rodriguez', sport: 'baseball', active: true },
    { name: 'Corbin Carroll', sport: 'baseball', active: true },
    { name: 'Bobby Witt Jr', sport: 'baseball', active: true },
    { name: 'Adley Rutschman', sport: 'baseball', active: true },
    { name: 'Elly De La Cruz', sport: 'baseball', active: true },
    { name: 'Jackson Holliday', sport: 'baseball', active: true },
    { name: 'Jackson Merrill', sport: 'baseball', active: true },
    { name: 'Paul Skenes', sport: 'baseball', active: true },
    { name: 'Wyatt Langford', sport: 'baseball', active: true },
    // All-Stars
    { name: 'Marcus Semien', sport: 'baseball', active: true },
    { name: 'Jose Ramirez', sport: 'baseball', active: true },
    { name: 'Matt Olson', sport: 'baseball', active: true },
    { name: 'Pete Alonso', sport: 'baseball', active: true },
    { name: 'Vladimir Guerrero Jr', sport: 'baseball', active: true },
    { name: 'Fernando Tatis Jr', sport: 'baseball', active: true },
    { name: 'Bo Bichette', sport: 'baseball', active: true },
    { name: 'Spencer Strider', sport: 'baseball', active: true },
    // Pitchers
    { name: 'Gerrit Cole', sport: 'baseball', active: true },
    { name: 'Max Scherzer', sport: 'baseball', active: true },
    // Legends
    { name: 'Derek Jeter', sport: 'baseball', active: true },
    { name: 'Ken Griffey Jr', sport: 'baseball', active: true },
    // Top Prospects
    { name: 'Jackson Chourio', sport: 'baseball', active: true },
    { name: 'Jasson Dominguez', sport: 'baseball', active: true },
    { name: 'Junior Caminero', sport: 'baseball', active: true }
  ];

  await knex('monitored_players').insert(players);
}

export async function down(knex) {
  await knex('monitored_players').del();
}
