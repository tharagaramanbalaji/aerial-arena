import path from 'path';
import { createServer } from './server.js';
import { openPlayerStore } from './db.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
// Player database: Postgres (e.g. Neon) when DATABASE_URL is set, otherwise a local SQLite file.
// On hosts with ephemeral disks (Render free), set DATABASE_URL so accounts survive restarts.
const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'aerial-arena.sqlite');

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const store = await openPlayerStore({ databaseUrl, file: DB_FILE });
  const instance = createServer(PORT, HOST, store);

  instance.httpServer.listen(PORT, HOST, () => {
    console.log(`[Aerial Arena Server] Listening on http://${HOST}:${PORT} (ws://${HOST}:${PORT})`);
    // Never log the connection string: it contains the database password.
    console.log(`[Aerial Arena Server] Player database: ${store.kind === 'postgres' ? 'Postgres (DATABASE_URL)' : DB_FILE}`);
  });

  const shutdown = async () => {
    console.log('\n[Aerial Arena Server] Shutting down gracefully...');
    await instance.close();
    await store.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Aerial Arena Server] Failed to start', err);
  process.exit(1);
});
