import { serverVersion } from './selfupdate.js';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tx } from './db.js';
import { DOCS_HTML } from './docs.js';
import { checkBody, checkQuery } from './validate.js';

const now = () => Date.now();
export const SYSTEM_ID = 'ryzikchat-info';
const newId = () => crypto.randomUUID();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const MESSAGE_TYPES = new Set(['text', 'image', 'video', 'file', 'voice', 'square', 'sticker', 'call']);
const FREE_FILE_MB = Number(process.env.FREE_FILE_MB ?? 200);
const PREMIUM_FILE_MB = Number(process.env.MAX_FILE_MB ?? 2048);
const MAX_PAYLOAD = 64 * 1024;
/** Срок «навсегда» для бана и ограничения. */
const FOREVER = 253402300799000;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Создаёт express-приложение. `hub` — объект с методами sendToUsers / isOnline
 * (реализован в realtime.js), через него REST-запросы рассылают события по WebSocket.
 */
export function createApp({ db, dataDir, hub, adminUsernames = [], updateSource = null }) {
  const filesDir = path.join(dataDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  // Проверка запросов: неверные типы полей — сразу 400 с понятным текстом.
  app.use('/api', (req, _res, next) => {
    const bad = checkQuery(req.query) ?? (['POST', 'PUT', 'PATCH'].includes(req.method) && req.is('application/json') ? checkBody(req.body) : null);
    next(bad ? new HttpError(400, 'bad_request', bad) : undefined);
  });

  // Последние ошибки сервера: видны админу во вкладке «Сервер», чтобы было понятно, что сломалось.
  const recentErrors = [];
  app.locals.recentErrors = recentErrors;

  /** Отдаёт файл; если его нет на диске — 404, а не 500. */
  function sendStored(res, next, file) {
    res.sendFile(file, (err) => {
      if (!err || res.headersSent) return;
      next(err.code === 'ENOENT' ? new HttpError(404, 'file_missing', 'Файл не найден на сервере') : err);
    });
  }

  function safeJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  // ---------- helpers ----------

  const badgesOf = db.prepare(`
    SELECT b.id, b.emoji, b.title, b.description, b.color FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ? ORDER BY ub.granted_at`);

  function publicUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      bio: row.bio,
      avatarFileId: row.avatar_file_id ?? null,
      isAdmin: !!row.is_admin,
      // Галочка верификации (выдаёт администратор). У RyzikChat Info она есть всегда.
      verified: !!row.verified || row.id === SYSTEM_ID,
      isPremium: hasPremium(row),
      // Оформление профиля и эмодзи-статус — возможности Премиума.
      emojiStatus: hasPremium(row) ? row.emoji_status ?? null : null,
      profileStyle: hasPremium(row) && row.profile_style ? safeJson(row.profile_style) : null,
      // Сколько FLUX стоит написать этому человеку, если вы не у него в контактах.
      messagePrice: row.message_price ?? 0,
      callPrivacy: row.call_privacy ?? 'all',
      publicKey: row.public_key,
      online: hub.isOnline(row.id),
      lastSeen: row.last_seen,
      badges: badgesOf.all(row.id),
      isBanned: isBannedRow(row),
    };
  }

  /** Премиум: выдан админом навсегда или куплен за FLUX до premium_until. */
  function hasPremium(row) { return !!row?.is_premium || (row?.premium_until ?? 0) > now(); }

  // ---------- модерация: проверки ----------
  /** Бан и ограничение действуют до *_until; null — нет, FOREVER — навсегда. */
  const activeUntil = (until) => until != null && (until === FOREVER || until > now());
  function isBannedRow(row) { return activeUntil(row?.banned_until ?? null); }
  function isRestrictedRow(row) { return activeUntil(row?.restricted_until ?? null); }
  const untilText = (until) => until === FOREVER ? 'навсегда' : `до ${new Date(until).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК`;

  /** Ограниченный аккаунт может читать, но не писать, не создавать чаты и не загружать файлы. */
  function requireNotRestricted(userId) {
    const row = getUserRow.get(userId);
    if (isRestrictedRow(row)) {
      throw new HttpError(403, 'restricted', `Ваш аккаунт ограничен ${untilText(row.restricted_until)}` + (row.restrict_reason ? `. Причина: ${row.restrict_reason}` : ''));
    }
  }

  function requireChatNotBanned(chat) {
    if (chat?.banned) throw new HttpError(403, 'chat_banned', 'Этот чат заблокирован модерацией' + (chat.ban_reason ? `. Причина: ${chat.ban_reason}` : ''));
  }

  const getUserRow = db.prepare('SELECT * FROM users WHERE id = ?');
  const getUser = (id) => publicUser(getUserRow.get(id));

  const memberIdsStmt = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?');
  const memberIds = (chatId) => memberIdsStmt.all(chatId).map((r) => r.user_id);

  const membershipStmt = db.prepare('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?');

  function requireMember(chatId, userId) {
    const m = membershipStmt.get(chatId, userId);
    if (!m) throw new HttpError(404, 'chat_not_found', 'Чат не найден');
    return m;
  }

  const reactionsStmt = db.prepare('SELECT user_id, emoji FROM reactions WHERE message_id = ?');
  const chatTypeStmt = db.prepare('SELECT type, discussion_id FROM chats WHERE id = ?');
  const viewsStmt = db.prepare('SELECT COUNT(*) AS n FROM post_views WHERE message_id = ?');
  const commentCountStmt = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE comment_of = ? AND deleted = 0');

  function publicMessage(row) {
    return {
      id: row.id,
      chatId: row.chat_id,
      seq: row.seq,
      senderId: row.sender_id,
      type: row.type,
      payload: row.deleted ? null : row.payload,
      replyTo: row.reply_to ?? null,
      forwardedFrom: row.forwarded_from ?? null,
      clientId: row.client_id ?? null,
      createdAt: row.created_at,
      editedAt: row.edited_at ?? null,
      deleted: !!row.deleted,
      reactions: row.deleted ? [] : reactionsStmt.all(row.id).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
      commentOf: row.comment_of ?? null,
      ...postStats(row),
    };
  }

  /** У постов канала — просмотры и, если есть обсуждение, число комментариев. */
  function postStats(row) {
    const c = chatTypeStmt.get(row.chat_id);
    if (c?.type !== 'channel') return {};
    return {
      views: viewsStmt.get(row.id).n,
      comments: c.discussion_id ? commentCountStmt.get(row.id).n : 0,
    };
  }

  const lastMessageStmt = db.prepare(
    'SELECT * FROM messages WHERE chat_id = ? AND deleted = 0 ORDER BY seq DESC LIMIT 1');
  const unreadStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND seq > ? AND sender_id != ? AND deleted = 0');
  const getChatRow = db.prepare('SELECT * FROM chats WHERE id = ?');

  const memberCountStmt = db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?');
  const linkedChannelStmt = db.prepare("SELECT id FROM chats WHERE type = 'channel' AND discussion_id = ? LIMIT 1");

  /** Представление чата для пользователя. preview=true — для каналов, на которые он ещё не подписан. */
  function chatView(chatId, userId, { preview = false } = {}) {
    const chat = getChatRow.get(chatId);
    const me = membershipStmt.get(chatId, userId);
    if (!chat || (!me && !(preview && (chat.is_public || preview === 'invite') && ['group', 'channel'].includes(chat.type)))) return null;
    // У канала могут быть тысячи подписчиков — отдаём только владельца и админов.
    const members = chat.type === 'channel'
      ? db.prepare("SELECT user_id, role FROM chat_members WHERE chat_id = ? AND role IN ('owner', 'admin')").all(chatId)
      : db.prepare('SELECT user_id, role FROM chat_members WHERE chat_id = ?').all(chatId);
    const last = lastMessageStmt.get(chatId);
    return {
      id: chat.id,
      type: chat.type,
      title: chat.title,
      description: chat.description ?? '',
      avatarFileId: chat.avatar_file_id ?? null,
      // Обои чата из фото: их видят все участники.
      wallpaperFileId: chat.wallpaper_file_id ?? null,
      // Заблокирован модерацией: писать и вступать нельзя.
      banned: !!chat.banned,
      banReason: chat.banned ? chat.ban_reason ?? '' : '',
      isPublic: !!chat.is_public,
      username: chat.is_public ? chat.username ?? null : null,
      // Служебный чат RyzikChat Info: сюда приходят коды входа.
      isService: chat.created_by === SYSTEM_ID,
      verified: !!chat.verified || chat.created_by === SYSTEM_ID,
      // Канал: группа с комментариями. Группа: канал, к которому она привязана.
      discussionId: chat.type === 'channel' ? chat.discussion_id ?? null : null,
      linkedChannelId: chat.type === 'group' ? linkedChannelStmt.get(chat.id)?.id ?? null : null,
      ...(chat.type === 'direct' ? directFlags(chat.id, userId) : {}),
      // Ссылку-приглашение видят владелец и админы, а в открытых — все участники.
      inviteCode: me && (chat.is_public || ['owner', 'admin'].includes(me.role)) ? chat.invite_code ?? null : null,
      createdBy: chat.created_by,
      createdAt: chat.created_at,
      members: members.map((m) => ({ user: getUser(m.user_id), role: m.role })),
      memberCount: memberCountStmt.get(chatId).n,
      myRole: me?.role ?? null,
      lastMessage: last ? publicMessage(last) : null,
      unread: me ? unreadStmt.get(chatId, me.last_read_seq, userId).n : 0,
      lastReadSeq: me?.last_read_seq ?? 0,
      pinned: !!me?.pinned,
      muted: !!me?.muted,
      archived: !!me?.archived,
    };
  }

  const newInviteCode = () => crypto.randomBytes(9).toString('base64url');

  // @юзернейм группы или канала: 5–32 символа, латиница, цифры и _, начинается с буквы.
  // Общий с пользователями: один и тот же @ не может быть и у человека, и у группы.
  const CHAT_USERNAME = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
  function checkChatUsername(name, chatId = null) {
    const u = String(name ?? '').trim().replace(/^@/, '');
    if (!CHAT_USERNAME.test(u)) throw new HttpError(400, 'bad_username', 'Юзернейм: 5–32 символа, латиница, цифры и _, начинается с буквы');
    const taken = db.prepare('SELECT id FROM chats WHERE lower(username) = lower(?)').get(u);
    if ((taken && taken.id !== chatId) || db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(u)) {
      throw new HttpError(409, 'username_taken', 'Этот юзернейм уже занят');
    }
    return u;
  }

  function createChat({ type, title = '', description = '', createdBy, members, directKey = null, isPublic = false, avatarFileId = null }) {
    const id = newId();
    const t = now();
    const code = ['group', 'channel'].includes(type) ? newInviteCode() : null;
    db.prepare(`INSERT INTO chats (id, type, title, description, created_by, created_at, direct_key, is_public, invite_code, avatar_file_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, type, title, description, createdBy, t, directKey, isPublic ? 1 : 0, code, avatarFileId || null);
    const add = db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)');
    for (const m of members) add.run(id, m, m === createdBy ? 'owner' : type === 'channel' ? 'subscriber' : 'member', t);
    return id;
  }

  function broadcastChat(chatId, event) {
    hub.sendToUsers(memberIds(chatId), event);
  }

  const STYLE_KEYS = {
    color1: 'color', color2: 'color', nameColor: 'color',
    pattern: 'text', bannerFileId: 'text', ring: 'text', effect: 'text', font: 'text',
  };

  /** Оставляет в оформлении профиля только известные поля с разумными значениями. */
  function cleanProfileStyle(style) {
    if (!style || typeof style !== 'object') return null;
    const out = {};
    for (const [k, kind] of Object.entries(STYLE_KEYS)) {
      const v = style[k];
      if (v === undefined || v === null || v === '') continue;
      if (kind === 'color') {
        if (/^#[0-9a-fA-F]{6}$/.test(String(v))) out[k] = String(v);
      } else out[k] = String(v).slice(0, 64);
    }
    return Object.keys(out).length ? JSON.stringify(out) : null;
  }

  // ---------- служебный чат, коды, блокировка ----------

  const CODE_TTL_MS = 10 * 60_000;
  // Системный пользователь, от имени которого пишет RyzikChat Info. Войти под ним нельзя.
  if (!getUserRow.get(SYSTEM_ID)) {
    db.prepare(`INSERT INTO users (id, username, display_name, password_hash, bio, public_key, encrypted_private_key, created_at)
      VALUES (?, 'ryzikchat_info', 'RyzikChat Info', ?, 'Официальные уведомления RyzikChat', '', '', ?)`)
      .run(SYSTEM_ID, 'disabled:' + crypto.randomBytes(16).toString('hex'), now());
  }

  /** Личный служебный чат пользователя с RyzikChat Info (закреплён сверху). */
  function ensureInfoChat(userId) {
    const key = 'info:' + userId;
    const existing = db.prepare('SELECT id FROM chats WHERE direct_key = ?').get(key);
    if (existing) return existing.id;
    const id = newId();
    db.prepare(`INSERT INTO chats (id, type, title, description, created_by, created_at, direct_key, is_public)
      VALUES (?, 'channel', 'RyzikChat Info', 'Коды для входа и важные уведомления', ?, ?, ?, 0)`).run(id, SYSTEM_ID, now(), key);
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(id, SYSTEM_ID, now());
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role, pinned, joined_at) VALUES (?, ?, 'subscriber', 1, ?)").run(id, userId, now());
    hub.sendToUsers([userId], { type: 'chat.new', chat: chatView(id, userId) });
    return id;
  }

  /** Сообщение от RyzikChat Info. Как в каналах, не шифруется. */
  function postInfo(userId, text) {
    const chatId = ensureInfoChat(userId);
    const msg = tx(db, () => {
      const chat = getChatRow.get(chatId);
      const seq = chat.last_seq + 1;
      const id = newId();
      db.prepare('UPDATE chats SET last_seq = ? WHERE id = ?').run(seq, chatId);
      db.prepare(`INSERT INTO messages (id, chat_id, seq, sender_id, type, payload, created_at) VALUES (?, ?, ?, ?, 'text', ?, ?)`)
        .run(id, chatId, seq, SYSTEM_ID, JSON.stringify({ v: 0, plain: { text } }), now());
      return publicMessage(getMessageRowById.get(id));
    });
    hub.sendToUsers([userId], { type: 'message.new', message: msg });
  }
  const getMessageRowById = db.prepare('SELECT * FROM messages WHERE id = ?');

  // ---------- общая группа «RyzikChat (Обсуждение)» ----------
  // Все пользователи состоят в ней: существующие добавляются, когда группа создаётся, новые — при регистрации.
  const DISCUSSION_KEY = 'discussion';
  const discussionId = () => db.prepare('SELECT id FROM chats WHERE direct_key = ?').get(DISCUSSION_KEY)?.id ?? null;

  function ensureDiscussion() {
    const existing = discussionId();
    if (existing) return existing;
    const owner = db.prepare('SELECT id FROM users WHERE id != ? ORDER BY is_admin DESC, created_at LIMIT 1').get(SYSTEM_ID);
    if (!owner) return null;
    const users = db.prepare('SELECT id, is_admin FROM users WHERE id != ?').all(SYSTEM_ID);
    return tx(db, () => {
      const id = createChat({
        type: 'group', title: 'RyzikChat (Обсуждение)', description: 'Общий чат всех пользователей RyzikChat',
        createdBy: owner.id, members: users.map((u) => u.id), directKey: DISCUSSION_KEY, isPublic: true,
      });
      // Администраторы приложения — администраторы группы.
      const promote = db.prepare("UPDATE chat_members SET role = 'admin' WHERE chat_id = ? AND user_id = ? AND role = 'member'");
      for (const u of users) if (u.is_admin) promote.run(id, u.id);
      return id;
    });
  }

  function joinDiscussion(userId) {
    const id = ensureDiscussion();
    if (!id) return;
    db.prepare("INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(id, userId, now());
    const others = memberIds(id).filter((m) => m !== userId);
    hub.sendToUsers([userId], { type: 'chat.new', chat: chatView(id, userId) });
    hub.sendToUsers(others, { type: 'chat.updated', chatId: id });
  }
  ensureDiscussion();

  /** Личный чат двух людей; создаётся, если его ещё нет. */
  function directChatId(a, b) {
    const key = [a, b].sort().join(':');
    const row = db.prepare('SELECT id FROM chats WHERE direct_key = ?').get(key);
    if (row) return row.id;
    const id = tx(db, () => createChat({ type: 'direct', createdBy: a, members: [a, b], directKey: key }));
    hub.sendToUsers([a], { type: 'chat.new', chat: chatView(id, a) });
    hub.sendToUsers([b], { type: 'chat.new', chat: chatView(id, b), by: a });
    return id;
  }

  /** Подарок появляется в личном чате как сообщение от дарителя (открытым текстом, как в каналах). */
  function postGiftMessage(fromId, toId, giftId) {
    const g = db.prepare('SELECT * FROM gifts WHERE id = ?').get(giftId);
    const item = g && giftItemRow.get(g.item_id);
    if (!item) return;
    const chatId = directChatId(fromId, toId);
    const gift = {
      giftId: g.id, itemId: item.id, title: item.title, fileId: item.file_id, serial: g.serial, supply: item.supply ?? null, price: item.price,
      message: g.message ?? '', kind: item.kind ?? 'nft', emoji: item.emoji ?? null, caption: item.caption ?? '', animation: item.animation ?? 'none',
    };
    const msg = tx(db, () => {
      const chat = getChatRow.get(chatId);
      const seq = chat.last_seq + 1;
      const id = newId();
      db.prepare('UPDATE chats SET last_seq = ? WHERE id = ?').run(seq, chatId);
      db.prepare(`INSERT INTO messages (id, chat_id, seq, sender_id, type, payload, created_at) VALUES (?, ?, ?, ?, 'gift', ?, ?)`)
        .run(id, chatId, seq, fromId, JSON.stringify({ v: 0, plain: { text: g.message ?? '', gift } }), now());
      db.prepare('UPDATE chat_members SET last_read_seq = ? WHERE chat_id = ? AND user_id = ?').run(seq, chatId, fromId);
      return publicMessage(getMessageRowById.get(id));
    });
    broadcastChat(chatId, { type: 'message.new', message: msg });
  }

  const blockedStmt = db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?');
  const contactStmt = db.prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?');
  /** Заблокировал ли `owner` пользователя `other`. */
  const isBlocked = (owner, other) => !!blockedStmt.get(owner, other);

  /** Пользователь глазами `viewerId`: в контактах ли он и заблокирован ли. */
  function userFor(id, viewerId) {
    const u = getUser(id);
    if (!u) return null;
    return { ...u, isContact: !!contactStmt.get(viewerId, id), isBlocked: isBlocked(viewerId, id), isService: id === SYSTEM_ID };
  }

  function directFlags(chatId, userId) {
    const peer = memberIds(chatId).find((id) => id !== userId);
    if (!peer) return {};
    return { peerIsContact: !!contactStmt.get(userId, peer), peerBlocked: isBlocked(userId, peer) };
  }

  // ---------- auth ----------

  const sessionStmt = db.prepare('SELECT user_id FROM sessions WHERE token = ?');

  function auth(req, _res, next) {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    const s = token && sessionStmt.get(String(token));
    if (!s) return next(new HttpError(401, 'unauthorized', 'Нужно войти заново'));
    const u = getUserRow.get(s.user_id);
    if (isBannedRow(u)) return next(bannedError(u));
    req.userId = s.user_id;
    req.token = String(token);
    next();
  }

  function bannedError(row) {
    return new HttpError(403, 'banned', `Аккаунт заблокирован ${untilText(row.banned_until)}` + (row.ban_reason ? `. Причина: ${row.ban_reason}` : ''));
  }

  function adminOnly(req, _res, next) {
    const u = getUserRow.get(req.userId);
    if (!u?.is_admin) return next(new HttpError(403, 'forbidden', 'Только для администраторов'));
    next();
  }

  function createSession(userId, device) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token, user_id, device, created_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, String(device ?? '').slice(0, 100), now());
    return token;
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'RyzikChat', version: serverVersion(), apiVersion: 1 }));

  // Открытое описание API — чтобы можно было написать клиент под любое устройство.
  app.get('/api/openapi.json', (_req, res) => res.sendFile(path.join(import.meta.dirname, '..', 'openapi.json')));
  app.get('/api/docs', (_req, res) => res.type('html').send(DOCS_HTML));

  app.post('/api/auth/register', (req, res) => {
    const { username, displayName, password, publicKey, encryptedPrivateKey, device } = req.body ?? {};
    if (!USERNAME_RE.test(username ?? '')) {
      throw new HttpError(400, 'bad_username', 'Имя пользователя: 3–32 символа, латиница, цифры и _');
    }
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'bad_password', 'Пароль слишком короткий');
    if (typeof publicKey !== 'string' || typeof encryptedPrivateKey !== 'string') {
      throw new HttpError(400, 'bad_keys', 'Нет ключей шифрования');
    }
    const name = String(displayName ?? '').trim().slice(0, 64) || username;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username) || db.prepare('SELECT 1 FROM chats WHERE lower(username) = lower(?)').get(username)) {
      throw new HttpError(409, 'username_taken', 'Это имя пользователя уже занято');
    }
    const result = tx(db, () => {
      const id = newId();
      const first = db.prepare('SELECT COUNT(*) AS n FROM users WHERE id != ?').get(SYSTEM_ID).n === 0;
      const isAdmin = first || adminUsernames.includes(username.toLowerCase());
      db.prepare(`INSERT INTO users (id, username, display_name, password_hash, public_key, encrypted_private_key,
        is_admin, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, username, name, hashPassword(password), publicKey, encryptedPrivateKey, isAdmin ? 1 : 0, now(), now());
      createChat({ type: 'saved', title: 'Избранное', createdBy: id, members: [id] });
      ensureInfoChat(id);
      return { id, token: createSession(id, device) };
    });
    joinDiscussion(result.id);
    postInfo(result.id, `Добро пожаловать в RyzikChat!\n\nЭто служебный чат. Сюда приходят уведомления о входах в аккаунт и важные новости. ` +
      'Для защиты включите двухэтапную проверку в настройках конфиденциальности.');
    res.status(201).json({ token: result.token, user: getUser(result.id), encryptedPrivateKey });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password, device } = req.body ?? {};
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? ''));
    if (!row || typeof password !== 'string' || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, 'bad_credentials', 'Неверное имя пользователя или пароль');
    }
    if (isBannedRow(row)) throw bannedError(row);
    // Включена двухэтапная проверка — после пароля от аккаунта спрашиваем дополнительный пароль.
    if (row.twofa_hash) {
      const id = newId();
      db.prepare('INSERT INTO codes (id, user_id, kind, code_hash, data, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, row.id, '2fa', '', String(device ?? '').slice(0, 100), now() + CODE_TTL_MS);
      return res.json({ need2fa: true, challengeId: id, hint: row.twofa_hint ?? '' });
    }
    res.json(finishLogin(row, device));
  });

  app.post('/api/auth/login/2fa', (req, res) => {
    const { challengeId, password } = req.body ?? {};
    const id = String(challengeId ?? '');
    const ch = db.prepare("SELECT * FROM codes WHERE id = ? AND kind = '2fa'").get(id);
    if (!ch || ch.expires_at < now() || ch.attempts >= 5) {
      if (ch) db.prepare('DELETE FROM codes WHERE id = ?').run(id);
      throw new HttpError(400, 'code_expired', 'Время вышло. Войдите заново');
    }
    const user = getUserRow.get(ch.user_id);
    if (!user?.twofa_hash || !verifyPassword(String(password ?? ''), user.twofa_hash)) {
      db.prepare('UPDATE codes SET attempts = attempts + 1 WHERE id = ?').run(id);
      throw new HttpError(400, 'bad_2fa', 'Неверный пароль двухэтапной проверки');
    }
    db.prepare('DELETE FROM codes WHERE id = ?').run(id);
    res.json(finishLogin(user, ch.data));
  });

  /** Создаёт сеанс и сообщает в RyzikChat Info о входе с нового устройства. */
  function finishLogin(row, device) {
    const token = createSession(row.id, device);
    postInfo(row.id, `Новый вход в ваш аккаунт с устройства «${String(device || 'неизвестно').slice(0, 60)}». ` +
      'Если это были не вы, завершите чужие сеансы и смените пароль в настройках конфиденциальности.');
    return { token, user: publicUser(row), encryptedPrivateKey: row.encrypted_private_key };
  }

  // ---------- обновления приложения ----------
  // Телефоны скачивают новые версии с этого сервера, а не с GitHub. Сервер сам забирает свежую
  // сборку из updateSource (по умолчанию — релиз RyzikChat на GitHub), либо администратор
  // загружает APK вручную через /api/admin/app.
  const updatesDir = path.join(dataDir, 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const updateInfoPath = path.join(updatesDir, 'update.json');
  const apkPath = path.join(updatesDir, 'RyzikChat.apk');
  const readUpdateInfo = () => {
    try { return JSON.parse(fs.readFileSync(updateInfoPath, 'utf8')); } catch { return null; }
  };
  function saveUpdate(tmpApk, { versionCode, versionName, notes }) {
    fs.renameSync(tmpApk, apkPath);
    const info = { versionCode: Number(versionCode), versionName: String(versionName).slice(0, 32), notes: String(notes ?? '').slice(0, 2000), size: fs.statSync(apkPath).size };
    fs.writeFileSync(updateInfoPath, JSON.stringify(info));
    return info;
  }

  app.get('/api/app/update', (_req, res) => {
    const info = readUpdateInfo();
    if (!info || !fs.existsSync(apkPath)) throw new HttpError(404, 'no_update', 'На сервере нет сборки приложения');
    res.set('Cache-Control', 'no-cache');
    res.json({ ...info, apk: '/api/app/apk' });
  });

  app.get('/api/app/apk', (_req, res) => {
    if (!fs.existsSync(apkPath)) throw new HttpError(404, 'no_update', 'На сервере нет сборки приложения');
    res.set('Cache-Control', 'no-cache');
    res.download(apkPath, 'RyzikChat.apk');
  });

  /** Забирает свежую сборку из updateSource, если там версия новее. */
  async function syncUpdate() {
    if (!updateSource) return null;
    const remote = await (await fetch(`${updateSource}/update.json`, { cache: 'no-store' })).json();
    if (!Number.isInteger(remote?.versionCode)) throw new Error('update.json без versionCode');
    if ((readUpdateInfo()?.versionCode ?? 0) >= remote.versionCode && fs.existsSync(apkPath)) return null;
    const resp = await fetch(`${updateSource}/RyzikChat.apk`);
    if (!resp.ok) throw new Error(`APK: HTTP ${resp.status}`);
    const tmp = path.join(updatesDir, `download-${newId()}.apk`);
    fs.writeFileSync(tmp, Buffer.from(await resp.arrayBuffer()));
    return saveUpdate(tmp, remote);
  }
  app.locals.syncUpdate = syncUpdate;

  // Аватарки и обложки профилей видны всем (как имя), поэтому отдаём их без токена:
  // так их может загрузить любой загрузчик картинок. Другие файлы — только после входа.
  app.get('/api/avatars/:id', (req, res, next) => {
    const id = String(req.params.id);
    const used = db.prepare(`SELECT 1 FROM users WHERE avatar_file_id = ? UNION ALL SELECT 1 FROM chats WHERE avatar_file_id = ? OR wallpaper_file_id = ?
      UNION ALL SELECT 1 FROM stickers WHERE file_id = ? UNION ALL SELECT 1 FROM gift_items WHERE file_id = ? LIMIT 1`).get(id, id, id, id, id) ||
      db.prepare("SELECT 1 FROM users WHERE profile_style LIKE ? LIMIT 1").get(`%"${id.replace(/[%_"]/g, '')}"%`);
    const row = used && db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'file_not_found', 'Файл не найден');
    res.type(row.mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    sendStored(res, next, path.join(filesDir, row.id));
  });

  app.use('/api', auth);

  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    res.json({ ok: true });
  });

  app.get('/api/sessions', (req, res) => {
    const rows = db.prepare('SELECT token, device, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.userId);
    res.json(rows.map((r) => ({
      id: crypto.createHash('sha256').update(r.token).digest('hex').slice(0, 16),
      device: r.device,
      createdAt: r.created_at,
      current: r.token === req.token,
    })));
  });

  app.post('/api/sessions/terminate-others', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.userId, req.token);
    res.json({ ok: true });
  });

  // ---------- users ----------

  const meView = (id) => {
    const row = getUserRow.get(id);
    return {
      ...publicUser(row), has2fa: !!row?.twofa_hash, twofaHint: row?.twofa_hint ?? '',
      restrictedUntil: isRestrictedRow(row) ? row.restricted_until : null,
      restrictReason: isRestrictedRow(row) ? row.restrict_reason ?? '' : '',
      flux: row?.flux ?? 0,
      premiumUntil: row?.is_premium ? null : (row?.premium_until ?? 0) > now() ? row.premium_until : null,
    };
  };

  // Двухэтапная проверка: дополнительный пароль при входе на новом устройстве.
  app.put('/api/me/2fa', (req, res) => {
    const { accountPassword, currentPassword, password, hint } = req.body ?? {};
    const row = getUserRow.get(req.userId);
    if (!verifyPassword(String(accountPassword ?? ''), row.password_hash)) {
      throw new HttpError(403, 'bad_password', 'Неверный пароль от аккаунта');
    }
    if (row.twofa_hash && !verifyPassword(String(currentPassword ?? ''), row.twofa_hash)) {
      throw new HttpError(403, 'bad_2fa', 'Неверный текущий пароль двухэтапной проверки');
    }
    if (typeof password !== 'string' || password.length < 4 || password.length > 128) {
      throw new HttpError(400, 'bad_2fa_password', 'Пароль двухэтапной проверки: от 4 до 128 символов');
    }
    const h = String(hint ?? '').trim().slice(0, 64);
    if (h && h === password) throw new HttpError(400, 'bad_hint', 'Подсказка не должна совпадать с паролем');
    db.prepare('UPDATE users SET twofa_hash = ?, twofa_hint = ? WHERE id = ?').run(hashPassword(password), h, req.userId);
    res.json(meView(req.userId));
  });

  app.delete('/api/me/2fa', (req, res) => {
    const { password } = req.body ?? {};
    const row = getUserRow.get(req.userId);
    if (row.twofa_hash && !verifyPassword(String(password ?? ''), row.twofa_hash)) {
      throw new HttpError(403, 'bad_2fa', 'Неверный пароль двухэтапной проверки');
    }
    db.prepare('UPDATE users SET twofa_hash = NULL, twofa_hint = NULL WHERE id = ?').run(req.userId);
    res.json(meView(req.userId));
  });

  app.get('/api/me', (req, res) => res.json(meView(req.userId)));

  // ---------- контакты и блокировка ----------

  app.get('/api/contacts', (req, res) => {
    const rows = db.prepare(`SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id
      WHERE c.user_id = ? ORDER BY u.display_name COLLATE NOCASE`).all(req.userId);
    res.json(rows.map(publicUser));
  });

  app.put('/api/contacts/:id', (req, res) => {
    if (!getUserRow.get(req.params.id) || req.params.id === req.userId || req.params.id === SYSTEM_ID) {
      throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    }
    db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)').run(req.userId, req.params.id, now());
    res.json(userFor(req.params.id, req.userId));
  });

  app.delete('/api/contacts/:id', (req, res) => {
    db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(req.userId, req.params.id);
    res.json(userFor(req.params.id, req.userId));
  });

  app.get('/api/blocks', (req, res) => {
    const rows = db.prepare('SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ?').all(req.userId);
    res.json(rows.map(publicUser));
  });

  app.put('/api/blocks/:id', (req, res) => {
    if (!getUserRow.get(req.params.id) || req.params.id === req.userId || req.params.id === SYSTEM_ID) {
      throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    }
    db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').run(req.userId, req.params.id, now());
    db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(req.userId, req.params.id);
    res.json(userFor(req.params.id, req.userId));
  });

  app.delete('/api/blocks/:id', (req, res) => {
    db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(req.userId, req.params.id);
    res.json(userFor(req.params.id, req.userId));
  });

  app.patch('/api/me', (req, res) => {
    const { displayName, bio, avatarFileId, emojiStatus, profileStyle } = req.body ?? {};
    const premium = hasPremium(getUserRow.get(req.userId));
    if ((emojiStatus || profileStyle) && !premium) {
      throw new HttpError(403, 'premium_required', 'Это доступно с Премиумом');
    }
    if (emojiStatus !== undefined) {
      const e = emojiStatus ? String(emojiStatus).trim().slice(0, 16) : null;
      db.prepare('UPDATE users SET emoji_status = ? WHERE id = ?').run(e || null, req.userId);
    }
    if (profileStyle !== undefined) {
      db.prepare('UPDATE users SET profile_style = ? WHERE id = ?').run(cleanProfileStyle(profileStyle), req.userId);
    }
    if (displayName !== undefined) {
      const n = String(displayName).trim().slice(0, 64);
      if (!n) throw new HttpError(400, 'bad_name', 'Имя не может быть пустым');
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(n, req.userId);
    }
    if (bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(String(bio).slice(0, 300), req.userId);
    if (avatarFileId !== undefined) {
      db.prepare('UPDATE users SET avatar_file_id = ? WHERE id = ?').run(avatarFileId || null, req.userId);
    }
    if (req.body?.callPrivacy !== undefined) {
      const v = ['all', 'contacts', 'nobody'].includes(req.body.callPrivacy) ? req.body.callPrivacy : 'all';
      db.prepare('UPDATE users SET call_privacy = ? WHERE id = ?').run(v, req.userId);
    }
    if (req.body?.messagePrice !== undefined) {
      const price = Math.max(0, Math.min(10_000, Math.floor(Number(req.body.messagePrice) || 0)));
      db.prepare('UPDATE users SET message_price = ? WHERE id = ?').run(price, req.userId);
    }
    const me = getUser(req.userId);
    hub.broadcastUser(req.userId, { type: 'user.updated', user: me });
    res.json(me);
  });

  // Смена @юзернейма. Ключи шифрования выводятся из юзернейма и пароля, поэтому приложение
  // присылает старый ключ входа, новый ключ входа (для нового юзернейма) и заново зашифрованный ключ.
  app.post('/api/me/username', (req, res) => {
    const { password, newPassword, encryptedPrivateKey } = req.body ?? {};
    const username = String(req.body?.username ?? '').trim().replace(/^@/, '');
    const row = getUserRow.get(req.userId);
    if (!verifyPassword(String(password ?? ''), row.password_hash)) throw new HttpError(403, 'bad_credentials', 'Неверный пароль');
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'bad_username', 'Имя пользователя: 3–32 символа, латиница, цифры и _');
    if (typeof newPassword !== 'string' || newPassword.length < 8 || typeof encryptedPrivateKey !== 'string') {
      throw new HttpError(400, 'bad_keys', 'Нет новых ключей шифрования');
    }
    const taken = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?').get(username, req.userId)
      || db.prepare('SELECT 1 FROM chats WHERE lower(username) = lower(?)').get(username);
    if (taken) throw new HttpError(409, 'username_taken', 'Это имя пользователя уже занято');
    db.prepare('UPDATE users SET username = ?, password_hash = ?, encrypted_private_key = ? WHERE id = ?')
      .run(username, hashPassword(newPassword), encryptedPrivateKey, req.userId);
    const me = getUser(req.userId);
    hub.broadcastUser(req.userId, { type: 'user.updated', user: me });
    res.json(meView(req.userId));
  });

  app.post('/api/me/password', (req, res) => {
    const { oldPassword, newPassword, encryptedPrivateKey } = req.body ?? {};
    const row = getUserRow.get(req.userId);
    if (!verifyPassword(String(oldPassword ?? ''), row.password_hash)) {
      throw new HttpError(403, 'bad_credentials', 'Старый пароль неверный');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8 || typeof encryptedPrivateKey !== 'string') {
      throw new HttpError(400, 'bad_password', 'Новый пароль слишком короткий');
    }
    db.prepare('UPDATE users SET password_hash = ?, encrypted_private_key = ? WHERE id = ?')
      .run(hashPassword(newPassword), encryptedPrivateKey, req.userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.userId, req.token);
    res.json({ ok: true });
  });

  app.get('/api/users/search', (req, res) => {
    const q = String(req.query.q ?? '').trim().replace(/^@/, '');
    if (!q) return res.json([]);
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const rows = db.prepare(`SELECT * FROM users WHERE id != ? AND id != ? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
      ORDER BY username LIMIT 30`).all(req.userId, SYSTEM_ID, like, like);
    res.json(rows.filter((r) => !isBannedRow(r)).map(publicUser));
  });

  app.get('/api/users/:id', (req, res) => {
    const u = userFor(req.params.id, req.userId);
    if (!u) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    res.json(u);
  });

  // ---------- chats ----------

  app.get('/api/chats', (req, res) => {
    ensureInfoChat(req.userId);
    const ids = db.prepare('SELECT chat_id FROM chat_members WHERE user_id = ?').all(req.userId).map((r) => r.chat_id);
    const chats = ids.map((id) => chatView(id, req.userId)).filter(Boolean);
    chats.sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt) - (a.lastMessage?.createdAt ?? a.createdAt));
    res.json(chats);
  });

  app.get('/api/chats/search', (req, res) => searchPublic(req, res));

  app.get('/api/chats/:id', (req, res) => {
    const view = chatView(req.params.id, req.userId, { preview: true });
    if (!view) throw new HttpError(404, 'chat_not_found', 'Чат не найден');
    res.json(view);
  });

  app.post('/api/chats/direct', (req, res) => {
    const other = String(req.body?.userId ?? '');
    if (other === req.userId) {
      const saved = db.prepare(`SELECT c.id FROM chats c JOIN chat_members m ON m.chat_id = c.id
        WHERE c.type = 'saved' AND m.user_id = ?`).get(req.userId);
      const savedId = saved?.id ?? createChat({ type: 'saved', title: 'Избранное', createdBy: req.userId, members: [req.userId] });
      return res.json(chatView(savedId, req.userId));
    }
    if (!getUserRow.get(other)) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    const key = [req.userId, other].sort().join(':');
    let chat = db.prepare('SELECT id FROM chats WHERE direct_key = ?').get(key);
    let created = false;
    if (!chat) {
      chat = { id: createChat({ type: 'direct', createdBy: req.userId, members: [req.userId, other], directKey: key }) };
      created = true;
    }
    const view = chatView(chat.id, req.userId);
    if (created) hub.sendToUsers([other], { type: 'chat.new', chat: chatView(chat.id, other), by: req.userId });
    res.status(created ? 201 : 200).json(view);
  });

  app.post('/api/chats/group', (req, res) => {
    requireNotRestricted(req.userId);
    const title = String(req.body?.title ?? '').trim().slice(0, 128);
    if (!title) throw new HttpError(400, 'bad_title', 'Укажите название группы');
    const ids = [...new Set([req.userId, ...(req.body?.memberIds ?? []).map(String)])]
      .filter((id) => getUserRow.get(id));
    const description = String(req.body?.description ?? '').trim().slice(0, 500);
    const username = req.body?.username ? checkChatUsername(req.body.username) : null;
    const chatId = tx(db, () => {
      const id = createChat({
        type: 'group', title, description, createdBy: req.userId, members: ids,
        isPublic: !!req.body?.isPublic || !!username, avatarFileId: req.body?.avatarFileId,
      });
      if (username) db.prepare('UPDATE chats SET username = ? WHERE id = ?').run(username, id);
      return id;
    });
    for (const id of ids) if (id !== req.userId) hub.sendToUsers([id], { type: 'chat.new', chat: chatView(chatId, id), by: req.userId });
    res.status(201).json(chatView(chatId, req.userId));
  });

  // ---------- каналы ----------

  app.post('/api/chats/channel', (req, res) => {
    requireNotRestricted(req.userId);
    const title = String(req.body?.title ?? '').trim().slice(0, 128);
    if (!title) throw new HttpError(400, 'bad_title', 'Укажите название канала');
    const description = String(req.body?.description ?? '').trim().slice(0, 500);
    const username = req.body?.username ? checkChatUsername(req.body.username) : null;
    const chatId = tx(db, () => {
      const id = createChat({
        type: 'channel', title, description, createdBy: req.userId, members: [req.userId],
        isPublic: req.body?.isPublic !== false || !!username, avatarFileId: req.body?.avatarFileId,
      });
      if (username) db.prepare('UPDATE chats SET username = ? WHERE id = ?').run(username, id);
      return id;
    });
    res.status(201).json(chatView(chatId, req.userId));
  });

  /** Поиск открытых каналов и групп. */
  function searchPublic(req, res) {
    const q = String(req.query.q ?? '').trim();
    const bare = q.replace(/^@/, '');
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const ulike = `%${bare.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    // Точное совпадение @юзернейма — первым.
    const rows = db.prepare(`SELECT c.id, (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id = c.id) AS n,
        (lower(c.username) = lower(?)) AS exact FROM chats c
      WHERE c.type IN ('channel', 'group') AND c.is_public = 1 AND c.banned = 0
        AND (c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR c.username LIKE ? ESCAPE '\\')
      ORDER BY exact DESC, n DESC LIMIT 30`).all(bare, like, like, ulike);
    res.json(rows.map((r) => chatView(r.id, req.userId, { preview: true })).filter(Boolean));
  }
  app.get('/api/channels/search', searchPublic);

  /** Открытая группа или канал по @юзернейму (для ссылок ryzik://c/<юзернейм>). */
  app.get('/api/chats/by-username/:name', (req, res) => {
    const name = String(req.params.name).replace(/^@/, '');
    const chat = db.prepare('SELECT id FROM chats WHERE lower(username) = lower(?) AND is_public = 1 AND banned = 0').get(name);
    const view = chat && chatView(chat.id, req.userId, { preview: true });
    if (!view) throw new HttpError(404, 'chat_not_found', 'Группа или канал не найдены');
    res.json(view);
  });

  /** Свободен ли юзернейм для группы или канала. */
  app.get('/api/chat-username-check', (req, res) => {
    try {
      checkChatUsername(req.query.username, req.query.chatId ? String(req.query.chatId) : null);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.code, message: e.message });
    }
  });

  function join(chat, userId) {
    requireChatNotBanned(chat);
    const role = chat.type === 'channel' ? 'subscriber' : 'member';
    const added = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, last_read_seq, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(chat.id, userId, role, chat.last_seq, now()).changes;
    // В группе остальные должны узнать о новом участнике, чтобы шифровать сообщения и для него.
    if (added && chat.type === 'group') broadcastChat(chat.id, { type: 'chat.updated', chatId: chat.id });
  }

  app.post('/api/chats/:id/subscribe', (req, res) => {
    const chat = getChatRow.get(req.params.id);
    if (!chat || !['channel', 'group'].includes(chat.type) || !chat.is_public) {
      throw new HttpError(404, 'chat_not_found', 'Канал или группа не найдены');
    }
    join(chat, req.userId);
    res.json(chatView(chat.id, req.userId));
  });

  const chatByInvite = (code) => {
    const chat = db.prepare('SELECT * FROM chats WHERE invite_code = ?').get(String(code));
    if (!chat) throw new HttpError(404, 'invite_not_found', 'Ссылка-приглашение недействительна');
    return chat;
  };

  app.get('/api/invite/:code', (req, res) => {
    res.json(chatView(chatByInvite(req.params.code).id, req.userId, { preview: 'invite' }));
  });

  app.post('/api/invite/:code/join', (req, res) => {
    const chat = chatByInvite(req.params.code);
    join(chat, req.userId);
    res.json(chatView(chat.id, req.userId));
  });

  app.post('/api/chats/:id/invite/reset', (req, res) => {
    const m = requireMember(req.params.id, req.userId);
    const chat = getChatRow.get(req.params.id);
    if (!['group', 'channel'].includes(chat.type) || !['owner', 'admin'].includes(m.role)) {
      throw new HttpError(403, 'forbidden', 'Только владелец или админ');
    }
    db.prepare('UPDATE chats SET invite_code = ? WHERE id = ?').run(newInviteCode(), chat.id);
    res.json(chatView(chat.id, req.userId));
  });

  app.put('/api/chats/:id/members/:userId/role', (req, res) => {
    const m = requireMember(req.params.id, req.userId);
    const chat = getChatRow.get(req.params.id);
    if (chat.type !== 'channel' || m.role !== 'owner') throw new HttpError(403, 'forbidden', 'Только владелец канала');
    const role = req.body?.role === 'admin' ? 'admin' : 'subscriber';
    db.prepare("UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ? AND role != 'owner'").run(role, chat.id, req.params.userId);
    res.json(chatView(chat.id, req.userId));
  });

  app.patch('/api/chats/:id', (req, res) => {
    const m = requireMember(req.params.id, req.userId);
    const chat = getChatRow.get(req.params.id);
    const { title, avatarFileId, description, isPublic, username } = req.body ?? {};
    if (!['group', 'channel'].includes(chat.type) || !['owner', 'admin'].includes(m.role)) {
      throw new HttpError(403, 'forbidden', 'Только владелец или админ');
    }
    if (isPublic !== undefined) {
      if (m.role !== 'owner') throw new HttpError(403, 'forbidden', 'Сделать открытым или частным может только владелец');
      db.prepare('UPDATE chats SET is_public = ? WHERE id = ?').run(isPublic ? 1 : 0, chat.id);
      // Частной группе юзернейм не нужен — освобождаем его.
      if (!isPublic) db.prepare('UPDATE chats SET username = NULL WHERE id = ?').run(chat.id);
    }
    if (username !== undefined) {
      if (m.role !== 'owner') throw new HttpError(403, 'forbidden', 'Юзернейм меняет только владелец');
      if (!username) db.prepare('UPDATE chats SET username = NULL WHERE id = ?').run(chat.id);
      else db.prepare('UPDATE chats SET username = ?, is_public = 1 WHERE id = ?').run(checkChatUsername(username, chat.id), chat.id);
    }
    if (description !== undefined) db.prepare('UPDATE chats SET description = ? WHERE id = ?').run(String(description).slice(0, 500), chat.id);
    if (title !== undefined) db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(String(title).slice(0, 128), chat.id);
    if (avatarFileId !== undefined) db.prepare('UPDATE chats SET avatar_file_id = ? WHERE id = ?').run(avatarFileId || null, chat.id);
    broadcastChat(chat.id, { type: 'chat.updated', chatId: chat.id });
    res.json(chatView(chat.id, req.userId));
  });

  // ---------- обсуждение канала и комментарии ----------

  /** Привязать к каналу группу для комментариев (или отвязать: groupId = null). Только владелец канала. */
  app.put('/api/chats/:id/discussion', (req, res) => {
    const m = requireMember(req.params.id, req.userId);
    const chat = getChatRow.get(req.params.id);
    if (chat.type !== 'channel' || m.role !== 'owner') throw new HttpError(403, 'forbidden', 'Обсуждение настраивает владелец канала');
    const groupId = req.body?.groupId ? String(req.body.groupId) : null;
    const old = chat.discussion_id;
    if (groupId) {
      const g = getChatRow.get(groupId);
      const gm = g && membershipStmt.get(groupId, req.userId);
      if (!g || g.type !== 'group' || !gm) throw new HttpError(404, 'chat_not_found', 'Группа не найдена');
      if (!['owner', 'admin'].includes(gm.role)) throw new HttpError(403, 'forbidden', 'Привязать можно только группу, где вы владелец или админ');
      const busy = linkedChannelStmt.get(groupId);
      if (busy && busy.id !== chat.id) throw new HttpError(409, 'discussion_taken', 'Эта группа уже привязана к другому каналу');
    }
    db.prepare('UPDATE chats SET discussion_id = ? WHERE id = ?').run(groupId, chat.id);
    broadcastChat(chat.id, { type: 'chat.updated', chatId: chat.id });
    for (const id of new Set([old, groupId].filter(Boolean))) broadcastChat(id, { type: 'chat.updated', chatId: id });
    res.json(chatView(chat.id, req.userId));
  });

  /** Пост канала, который может видеть пользователь, и группа его обсуждения. */
  function commentablePost(messageId, userId) {
    const post = db.prepare('SELECT * FROM messages WHERE id = ?').get(String(messageId));
    const channel = post && getChatRow.get(post.chat_id);
    if (!post || post.deleted || channel?.type !== 'channel' || (!channel.is_public && !membershipStmt.get(channel.id, userId))) {
      throw new HttpError(404, 'message_not_found', 'Пост не найден');
    }
    const group = channel.discussion_id && getChatRow.get(channel.discussion_id);
    if (!group) throw new HttpError(400, 'no_discussion', 'У этого канала нет комментариев');
    return { post, channel, group };
  }

  app.get('/api/messages/:id/comments', (req, res) => {
    const { post, group } = commentablePost(req.params.id, req.userId);
    const before = req.query.before ? Number(req.query.before) : Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 200);
    const rows = db.prepare('SELECT * FROM messages WHERE comment_of = ? AND seq < ? ORDER BY seq DESC LIMIT ?').all(post.id, before, limit).reverse();
    const users = [...new Set(rows.map((r) => r.sender_id))].map(getUser).filter(Boolean);
    res.json({ post: publicMessage(post), groupId: group.id, comments: rows.map(publicMessage), users });
  });

  /** Комментарий: открытое (незашифрованное) сообщение в группе обсуждения. Писать может любой, кто видит канал. */
  app.post('/api/messages/:id/comments', (req, res) => {
    requireNotRestricted(req.userId);
    const { post, channel, group } = commentablePost(req.params.id, req.userId);
    requireChatNotBanned(group);
    const { type = 'text', payload, replyTo, clientId } = req.body ?? {};
    if (!MESSAGE_TYPES.has(type) || type === 'call') throw new HttpError(400, 'bad_type', 'Неизвестный тип сообщения');
    let plain = null;
    try { plain = JSON.parse(payload); } catch { /* ниже ошибка */ }
    if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD || plain?.v !== 0) {
      throw new HttpError(400, 'bad_payload', 'Комментарий должен быть открытым сообщением');
    }
    if (clientId) {
      const dup = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND sender_id = ? AND client_id = ?').get(group.id, req.userId, clientId);
      if (dup) return res.json(publicMessage(dup));
    }
    const msg = tx(db, () => {
      const g = getChatRow.get(group.id);
      const seq = g.last_seq + 1;
      const id = newId();
      db.prepare('UPDATE chats SET last_seq = ? WHERE id = ?').run(seq, g.id);
      db.prepare(`INSERT INTO messages (id, chat_id, seq, sender_id, type, payload, reply_to, client_id, comment_of, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, g.id, seq, req.userId, type, payload, replyTo ?? null, clientId ?? null, post.id, now());
      return publicMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
    });
    broadcastChat(group.id, { type: 'message.new', message: msg });
    const count = commentCountStmt.get(post.id).n;
    // Подписчикам канала — новое число комментариев и сам комментарий (для открытого экрана комментариев).
    const sender = getUser(req.userId);
    hub.sendToUsers([...memberIds(channel.id), req.userId], { type: 'comment.new', chatId: channel.id, messageId: post.id, count, message: msg, user: sender });
    res.status(201).json(msg);
  });

  /** Отметить посты канала просмотренными. Отвечает свежими числами просмотров. */
  app.post('/api/chats/:id/views', (req, res) => {
    const chat = getChatRow.get(req.params.id);
    if (chat?.type !== 'channel' || (!chat.is_public && !membershipStmt.get(chat.id, req.userId))) throw new HttpError(404, 'chat_not_found', 'Канал не найден');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string').slice(0, 200) : [];
    const inChat = db.prepare('SELECT 1 FROM messages WHERE id = ? AND chat_id = ?');
    const add = db.prepare('INSERT OR IGNORE INTO post_views (message_id, user_id) VALUES (?, ?)');
    const views = {};
    tx(db, () => {
      for (const id of ids) {
        if (!inChat.get(id, chat.id)) continue;
        add.run(id, req.userId);
        views[id] = viewsStmt.get(id).n;
      }
    });
    res.json({ views });
  });

  // Обои чата: в личном чате ставит любой участник, в группе и канале — владелец или админ.
  app.put('/api/chats/:id/wallpaper', (req, res) => {
    const m = requireMember(req.params.id, req.userId);
    const chat = getChatRow.get(req.params.id);
    if (['group', 'channel'].includes(chat.type) && !['owner', 'admin'].includes(m.role)) {
      throw new HttpError(403, 'forbidden', 'Обои меняют только владелец или админ');
    }
    const fileId = req.body?.fileId ? String(req.body.fileId) : null;
    if (fileId) {
      const f = db.prepare('SELECT owner_id, mime FROM files WHERE id = ?').get(fileId);
      if (!f || f.owner_id !== req.userId || !f.mime.startsWith('image/')) throw new HttpError(400, 'bad_file', 'Нужна картинка, загруженная вами');
    }
    db.prepare('UPDATE chats SET wallpaper_file_id = ? WHERE id = ?').run(fileId, chat.id);
    broadcastChat(chat.id, { type: 'chat.updated', chatId: chat.id });
    res.json(chatView(chat.id, req.userId));
  });

  app.patch('/api/chats/:id/settings', (req, res) => {
    requireMember(req.params.id, req.userId);
    for (const field of ['pinned', 'muted', 'archived']) {
      if (req.body?.[field] !== undefined) {
        db.prepare(`UPDATE chat_members SET ${field} = ? WHERE chat_id = ? AND user_id = ?`)
          .run(req.body[field] ? 1 : 0, req.params.id, req.userId);
      }
    }
    res.json(chatView(req.params.id, req.userId));
  });

  app.post('/api/chats/:id/members', (req, res) => {
    const m = requireMember(req.params.id, req.userId);
    const chat = getChatRow.get(req.params.id);
    if (chat.type !== 'group' || m.role !== 'owner') throw new HttpError(403, 'forbidden', 'Только владелец группы');
    const add = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)');
    const added = [];
    for (const id of (req.body?.userIds ?? []).map(String)) {
      if (getUserRow.get(id) && add.run(chat.id, id, 'member', now()).changes) added.push(id);
    }
    for (const id of added) hub.sendToUsers([id], { type: 'chat.new', chat: chatView(chat.id, id), by: req.userId });
    broadcastChat(chat.id, { type: 'chat.updated', chatId: chat.id });
    res.json(chatView(chat.id, req.userId));
  });

  app.delete('/api/chats/:id/members/:userId', (req, res) => {
    const m = requireMember(req.params.id, req.userId);
    const chat = getChatRow.get(req.params.id);
    const target = req.params.userId;
    if (!['group', 'channel'].includes(chat.type)) throw new HttpError(400, 'not_group', 'Это не группа и не канал');
    if (chat.created_by === SYSTEM_ID) throw new HttpError(400, 'service_chat', 'Служебный чат нельзя покинуть');
    if (chat.direct_key === DISCUSSION_KEY && target === req.userId) {
      throw new HttpError(400, 'discussion_leave', 'Из общего чата выйти нельзя, но можно отключить уведомления');
    }
    if (target !== req.userId && m.role !== 'owner') throw new HttpError(403, 'forbidden', 'Только владелец');
    if (target === req.userId && m.role === 'owner' && chat.type === 'channel') {
      throw new HttpError(400, 'owner_leave', 'Владелец не может покинуть свой канал');
    }
    const before = memberIds(chat.id);
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chat.id, target);
    hub.sendToUsers(before, { type: 'chat.updated', chatId: chat.id });
    hub.sendToUsers([target], { type: 'chat.removed', chatId: chat.id });
    res.json({ ok: true });
  });

  app.post('/api/chats/:id/read', (req, res) => {
    requireMember(req.params.id, req.userId);
    const seq = Number(req.body?.seq ?? 0);
    db.prepare('UPDATE chat_members SET last_read_seq = MAX(last_read_seq, ?) WHERE chat_id = ? AND user_id = ?')
      .run(seq, req.params.id, req.userId);
    broadcastChat(req.params.id, { type: 'read', chatId: req.params.id, userId: req.userId, seq });
    res.json({ ok: true });
  });

  app.get('/api/chats/:id/read-state', (req, res) => {
    requireMember(req.params.id, req.userId);
    const rows = db.prepare('SELECT user_id, last_read_seq FROM chat_members WHERE chat_id = ?').all(req.params.id);
    res.json(rows.map((r) => ({ userId: r.user_id, seq: r.last_read_seq })));
  });

  // ---------- messages ----------

  app.get('/api/chats/:id/messages', (req, res) => {
    const c = getChatRow.get(req.params.id);
    if (!(c?.type === 'channel' && c.is_public)) requireMember(req.params.id, req.userId);
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const before = req.query.before ? Number(req.query.before) : Number.MAX_SAFE_INTEGER;
    const after = req.query.after ? Number(req.query.after) : 0;
    const rows = db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND seq < ? AND seq > ?
      ORDER BY seq DESC LIMIT ?`).all(req.params.id, before, after, limit);
    res.json(rows.reverse().map(publicMessage));
  });

  app.post('/api/chats/:id/messages', (req, res) => {
    const member = requireMember(req.params.id, req.userId);
    requireNotRestricted(req.userId);
    requireChatNotBanned(getChatRow.get(req.params.id));
    if (getChatRow.get(req.params.id).type === 'channel' && !['owner', 'admin'].includes(member.role)) {
      throw new HttpError(403, 'forbidden', 'Писать в канал могут только его админы');
    }
    const target = getChatRow.get(req.params.id);
    if (target.created_by === SYSTEM_ID) throw new HttpError(403, 'forbidden', 'В служебный чат писать нельзя');
    if (target.type === 'direct') {
      const peer = memberIds(target.id).find((id) => id !== req.userId);
      if (peer && isBlocked(peer, req.userId)) throw new HttpError(403, 'blocked', 'Пользователь ограничил отправку вам сообщений');
    }
    const { type = 'text', payload, replyTo, forwardedFrom, clientId } = req.body ?? {};
    if (!MESSAGE_TYPES.has(type)) throw new HttpError(400, 'bad_type', 'Неизвестный тип сообщения');
    // Платные сообщения: если собеседник назначил цену, а вы не у него в контактах — платите FLUX ему.
    let paid = null;
    if (target.type === 'direct') {
      const peerId = memberIds(target.id).find((id) => id !== req.userId);
      const peer = peerId && getUserRow.get(peerId);
      const me = getUserRow.get(req.userId);
      if (type !== 'call' && peer?.message_price > 0 && !contactStmt.get(peer.id, req.userId) && !me.is_admin) paid = { to: peer, price: peer.message_price };
    }
    if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD) {
      throw new HttpError(400, 'bad_payload', 'Пустое или слишком большое сообщение');
    }
    // Повтор того же сообщения (сеть оборвалась, приложение отправило ещё раз) — не дублируем.
    if (clientId) {
      const dup = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND sender_id = ? AND client_id = ?').get(target.id, req.userId, clientId);
      if (dup) return res.status(200).json(publicMessage(dup));
    }
    const msg = tx(db, () => {
      if (paid) {
        moveFlux(req.userId, -paid.price, 'paid_message', `Сообщение для @${paid.to.username}`);
        moveFlux(paid.to.id, paid.price, 'paid_message_in', `Платное сообщение от @${getUserRow.get(req.userId).username}`);
      }
      const chat = getChatRow.get(req.params.id);
      const seq = chat.last_seq + 1;
      const id = newId();
      db.prepare('UPDATE chats SET last_seq = ? WHERE id = ?').run(seq, chat.id);
      db.prepare(`INSERT INTO messages (id, chat_id, seq, sender_id, type, payload, reply_to, forwarded_from, client_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, chat.id, seq, req.userId, type, payload, replyTo ?? null, forwardedFrom ?? null, clientId ?? null, now());
      db.prepare('UPDATE chat_members SET last_read_seq = ? WHERE chat_id = ? AND user_id = ?').run(seq, chat.id, req.userId);
      return publicMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
    });
    broadcastChat(msg.chatId, { type: 'message.new', message: msg });
    if (paid) { pushMe(req.userId); pushMe(paid.to.id); }
    res.status(201).json(msg);
  });

  const getMessageRow = db.prepare('SELECT * FROM messages WHERE id = ?');

  function requireMessage(id, userId) {
    const row = getMessageRow.get(id);
    if (!row) throw new HttpError(404, 'message_not_found', 'Сообщение не найдено');
    requireMember(row.chat_id, userId);
    return row;
  }

  app.patch('/api/messages/:id', (req, res) => {
    const row = requireMessage(req.params.id, req.userId);
    if (row.sender_id !== req.userId || row.deleted) throw new HttpError(403, 'forbidden', 'Можно менять только свои сообщения');
    const { payload } = req.body ?? {};
    if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD) throw new HttpError(400, 'bad_payload', 'Некорректное сообщение');
    db.prepare('UPDATE messages SET payload = ?, edited_at = ? WHERE id = ?').run(payload, now(), row.id);
    const msg = publicMessage(getMessageRow.get(row.id));
    broadcastChat(row.chat_id, { type: 'message.updated', message: msg });
    res.json(msg);
  });

  app.delete('/api/messages/:id', (req, res) => {
    const row = requireMessage(req.params.id, req.userId);
    const me = getUserRow.get(req.userId);
    const member = membershipStmt.get(row.chat_id, req.userId);
    if (row.sender_id !== req.userId && member.role !== 'owner' && !me.is_admin) {
      throw new HttpError(403, 'forbidden', 'Нельзя удалить чужое сообщение');
    }
    db.prepare("UPDATE messages SET deleted = 1, payload = '' WHERE id = ?").run(row.id);
    db.prepare('DELETE FROM reactions WHERE message_id = ?').run(row.id);
    const msg = publicMessage(getMessageRow.get(row.id));
    broadcastChat(row.chat_id, { type: 'message.updated', message: msg });
    res.json(msg);
  });

  app.put('/api/messages/:id/reaction', (req, res) => {
    const row = requireMessage(req.params.id, req.userId);
    const emoji = String(req.body?.emoji ?? '').slice(0, 16);
    if (!emoji) {
      db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').run(row.id, req.userId);
    } else {
      db.prepare('INSERT OR REPLACE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(row.id, req.userId, emoji);
    }
    const msg = publicMessage(getMessageRow.get(row.id));
    broadcastChat(row.chat_id, { type: 'message.updated', message: msg });
    // Автору сообщения — отдельное событие, чтобы показать уведомление «отреагировал ❤️».
    if (emoji && row.sender_id !== req.userId) {
      hub.sendToUsers([row.sender_id], { type: 'reaction', chatId: row.chat_id, messageId: row.id, userId: req.userId, emoji });
    }
    res.json(msg);
  });

  // ---------- files ----------
  // Медиа приходит уже зашифрованным на устройстве: сервер хранит только непрозрачные байты.
  // Исключение — аватарки, они публичные.

  const upload = multer({
    storage: multer.diskStorage({
      destination: filesDir,
      filename: (_req, _file, cb) => cb(null, newId()),
    }),
    limits: { fileSize: PREMIUM_FILE_MB * 1024 * 1024 },
  });

  app.post('/api/files', upload.single('file'), (req, res) => {
    if (!req.file) throw new HttpError(400, 'no_file', 'Файл не получен');
    try { requireNotRestricted(req.userId); } catch (e) { fs.rmSync(req.file.path, { force: true }); throw e; }
    if (!hasPremium(getUserRow.get(req.userId)) && req.file.size > FREE_FILE_MB * 1024 * 1024) {
      fs.rmSync(req.file.path, { force: true });
      throw new HttpError(413, 'too_large', `Без Премиума можно отправлять файлы до ${FREE_FILE_MB} МБ`);
    }
    const id = req.file.filename;
    const mime = String(req.body?.mime ?? req.file.mimetype ?? 'application/octet-stream').slice(0, 100);
    db.prepare('INSERT INTO files (id, owner_id, size, mime, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.userId, req.file.size, mime, now());
    res.status(201).json({ id, size: req.file.size, mime });
  });

  app.get('/api/files/:id', (req, res, next) => {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
    if (!row) throw new HttpError(404, 'file_not_found', 'Файл не найден');
    res.type(row.mime);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    sendStored(res, next, path.join(filesDir, row.id));
  });

  // ---------- стикеры ----------
  // Стикер — картинка (PNG/WebP), загруженная открыто. Паки можно пересылать друзьям по ссылке.
  const MAX_STICKERS = 120;
  const packRow = db.prepare('SELECT * FROM sticker_packs WHERE id = ?');
  const packStickers = db.prepare('SELECT id, file_id, emoji FROM stickers WHERE pack_id = ? ORDER BY position, created_at');
  const isAdded = db.prepare('SELECT 1 FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?');

  function packView(id, userId) {
    const p = packRow.get(id);
    if (!p) return null;
    return {
      id: p.id,
      title: p.title,
      ownerId: p.owner_id,
      isMine: p.owner_id === userId,
      isAdded: !!isAdded.get(userId, p.id),
      stickers: packStickers.all(p.id).map((st) => ({ id: st.id, fileId: st.file_id, emoji: st.emoji ?? '' })),
    };
  }
  function requirePack(id, userId, own = false) {
    const p = packRow.get(String(id));
    if (!p) throw new HttpError(404, 'pack_not_found', 'Набор стикеров не найден');
    if (own && p.owner_id !== userId) throw new HttpError(403, 'forbidden', 'Это не ваш набор');
    return p;
  }

  app.get('/api/stickers', (req, res) => {
    const ids = db.prepare('SELECT pack_id FROM user_sticker_packs WHERE user_id = ? ORDER BY added_at').all(req.userId);
    res.json(ids.map((r) => packView(r.pack_id, req.userId)).filter(Boolean));
  });

  app.post('/api/stickers/packs', (req, res) => {
    requireNotRestricted(req.userId);
    const title = String(req.body?.title ?? '').trim().slice(0, 64);
    if (!title) throw new HttpError(400, 'bad_title', 'Придумайте название набора');
    const id = newId();
    tx(db, () => {
      db.prepare('INSERT INTO sticker_packs (id, owner_id, title, created_at) VALUES (?, ?, ?, ?)').run(id, req.userId, title, now());
      db.prepare('INSERT INTO user_sticker_packs (user_id, pack_id, added_at) VALUES (?, ?, ?)').run(req.userId, id, now());
    });
    res.status(201).json(packView(id, req.userId));
  });

  app.get('/api/stickers/packs/:id', (req, res) => {
    requirePack(req.params.id, req.userId);
    res.json(packView(req.params.id, req.userId));
  });

  app.patch('/api/stickers/packs/:id', (req, res) => {
    const p = requirePack(req.params.id, req.userId, true);
    const title = String(req.body?.title ?? '').trim().slice(0, 64);
    if (title) db.prepare('UPDATE sticker_packs SET title = ? WHERE id = ?').run(title, p.id);
    res.json(packView(p.id, req.userId));
  });

  app.delete('/api/stickers/packs/:id', (req, res) => {
    const p = requirePack(req.params.id, req.userId, true);
    db.prepare('DELETE FROM sticker_packs WHERE id = ?').run(p.id);
    res.json({ ok: true });
  });

  app.post('/api/stickers/packs/:id/stickers', (req, res) => {
    const p = requirePack(req.params.id, req.userId, true);
    const fileId = String(req.body?.fileId ?? '');
    const f = db.prepare('SELECT owner_id, mime FROM files WHERE id = ?').get(fileId);
    if (!f || f.owner_id !== req.userId || !f.mime.startsWith('image/')) throw new HttpError(400, 'bad_file', 'Нужна картинка, загруженная вами');
    const count = db.prepare('SELECT COUNT(*) AS n FROM stickers WHERE pack_id = ?').get(p.id).n;
    if (count >= MAX_STICKERS) throw new HttpError(400, 'pack_full', `В наборе может быть до ${MAX_STICKERS} стикеров`);
    db.prepare('INSERT INTO stickers (id, pack_id, file_id, emoji, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), p.id, fileId, String(req.body?.emoji ?? '').slice(0, 16), count, now());
    res.status(201).json(packView(p.id, req.userId));
  });

  app.delete('/api/stickers/packs/:id/stickers/:sid', (req, res) => {
    const p = requirePack(req.params.id, req.userId, true);
    db.prepare('DELETE FROM stickers WHERE id = ? AND pack_id = ?').run(String(req.params.sid), p.id);
    res.json(packView(p.id, req.userId));
  });

  // Добавить чужой набор к себе или убрать его из своего списка.
  app.put('/api/stickers/packs/:id/added', (req, res) => {
    const p = requirePack(req.params.id, req.userId);
    db.prepare('INSERT OR IGNORE INTO user_sticker_packs (user_id, pack_id, added_at) VALUES (?, ?, ?)').run(req.userId, p.id, now());
    res.json(packView(p.id, req.userId));
  });

  app.delete('/api/stickers/packs/:id/added', (req, res) => {
    const p = requirePack(req.params.id, req.userId);
    db.prepare('DELETE FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?').run(req.userId, p.id);
    res.json(packView(p.id, req.userId));
  });

  // ---------- badges ----------

  const allBadges = () => db.prepare('SELECT id, emoji, title, description, color FROM badges ORDER BY created_at').all();

  app.get('/api/badges', (_req, res) => res.json(allBadges()));

  // Администратор может выложить свою сборку приложения — её получат все телефоны.
  const apkUpload = multer({ dest: updatesDir, limits: { fileSize: 300 * 1024 * 1024 } });
  app.post('/api/admin/app', adminOnly, apkUpload.single('apk'), (req, res) => {
    if (!req.file) throw new HttpError(400, 'no_file', 'Файл APK не получен');
    const versionCode = Number(req.body?.versionCode);
    if (!Number.isInteger(versionCode) || versionCode < 1 || !req.body?.versionName) {
      fs.rmSync(req.file.path, { force: true });
      throw new HttpError(400, 'bad_version', 'Укажите versionCode (число) и versionName');
    }
    res.json(saveUpdate(req.file.path, { versionCode, versionName: req.body.versionName, notes: req.body.notes }));
  });

  app.post('/api/admin/app/sync', adminOnly, async (_req, res, next) => {
    try {
      res.json({ updated: await syncUpdate(), current: readUpdateInfo() });
    } catch (e) {
      next(new HttpError(502, 'sync_failed', `Не удалось забрать сборку: ${e.message}`));
    }
  });

  app.post('/api/admin/badges', adminOnly, (req, res) => {
    const { emoji, title, description = '', color = '#6750A4' } = req.body ?? {};
    if (!emoji || !title) throw new HttpError(400, 'bad_badge', 'Нужны эмодзи и название');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, 'bad_color', 'Цвет в формате #RRGGBB');
    const id = newId();
    db.prepare('INSERT INTO badges (id, emoji, title, description, color, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, String(emoji).slice(0, 16), String(title).slice(0, 40), String(description).slice(0, 200), color, req.userId, now());
    res.status(201).json(allBadges().find((b) => b.id === id));
  });

  app.delete('/api/admin/badges/:id', adminOnly, (req, res) => {
    const holders = db.prepare('SELECT user_id FROM user_badges WHERE badge_id = ?').all(req.params.id).map((r) => r.user_id);
    db.prepare('DELETE FROM badges WHERE id = ?').run(req.params.id);
    for (const id of holders) hub.broadcastUser(id, { type: 'user.updated', user: getUser(id) });
    res.json({ ok: true });
  });

  app.put('/api/admin/users/:id/badges/:badgeId', adminOnly, (req, res) => {
    if (!getUserRow.get(req.params.id)) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    if (!db.prepare('SELECT 1 FROM badges WHERE id = ?').get(req.params.badgeId)) {
      throw new HttpError(404, 'badge_not_found', 'Бейдж не найден');
    }
    db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, granted_by, granted_at) VALUES (?, ?, ?, ?)')
      .run(req.params.id, req.params.badgeId, req.userId, now());
    const u = getUser(req.params.id);
    hub.broadcastUser(u.id, { type: 'user.updated', user: u });
    res.json(u);
  });

  app.delete('/api/admin/users/:id/badges/:badgeId', adminOnly, (req, res) => {
    db.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?').run(req.params.id, req.params.badgeId);
    const u = getUser(req.params.id);
    if (u) hub.broadcastUser(u.id, { type: 'user.updated', user: u });
    res.json(u);
  });

  app.put('/api/admin/users/:id/premium', adminOnly, (req, res) => {
    db.prepare('UPDATE users SET is_premium = ? WHERE id = ?').run(req.body?.isPremium ? 1 : 0, req.params.id);
    const u = getUser(req.params.id);
    if (!u) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    hub.broadcastUser(u.id, { type: 'user.updated', user: u });
    res.json(u);
  });

  // ---------- FLUX, подарки и Премиум ----------

  /** Меняет баланс и пишет запись в историю. Вызывать внутри транзакции. Не уходит в минус. */
  function moveFlux(userId, amount, kind, note = '') {
    const row = getUserRow.get(userId);
    if (!row) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    if (row.flux + amount < 0) throw new HttpError(402, 'need_flux', `Не хватает FLUX: нужно ${-amount}, у вас ${row.flux}`);
    db.prepare('UPDATE users SET flux = flux + ? WHERE id = ?').run(amount, userId);
    db.prepare('INSERT INTO flux_tx (id, user_id, amount, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), userId, amount, kind, String(note).slice(0, 200), now());
  }
  const pushMe = (userId) => hub.sendToUsers([userId], { type: 'user.updated', user: getUser(userId) });

  const PREMIUM_MONTH_FLUX = Number(process.env.PREMIUM_MONTH_FLUX ?? 1000);
  const MONTH_MS = 30 * 86_400_000;

  app.get('/api/flux', (req, res) => {
    const history = db.prepare('SELECT id, amount, kind, note, created_at AS createdAt FROM flux_tx WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.userId);
    res.json({ balance: getUserRow.get(req.userId).flux, premiumMonthPrice: PREMIUM_MONTH_FLUX, history });
  });

  app.post('/api/premium/buy', (req, res) => {
    const months = Math.max(1, Math.min(12, Math.floor(Number(req.body?.months ?? 1)) || 1));
    tx(db, () => {
      const row = getUserRow.get(req.userId);
      if (row.is_premium) throw new HttpError(400, 'already_premium', 'У вас уже бессрочный Премиум');
      moveFlux(req.userId, -PREMIUM_MONTH_FLUX * months, 'premium', `Премиум на ${months} мес.`);
      const from = Math.max(now(), row.premium_until ?? 0);
      db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(from + months * MONTH_MS, req.userId);
    });
    hub.broadcastUser(req.userId, { type: 'user.updated', user: getUser(req.userId) });
    res.json(meView(req.userId));
  });

  function giftItemView(it) {
    return {
      id: it.id, title: it.title, description: it.description, fileId: it.file_id, price: it.price,
      kind: it.kind ?? 'nft', emoji: it.emoji ?? null, caption: it.caption ?? '', animation: it.animation ?? 'none',
      supply: it.supply ?? null, sold: it.sold, left: it.supply == null ? null : Math.max(0, it.supply - it.sold), active: !!it.active,
    };
  }
  const giftItemRow = db.prepare('SELECT * FROM gift_items WHERE id = ?');

  function giftView(g) {
    const it = giftItemRow.get(g.item_id);
    return {
      id: g.id, serial: g.serial, item: it ? giftItemView(it) : null, ownerId: g.owner_id,
      from: g.from_user_id ? getUser(g.from_user_id) : null, message: g.message, hidden: !!g.hidden, createdAt: g.created_at,
    };
  }

  // Встроенные подарки-эмодзи. Создаются один раз; админ может поменять цену или выключить.
  const EMOJI_GIFTS = [
    ['🧸', 'Мишка', 15, 'bounce'], ['🌹', 'Роза', 25, 'sway'], ['💝', 'Сердце', 50, 'pulse'], ['🎂', 'Торт', 50, 'bounce'],
    ['💐', 'Букет', 75, 'sway'], ['🍾', 'Шампанское', 100, 'shake'], ['🎁', 'Сюрприз', 100, 'shake'], ['🏆', 'Кубок', 150, 'shine'],
    ['💎', 'Алмаз', 250, 'spin'], ['🚀', 'Ракета', 300, 'float'], ['💍', 'Кольцо', 500, 'shine'], ['👑', 'Корона', 1000, 'shine'],
  ];
  for (const [emoji, title, price, animation] of EMOJI_GIFTS) {
    if (!db.prepare("SELECT 1 FROM gift_items WHERE kind = 'emoji' AND emoji = ?").get(emoji)) {
      db.prepare(`INSERT INTO gift_items (id, title, description, file_id, price, supply, created_by, created_at, kind, emoji, animation)
        VALUES (?, ?, '', '', ?, NULL, ?, ?, 'emoji', ?, ?)`).run(newId(), title, price, SYSTEM_ID, now(), emoji, animation);
    }
  }
  const GIFT_ANIMATIONS = new Set(['none', 'bounce', 'pulse', 'sway', 'shake', 'spin', 'float', 'shine']);

  app.get('/api/gifts/shop', (_req, res) => {
    res.json(db.prepare("SELECT * FROM gift_items WHERE active = 1 ORDER BY kind = 'nft', price, created_at").all().map(giftItemView));
  });

  /** Покупка подарка себе или в подарок другому. */
  app.post('/api/gifts/buy', (req, res) => {
    requireNotRestricted(req.userId);
    const item = giftItemRow.get(String(req.body?.itemId ?? ''));
    if (!item || !item.active) throw new HttpError(404, 'gift_not_found', 'Подарок не найден');
    const to = req.body?.toUserId ? String(req.body.toUserId) : req.userId;
    const toRow = getUserRow.get(to);
    if (!toRow || to === SYSTEM_ID) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    if (to !== req.userId && isBlocked(to, req.userId)) throw new HttpError(403, 'blocked', 'Пользователь ограничил отправку вам сообщений');
    const message = String(req.body?.message ?? '').trim().slice(0, 200);
    const id = newId();
    tx(db, () => {
      const fresh = giftItemRow.get(item.id);
      if (fresh.supply != null && fresh.sold >= fresh.supply) throw new HttpError(409, 'sold_out', 'Этот подарок закончился');
      moveFlux(req.userId, -fresh.price, 'gift', to === req.userId ? `Подарок «${fresh.title}»` : `Подарок «${fresh.title}» для @${toRow.username}`);
      db.prepare('UPDATE gift_items SET sold = sold + 1 WHERE id = ?').run(fresh.id);
      db.prepare('INSERT INTO gifts (id, item_id, serial, owner_id, from_user_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, fresh.id, fresh.sold + 1, to, to === req.userId ? null : req.userId, message, now());
    });
    if (to !== req.userId) postGiftMessage(req.userId, to, id);
    pushMe(req.userId);
    res.status(201).json(giftView(db.prepare('SELECT * FROM gifts WHERE id = ?').get(id)));
  });

  app.get('/api/users/:id/gifts', (req, res) => {
    const own = req.params.id === req.userId;
    const rows = db.prepare(`SELECT * FROM gifts WHERE owner_id = ? ${own ? '' : 'AND hidden = 0'} ORDER BY created_at DESC`).all(req.params.id);
    res.json(rows.map(giftView));
  });

  function ownGift(req) {
    const g = db.prepare('SELECT * FROM gifts WHERE id = ?').get(String(req.params.id));
    if (!g || g.owner_id !== req.userId) throw new HttpError(404, 'gift_not_found', 'Подарок не найден');
    return g;
  }

  // Передать свой подарок (NFT) другому человеку.
  app.post('/api/gifts/:id/transfer', (req, res) => {
    const g = ownGift(req);
    const to = getUserRow.get(String(req.body?.toUserId ?? ''));
    if (!to || to.id === SYSTEM_ID || to.id === req.userId) throw new HttpError(400, 'bad_user', 'Выберите, кому подарить');
    if (isBlocked(to.id, req.userId)) throw new HttpError(403, 'blocked', 'Пользователь ограничил отправку вам сообщений');
    const message = String(req.body?.message ?? '').trim().slice(0, 200);
    db.prepare('UPDATE gifts SET owner_id = ?, from_user_id = ?, message = ?, hidden = 0, created_at = ? WHERE id = ?').run(to.id, req.userId, message, now(), g.id);
    postGiftMessage(req.userId, to.id, g.id);
    res.json(giftView(db.prepare('SELECT * FROM gifts WHERE id = ?').get(g.id)));
  });

  app.patch('/api/gifts/:id', (req, res) => {
    const g = ownGift(req);
    if (req.body?.hidden !== undefined) db.prepare('UPDATE gifts SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, g.id);
    res.json(giftView(db.prepare('SELECT * FROM gifts WHERE id = ?').get(g.id)));
  });

  // Админ: выдать или списать FLUX.
  // Самообновление сервера: состояние и «обновить сейчас».
  app.get('/api/admin/server', adminOnly, (_req, res) => {
    const u = app.locals.selfUpdater;
    res.json({ version: serverVersion(), autoUpdate: process.env.AUTO_UPDATE !== 'off', supervised: process.env.RYZIK_SUPERVISED === '1', ...(u?.status ?? {}),
      uptimeSec: Math.round(process.uptime()), errors: recentErrors });
  });
  app.post('/api/admin/server/update', adminOnly, async (_req, res, next) => {
    try {
      const u = app.locals.selfUpdater;
      if (!u) throw new HttpError(400, 'no_updater', 'Самообновление недоступно');
      const version = await app.locals.applyServerUpdate();
      res.json({ updated: !!version, version: version ?? serverVersion(), latest: u.status.latest, restarting: !!version && process.env.RYZIK_SUPERVISED === '1' });
    } catch (e) {
      next(e instanceof HttpError ? e : new HttpError(502, 'update_failed', `Не удалось обновить: ${e.message}`));
    }
  });

  app.post('/api/admin/users/:id/flux', adminOnly, (req, res) => {
    const amount = Math.trunc(Number(req.body?.amount));
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000_000) throw new HttpError(400, 'bad_amount', 'Укажите количество FLUX');
    const row = getUserRow.get(req.params.id);
    if (!row || row.id === SYSTEM_ID) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    const note = String(req.body?.note ?? '').trim().slice(0, 200);
    tx(db, () => moveFlux(row.id, amount, 'admin', note || (amount > 0 ? 'Начисление от администрации' : 'Списание администрацией')));
    logModeration(req.userId, amount > 0 ? 'flux_grant' : 'flux_take', 'user', row.id, row.username, `${amount} FLUX` + (note ? `. ${note}` : ''));
    if (amount > 0) postInfo(row.id, `Вам начислено ${amount} FLUX` + (note ? `: ${note}` : '') + '.');
    pushMe(row.id);
    res.json(adminUserView(getUserRow.get(row.id)));
  });

  // Админ: «NFT-создатель» — подарок из картинки с ценой в FLUX и тиражом.
  app.get('/api/admin/gift-items', adminOnly, (_req, res) => {
    res.json(db.prepare('SELECT * FROM gift_items ORDER BY created_at DESC').all().map(giftItemView));
  });

  app.post('/api/admin/gift-items', adminOnly, (req, res) => {
    const title = String(req.body?.title ?? '').trim().slice(0, 64);
    const price = Math.floor(Number(req.body?.price));
    const supply = req.body?.supply ? Math.floor(Number(req.body.supply)) : null;
    const fileId = String(req.body?.fileId ?? '');
    const f = db.prepare('SELECT mime FROM files WHERE id = ?').get(fileId);
    if (!title) throw new HttpError(400, 'bad_title', 'Придумайте название');
    if (!Number.isFinite(price) || price < 1) throw new HttpError(400, 'bad_price', 'Цена — от 1 FLUX');
    if (supply !== null && !(supply > 0)) throw new HttpError(400, 'bad_supply', 'Тираж — положительное число или пусто');
    if (!f || !f.mime.startsWith('image/')) throw new HttpError(400, 'bad_file', 'Нужна картинка');
    const id = newId();
    const animation = GIFT_ANIMATIONS.has(req.body?.animation) ? req.body.animation : 'none';
    const caption = String(req.body?.caption ?? '').trim().slice(0, 40);
    db.prepare(`INSERT INTO gift_items (id, title, description, file_id, price, supply, created_by, created_at, kind, caption, animation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'nft', ?, ?)`)
      .run(id, title, String(req.body?.description ?? '').trim().slice(0, 300), fileId, price, supply, req.userId, now(), caption, animation);
    res.status(201).json(giftItemView(giftItemRow.get(id)));
  });

  app.patch('/api/admin/gift-items/:id', adminOnly, (req, res) => {
    const it = giftItemRow.get(String(req.params.id));
    if (!it) throw new HttpError(404, 'gift_not_found', 'Подарок не найден');
    if (req.body?.active !== undefined) db.prepare('UPDATE gift_items SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, it.id);
    if (req.body?.price !== undefined) {
      const p = Math.floor(Number(req.body.price));
      if (!(p >= 1)) throw new HttpError(400, 'bad_price', 'Цена — от 1 FLUX');
      db.prepare('UPDATE gift_items SET price = ? WHERE id = ?').run(p, it.id);
    }
    res.json(giftItemView(giftItemRow.get(it.id)));
  });

  // ---------- модерация ----------

  function logModeration(adminId, action, targetType, targetId, targetName, reason = '', until = null) {
    db.prepare(`INSERT INTO moderation_log (id, admin_id, action, target_type, target_id, target_name, reason, until, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId(), adminId, action, targetType, targetId, String(targetName ?? ''), String(reason ?? ''), until, now());
  }

  /** Срок из запроса: days > 0 — на столько дней, иначе навсегда. */
  function untilFrom(body) {
    const days = Number(body?.days ?? 0);
    return Number.isFinite(days) && days > 0 ? now() + Math.round(days * 86_400_000) : FOREVER;
  }

  function adminUserView(row) {
    return {
      ...publicUser(row),
      bannedUntil: isBannedRow(row) ? row.banned_until : null,
      banReason: isBannedRow(row) ? row.ban_reason ?? '' : '',
      restrictedUntil: isRestrictedRow(row) ? row.restricted_until : null,
      restrictReason: isRestrictedRow(row) ? row.restrict_reason ?? '' : '',
      flux: row.flux ?? 0,
      createdAt: row.created_at,
    };
  }

  function moderatedTarget(req) {
    const row = getUserRow.get(req.params.id);
    if (!row || row.id === SYSTEM_ID) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    if (row.id === req.userId) throw new HttpError(400, 'self', 'Нельзя применить это к себе');
    if (row.is_admin) throw new HttpError(400, 'is_admin', 'Сначала снимите с пользователя права администратора');
    return row;
  }

  // Поиск пользователей для модерации; без q — заблокированные и ограниченные.
  app.get('/api/admin/users', adminOnly, (req, res) => {
    const q = String(req.query.q ?? '').trim().replace(/^@/, '');
    const rows = q
      ? db.prepare(`SELECT * FROM users WHERE id != ? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\') ORDER BY username LIMIT 50`)
        .all(SYSTEM_ID, `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`, `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`)
      : db.prepare('SELECT * FROM users WHERE banned_until IS NOT NULL OR restricted_until IS NOT NULL ORDER BY username LIMIT 200').all()
        .filter((r) => isBannedRow(r) || isRestrictedRow(r));
    res.json(rows.map(adminUserView));
  });

  app.post('/api/admin/users/:id/ban', adminOnly, (req, res) => {
    const row = moderatedTarget(req);
    const until = untilFrom(req.body);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    db.prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?').run(until, reason, row.id);
    // Выкидываем из всех сеансов.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    hub.disconnectUser(row.id);
    logModeration(req.userId, 'ban', 'user', row.id, row.username, reason, until);
    res.json(adminUserView(getUserRow.get(row.id)));
  });

  app.delete('/api/admin/users/:id/ban', adminOnly, (req, res) => {
    const row = getUserRow.get(req.params.id);
    if (!row) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    db.prepare('UPDATE users SET banned_until = NULL, ban_reason = NULL WHERE id = ?').run(row.id);
    logModeration(req.userId, 'unban', 'user', row.id, row.username);
    postInfo(row.id, 'Ваш аккаунт разблокирован. Пожалуйста, соблюдайте правила RyzikChat.');
    res.json(adminUserView(getUserRow.get(row.id)));
  });

  app.post('/api/admin/users/:id/restrict', adminOnly, (req, res) => {
    const row = moderatedTarget(req);
    const until = untilFrom(req.body);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    db.prepare('UPDATE users SET restricted_until = ?, restrict_reason = ? WHERE id = ?').run(until, reason, row.id);
    logModeration(req.userId, 'restrict', 'user', row.id, row.username, reason, until);
    postInfo(row.id, `Ваш аккаунт ограничен ${untilText(until)}: вы можете читать чаты, но не можете писать, создавать группы и каналы и загружать файлы.` +
      (reason ? `\n\nПричина: ${reason}` : ''));
    hub.sendToUsers([row.id], { type: 'user.updated', user: meView(row.id) });
    res.json(adminUserView(getUserRow.get(row.id)));
  });

  app.delete('/api/admin/users/:id/restrict', adminOnly, (req, res) => {
    const row = getUserRow.get(req.params.id);
    if (!row) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    db.prepare('UPDATE users SET restricted_until = NULL, restrict_reason = NULL WHERE id = ?').run(row.id);
    logModeration(req.userId, 'unrestrict', 'user', row.id, row.username);
    postInfo(row.id, 'Ограничения с вашего аккаунта сняты.');
    hub.sendToUsers([row.id], { type: 'user.updated', user: meView(row.id) });
    res.json(adminUserView(getUserRow.get(row.id)));
  });

  function adminChatView(chat) {
    const owner = db.prepare("SELECT user_id FROM chat_members WHERE chat_id = ? AND role = 'owner'").get(chat.id);
    return {
      id: chat.id, type: chat.type, title: chat.title, description: chat.description ?? '',
      avatarFileId: chat.avatar_file_id ?? null, isPublic: !!chat.is_public,
      banned: !!chat.banned, banReason: chat.ban_reason ?? '',
      verified: !!chat.verified, username: chat.username ?? null,
      memberCount: memberCountStmt.get(chat.id).n,
      owner: owner ? getUser(owner.user_id) : null,
      createdAt: chat.created_at,
    };
  }

  function moderatedChat(id) {
    const chat = getChatRow.get(String(id));
    if (!chat || !['group', 'channel'].includes(chat.type) || chat.created_by === SYSTEM_ID) {
      throw new HttpError(404, 'chat_not_found', 'Группа или канал не найдены');
    }
    return chat;
  }

  // Поиск групп и каналов (и частных тоже); без q — заблокированные.
  app.get('/api/admin/chats', adminOnly, (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const rows = q
      ? db.prepare(`SELECT * FROM chats WHERE type IN ('group', 'channel') AND created_by != ? AND (title LIKE ? ESCAPE '\\' OR id = ? OR lower(username) = lower(?)) ORDER BY created_at DESC LIMIT 50`).all(SYSTEM_ID, like, q, q.replace(/^@/, ''))
      : db.prepare("SELECT * FROM chats WHERE type IN ('group', 'channel') AND (banned = 1 OR verified = 1) ORDER BY created_at DESC LIMIT 200").all();
    res.json(rows.map(adminChatView));
  });

  app.post('/api/admin/chats/:id/ban', adminOnly, (req, res) => {
    const chat = moderatedChat(req.params.id);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    db.prepare('UPDATE chats SET banned = 1, ban_reason = ? WHERE id = ?').run(reason, chat.id);
    logModeration(req.userId, 'ban', chat.type, chat.id, chat.title, reason);
    broadcastChat(chat.id, { type: 'chat.updated', chatId: chat.id });
    res.json(adminChatView(getChatRow.get(chat.id)));
  });

  app.delete('/api/admin/chats/:id/ban', adminOnly, (req, res) => {
    const chat = moderatedChat(req.params.id);
    db.prepare('UPDATE chats SET banned = 0, ban_reason = NULL WHERE id = ?').run(chat.id);
    logModeration(req.userId, 'unban', chat.type, chat.id, chat.title);
    broadcastChat(chat.id, { type: 'chat.updated', chatId: chat.id });
    res.json(adminChatView(getChatRow.get(chat.id)));
  });

  app.delete('/api/admin/chats/:id', adminOnly, (req, res) => {
    const chat = moderatedChat(req.params.id);
    const members = memberIds(chat.id);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    db.prepare('UPDATE chats SET discussion_id = NULL WHERE discussion_id = ?').run(chat.id);
    db.prepare('DELETE FROM chats WHERE id = ?').run(chat.id);
    logModeration(req.userId, 'delete', chat.type, chat.id, chat.title, reason);
    hub.sendToUsers(members, { type: 'chat.removed', chatId: chat.id });
    res.json({ ok: true });
  });

  app.get('/api/admin/log', adminOnly, (_req, res) => {
    const rows = db.prepare('SELECT * FROM moderation_log ORDER BY created_at DESC LIMIT 200').all();
    res.json(rows.map((r) => ({
      id: r.id, action: r.action, targetType: r.target_type, targetId: r.target_id, targetName: r.target_name,
      reason: r.reason, until: r.until, createdAt: r.created_at, admin: getUser(r.admin_id),
    })));
  });

  // ---------- звонки ----------
  // Сам звонок идёт напрямую между устройствами (WebRTC, шифрование DTLS-SRTP),
  // сервер только передаёт сигналы через WebSocket и раздаёт адреса STUN/TURN.

  app.get('/api/calls/config', (_req, res) => {
    const iceServers = [{ urls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',') }];
    if (process.env.TURN_URL) {
      iceServers.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER ?? '', credential: process.env.TURN_PASS ?? '' });
    }
    res.json({ iceServers });
  });

  // Галочка верификации.
  app.put('/api/admin/users/:id/verified', adminOnly, (req, res) => {
    const row = getUserRow.get(req.params.id);
    if (!row || row.id === SYSTEM_ID) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    const on = !!req.body?.verified;
    db.prepare('UPDATE users SET verified = ? WHERE id = ?').run(on ? 1 : 0, row.id);
    logModeration(req.userId, on ? 'verify' : 'unverify', 'user', row.id, row.username);
    if (on) postInfo(row.id, 'Ваш аккаунт верифицирован ✅ Рядом с именем теперь видна галочка.');
    const u = getUser(row.id);
    hub.broadcastUser(u.id, { type: 'user.updated', user: u });
    res.json(adminUserView(getUserRow.get(row.id)));
  });

  app.put('/api/admin/chats/:id/verified', adminOnly, (req, res) => {
    const chat = moderatedChat(req.params.id);
    const on = !!req.body?.verified;
    db.prepare('UPDATE chats SET verified = ? WHERE id = ?').run(on ? 1 : 0, chat.id);
    logModeration(req.userId, on ? 'verify' : 'unverify', chat.type, chat.id, chat.title);
    broadcastChat(chat.id, { type: 'chat.updated', chatId: chat.id });
    res.json(adminChatView(getChatRow.get(chat.id)));
  });

  app.put('/api/admin/users/:id/admin', adminOnly, (req, res) => {
    if (req.params.id === req.userId && !req.body?.isAdmin) {
      throw new HttpError(400, 'self_demote', 'Нельзя снять права с самого себя');
    }
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body?.isAdmin ? 1 : 0, req.params.id);
    const u = getUser(req.params.id);
    if (!u) throw new HttpError(404, 'user_not_found', 'Пользователь не найден');
    hub.broadcastUser(u.id, { type: 'user.updated', user: u });
    res.json(u);
  });

  // ---------- errors ----------

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Нет такого метода')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (res.headersSent) return res.end();
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Некорректный JSON' });
    if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'too_large', message: 'Слишком большой запрос или файл' });
    if (err?.code?.startsWith?.('LIMIT_')) return res.status(400).json({ error: 'bad_upload', message: 'Неверная загрузка файла' });
    // Ошибки express и body-parser с кодом 4xx (например, неверная кодировка) — это ошибки запроса.
    const status = Number(err?.status ?? err?.statusCode);
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request', message: 'Неверный запрос' });
    const ref = crypto.randomBytes(3).toString('hex');
    console.error(`[${ref}] ${req.method} ${req.originalUrl.split('?')[0]}:`, err);
    recentErrors.unshift({ ref, at: now(), method: req.method, path: req.originalUrl.split('?')[0], error: String(err?.stack ?? err).split('\n').slice(0, 3).join(' ').slice(0, 400) });
    recentErrors.length = Math.min(recentErrors.length, 30);
    res.status(500).json({ error: 'internal', message: `Ошибка сервера (код ${ref}). Мы уже знаем о ней.` });
  });

  // Нужен realtime.js, чтобы собирать события про чат.
  app.locals.memberIds = memberIds;
  app.locals.sharedChatPeers = (userId) => db.prepare(`SELECT DISTINCT m2.user_id FROM chat_members m1
      JOIN chat_members m2 ON m1.chat_id = m2.chat_id WHERE m1.user_id = ?`).all(userId).map((r) => r.user_id);
  app.locals.resolveToken = (token) => sessionStmt.get(String(token))?.user_id ?? null;
  app.locals.isMember = (chatId, userId) => !!membershipStmt.get(chatId, userId);
  app.locals.isBlocked = (userId, byWhom) => isBlocked(byWhom, userId);
  /** Может ли `from` позвонить `to` по настройке «Кто может мне звонить». */
  app.locals.canCall = (from, to) => {
    const row = getUserRow.get(to);
    if (!row) return false;
    if (row.call_privacy === 'nobody') return false;
    if (row.call_privacy === 'contacts') return !!contactStmt.get(to, from);
    return true;
  };
  app.locals.touchLastSeen = (userId) => db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), userId);

  return app;
}
