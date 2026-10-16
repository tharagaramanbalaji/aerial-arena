import path from 'path';
import { createServer } from './server.js';
import { PlayerStore } from './db.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
// SQLite file location. On hosts with ephemeral disks, point DATA_DIR at a persistent volume.
const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'aerial-arena.sqlite');

async function main() {
  const store = await PlayerStore.open(DB_FILE);
  const instance = createServer(PORT, HOST, store);

  instance.httpServer.listen(PORT, HOST, () => {
    console.log(`[Aerial Arena Server] Listening on http://${HOST}:${PORT} (ws://${HOST}:${PORT})`);
    console.log(`[Aerial Arena Server] Player database: ${DB_FILE}`);
  });

  const shutdown = async () => {
    console.log('\n[Aerial Arena Server] Shutting down gracefully...');
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Aerial Arena Server] Failed to start', err);
  process.exit(1);
});
