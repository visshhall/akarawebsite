// Single shared Postgres connection pool for the whole server. Every
// route file imports { query } from here rather than creating its own
// connection — connection pooling is what lets many simultaneous requests
// share a small number of actual database connections efficiently.
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  // Fails loudly and immediately rather than letting every query fail
  // mysteriously later — this is exactly the mistake that's easy to make
  // when a Railway environment variable isn't wired up correctly.
  console.error(
    "DATABASE_URL is not set. On Railway: Variables tab -> add DATABASE_URL " +
    "-> value ${{Postgres.DATABASE_PRIVATE_URL}} (see the README). " +
    "Locally: copy .env.example to .env and fill it in."
  );
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's internal network doesn't need SSL; Railway's PUBLIC url does.
  // This checks for the public host pattern rather than hardcoding true/false,
  // so the same code works whether DATABASE_PRIVATE_URL or DATABASE_URL is used.
  ssl: process.env.DATABASE_URL.includes("railway.app")
    ? { rejectUnauthorized: false }
    : false,
});

export function query(text, params) {
  return pool.query(text, params);
}
