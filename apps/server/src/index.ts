import { createServer } from './server.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const instance = createServer(PORT, HOST);

instance.httpServer.listen(PORT, HOST, () => {
  console.log(`[Aerial Arena Server] Listening on http://${HOST}:${PORT} (ws://${HOST}:${PORT})`);
});

const shutdown = async () => {
  console.log('\n[Aerial Arena Server] Shutting down gracefully...');
  await instance.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
