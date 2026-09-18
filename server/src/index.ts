import { GameServer } from './GameServer.js';

const PORT = Number(process.env.PORT || 3000);
const server = new GameServer();

process.on('uncaughtException', (err) => {
  console.error('[Server UncaughtException]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server UnhandledRejection]:', reason);
});

server.start(PORT).then(() => {
  console.log(`[Ink Arena GameServer] Running on http://localhost:${PORT}`);
});
