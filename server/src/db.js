import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'ryzikchat.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar_file_id TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_premium INTEGER NOT NULL DEFAULT 0,
      public_key TEXT NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('direct', 'group', 'saved', 'channel')),
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      avatar_file_id TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      direct_key TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      pinned INTEGER NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      last_read_seq INTEGER NOT NULL DEFAULT 0,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS chat_members_user ON chat_members(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      sender_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      reply_to TEXT,
      forwarded_from TEXT,
      client_id TEXT,
      created_at INTEGER NOT NULL,
      edited_at INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0,
      UNIQUE (chat_id, seq)
    );

    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      emoji TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#6750A4',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      granted_by TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, badge_id)
    );
  `);
  migrate(db);
  return db;
}

/** Обновляет базу, созданную прошлыми версиями сервера. */
function migrate(db) {
  const cols = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols('users').includes('is_premium')) db.exec('ALTER TABLE users ADD COLUMN is_premium INTEGER NOT NULL DEFAULT 0');
  if (!cols('users').includes('emoji_status')) db.exec('ALTER TABLE users ADD COLUMN emoji_status TEXT');
  if (!cols('users').includes('twofa_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN twofa_hash TEXT');
    db.exec('ALTER TABLE users ADD COLUMN twofa_hint TEXT');
  }
  if (!cols('users').includes('profile_style')) db.exec('ALTER TABLE users ADD COLUMN profile_style TEXT');
  const chatsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chats'").get().sql;
  if (!chatsSql.includes("'channel'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE chats_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('direct', 'group', 'saved', 'channel')),
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        avatar_file_id TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seq INTEGER NOT NULL DEFAULT 0,
        direct_key TEXT UNIQUE
      );
      INSERT INTO chats_new (id, type, title, avatar_file_id, created_by, created_at, last_seq, direct_key)
        SELECT id, type, title, avatar_file_id, created_by, created_at, last_seq, direct_key FROM chats;
      DROP TABLE chats;
      ALTER TABLE chats_new RENAME TO chats;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
  if (!cols('chats').includes('is_public')) {
    db.exec('ALTER TABLE chats ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
    // До этого все каналы были открытыми, а группы — только по приглашению.
    db.exec("UPDATE chats SET is_public = 1 WHERE type = 'channel'");
  }
  if (!cols('chats').includes('invite_code')) db.exec('ALTER TABLE chats ADD COLUMN invite_code TEXT');
  // Модерация: бан и ограничение аккаунта, блокировка групп и каналов.
  if (!cols('users').includes('banned_until')) {
    db.exec('ALTER TABLE users ADD COLUMN banned_until INTEGER');
    db.exec('ALTER TABLE users ADD COLUMN ban_reason TEXT');
    db.exec('ALTER TABLE users ADD COLUMN restricted_until INTEGER');
    db.exec('ALTER TABLE users ADD COLUMN restrict_reason TEXT');
  }
  if (!cols('chats').includes('banned')) {
    db.exec('ALTER TABLE chats ADD COLUMN banned INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE chats ADD COLUMN ban_reason TEXT');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS moderation_log (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_name TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    until INTEGER,
    created_at INTEGER NOT NULL
  )`);
  // FLUX — внутренняя валюта: баланс, Премиум за FLUX, цена сообщений от незнакомцев.
  if (!cols('users').includes('flux')) {
    db.exec('ALTER TABLE users ADD COLUMN flux INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE users ADD COLUMN premium_until INTEGER');
    db.exec('ALTER TABLE users ADD COLUMN message_price INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS flux_tx (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      kind TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS flux_tx_user ON flux_tx(user_id, created_at);
    -- Подарки (NFT): админ создаёт их из картинки и ставит цену в FLUX.
    CREATE TABLE IF NOT EXISTS gift_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      file_id TEXT NOT NULL,
      price INTEGER NOT NULL,
      supply INTEGER,
      sold INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- Купленные экземпляры: у каждого свой номер, их можно дарить дальше.
    CREATE TABLE IF NOT EXISTS gifts (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES gift_items(id) ON DELETE CASCADE,
      serial INTEGER NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_user_id TEXT,
      message TEXT NOT NULL DEFAULT '',
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gifts_owner ON gifts(owner_id);
  `);
  // Кто может звонить: all / contacts / nobody.
  if (!cols('users').includes('call_privacy')) db.exec("ALTER TABLE users ADD COLUMN call_privacy TEXT NOT NULL DEFAULT 'all'");
  // Подарки бывают двух видов: эмодзи (встроенные) и NFT (картинка от админа). У обоих есть анимация.
  if (!cols('gift_items').includes('kind')) {
    db.exec("ALTER TABLE gift_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'nft'");
    db.exec('ALTER TABLE gift_items ADD COLUMN emoji TEXT');
    db.exec("ALTER TABLE gift_items ADD COLUMN caption TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE gift_items ADD COLUMN animation TEXT NOT NULL DEFAULT 'none'");
  }
  // Публичный @юзернейм группы или канала.
  if (!cols('chats').includes('username')) {
    db.exec('ALTER TABLE chats ADD COLUMN username TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS chats_username ON chats(lower(username)) WHERE username IS NOT NULL');
  }
  if (!cols('chats').includes('wallpaper_file_id')) db.exec('ALTER TABLE chats ADD COLUMN wallpaper_file_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS chats_invite_code ON chats(invite_code)');
  // Поиск повторной отправки сообщения по clientId.
  db.exec('CREATE INDEX IF NOT EXISTS messages_client ON messages(chat_id, client_id)');
  if (!cols('users').includes('email')) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
    db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, contact_id)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS sticker_packs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      emoji TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS stickers_pack ON stickers(pack_id);
    CREATE INDEX IF NOT EXISTS stickers_file ON stickers(file_id);
    CREATE TABLE IF NOT EXISTS user_sticker_packs (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, pack_id)
    );
    -- Коды подтверждения: вход с нового устройства и привязка почты.
    CREATE TABLE IF NOT EXISTS codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL
    );
  `);
}

/** Выполняет fn внутри транзакции. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
