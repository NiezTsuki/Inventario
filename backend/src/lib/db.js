import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
export const pool = new Pool({
  connectionString,
  ssl: /amazonaws|azure|heroku|neon|render|supabase/.test(connectionString || '') ? { rejectUnauthorized: false } : false
});

export async function query(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
