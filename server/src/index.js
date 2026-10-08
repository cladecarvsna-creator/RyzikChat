import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { Hub } from './realtime.js';

/** Откуда сервер забирает свежие сборки приложения (папка с update.json и RyzikChat.apk). */
export const DEFAULT_UPDATE_SOURCE = 'https://github.com/cladecarvsna-creator/RyzikChat/releases/download/ryzikchat-latest';

export function startServer({ port = 8080, dataDir = './data', adminUsernames = [], updateSource = null } = {}) {
  const db = openDb(dataDir);
  const hub = new Hub();
  const app = createApp({ db, dataDir, hub, adminUsernames, updateSource });
  // Проверяем новую сборку при запуске и раз в 3 часа.
  if (updateSource) {
    const sync = () => app.locals.syncUpdate().then((u) => u && console.log(`Скачана сборка приложения ${u.versionName}`))
      .catch((e) => console.warn(`Обновления: ${e.message}`));
    sync();
    setInterval(sync, 3 * 3600_000).unref();
  }
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
  // Приложение само проверяет обновления на GitHub. Раздавать сборки с этого сервера можно,
  // указав UPDATE_SOURCE (например, UPDATE_SOURCE=github) — тогда сервер будет их забирать.
  const env = process.env.UPDATE_SOURCE ?? 'off';
  const src = env === 'github' ? DEFAULT_UPDATE_SOURCE : env;
  const updateSource = src && src !== 'off' ? src.replace(/\/$/, '') : null;
  startServer({ port, dataDir, adminUsernames, updateSource }).then(({ port: p }) => {
    console.log(`RyzikChat server: http://0.0.0.0:${p} (данные: ${dataDir})`);
  });
}
