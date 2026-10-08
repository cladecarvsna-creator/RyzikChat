# Сервер RyzikChat

Собственный API мессенджера: REST + WebSocket, хранение в SQLite (встроенный `node:sqlite`).
Сервер **не видит** содержимого сообщений и файлов: они приходят уже зашифрованными с устройства.

## Запуск

```bash
cd server
npm install
npm start            # http://0.0.0.0:8080, данные в ./data
```

Или в Docker:

```bash
docker build -t ryzikchat-server server
docker run -d -p 8080:8080 -v ryzik-data:/data ryzikchat-server
```

Переменные окружения:

| Переменная | Что делает | По умолчанию |
|---|---|---|
| `PORT` | порт | `8080` |
| `DATA_DIR` | где лежат база и файлы | `./data` |
| `ADMIN_USERNAMES` | кто станет админом при регистрации, через запятую | первый зарегистрированный |
| `UPDATE_SOURCE` | откуда сервер забирает свежую сборку приложения (папка с `update.json` и `RyzikChat.apk`); `off` — не забирать, APK загружает админ через `POST /api/admin/app` | релиз RyzikChat на GitHub |
| `MAX_FILE_MB` | максимальный размер файла | `2048` |

Первый зарегистрированный пользователь автоматически становится администратором и может выдавать бейджи.

## API (кратко)

Все запросы, кроме `/api/health` и `/api/auth/*`, требуют заголовок `Authorization: Bearer <token>`.

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/auth/register` | регистрация (`username, displayName, password, publicKey, encryptedPrivateKey`) |
| POST | `/api/auth/login` | вход |
| GET/PATCH | `/api/me` | профиль |
| GET | `/api/users/search?q=` | поиск людей |
| GET | `/api/chats` | список чатов |
| POST | `/api/chats/direct`, `/api/chats/group` | новый чат / группа |
| GET/POST | `/api/chats/:id/messages` | история / отправка (payload — шифротекст) |
| PATCH/DELETE | `/api/messages/:id` | изменить / удалить |
| PUT | `/api/messages/:id/reaction` | реакция |
| POST/GET | `/api/files`, `/api/files/:id` | загрузка / скачивание зашифрованных файлов |
| GET | `/api/badges` | список бейджей |
| POST/DELETE | `/api/admin/badges` | создать / удалить бейдж (только админ) |
| PUT/DELETE | `/api/admin/users/:id/badges/:badgeId` | выдать / снять бейдж (только админ) |
| PUT | `/api/admin/users/:id/admin` | назначить админа |
| WS | `/ws?token=` | события: `message.new`, `message.updated`, `typing`, `read`, `presence`, `user.updated`, `chat.*` |

Тесты: `npm test`.
