import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { Hub } from './realtime.js';
import { mailConfigFromEnv, sendMail } from './mail.js';

export function startServer({ port = 8080, dataDir = './data', adminUsernames = [], mailer } = {}) {
  const db = openDb(dataDir);
  const hub = new Hub();
  if (mailer === undefined) {
    const cfg = mailConfigFromEnv();
    mailer = cfg ? (msg) => sendMail(cfg, msg) : null;
  }
  const app = createApp({ db, dataDir, hub, adminUsernames, mailer });
  const server = http.createServer(app);
  const wss = hub.attach(server, app.locals);
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, wss, db, hub, port: server.address().port }));
  });
}

// Запуск напрямую (`npm start`). Сравниваем пути, а не строки URL: на Windows и в папках
// с русскими буквами URL выглядит иначе, и раньше сервер молча завершался.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number(process.env.PORT ?? 8080);
  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  const adminUsernames = (process.env.ADMIN_USERNAMES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  startServer({ port, dataDir, adminUsernames }).then(({ port: p }) => {
    console.log(`RyzikChat server: http://0.0.0.0:${p} (данные: ${dataDir})`);
  });
}
