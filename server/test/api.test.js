import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/index.js';

let srv, base, dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryzik-'));
  srv = await startServer({ port: 0, dataDir: dir });
  base = `http://127.0.0.1:${srv.port}`;
});
after(() => { srv.wss.close(); srv.server.closeAllConnections(); srv.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function api(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

let aliceToken;

const reg = (username) => api('POST', '/api/auth/register', {
  username, displayName: username.toUpperCase(), password: 'x'.repeat(64), publicKey: 'pk-' + username, encryptedPrivateKey: 'enc-' + username,
});

test('регистрация, чаты, сообщения, бейджи, websocket', async () => {
  const a = await reg('alice');
  assert.equal(a.status, 201);
  assert.equal(a.body.user.isAdmin, true, 'первый пользователь — администратор');
  const b = await reg('bob');
  assert.equal(b.body.user.isAdmin, false);
  assert.equal((await reg('Alice')).status, 409);

  aliceToken = a.body.token;
  // Без двухэтапной проверки вход сразу выдаёт токен, а в RyzikChat Info приходит уведомление о входе.
  const plain = await api('POST', '/api/auth/login', { username: 'bob', password: 'x'.repeat(64), device: 'Pixel' });
  assert.ok(plain.body.token);
  assert.equal(plain.body.encryptedPrivateKey, 'enc-bob');

  // Включаем двухэтапную проверку: нужен пароль от аккаунта.
  assert.equal((await api('PUT', '/api/me/2fa', { accountPassword: 'bad', password: 'tiger' }, b.body.token)).status, 403);
  const on = await api('PUT', '/api/me/2fa', { accountPassword: 'x'.repeat(64), password: 'tiger', hint: 'кот' }, b.body.token);
  assert.equal(on.body.has2fa, true);
  assert.equal(on.body.twofaHint, 'кот');
  const step1 = await api('POST', '/api/auth/login', { username: 'bob', password: 'x'.repeat(64), device: 'Pixel' });
  assert.equal(step1.body.need2fa, true);
  assert.equal(step1.body.hint, 'кот');
  assert.equal(step1.body.token, undefined);
  assert.equal((await api('POST', '/api/auth/login/2fa', { challengeId: step1.body.challengeId, password: 'lion' })).body.error, 'bad_2fa');
  const login = await api('POST', '/api/auth/login/2fa', { challengeId: step1.body.challengeId, password: 'tiger' });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  assert.equal((await api('POST', '/api/auth/login/2fa', { challengeId: step1.body.challengeId, password: 'tiger' })).status, 400, 'вход одноразовый');
  // Смена требует текущий пароль, выключение — тоже.
  assert.equal((await api('PUT', '/api/me/2fa', { accountPassword: 'x'.repeat(64), currentPassword: 'no', password: 'puma' }, b.body.token)).status, 403);
  assert.equal((await api('DELETE', '/api/me/2fa', { password: 'no' }, b.body.token)).status, 403);
  assert.equal((await api('DELETE', '/api/me/2fa', { password: 'tiger' }, b.body.token)).body.has2fa, false);
  assert.equal((await api('POST', '/api/auth/login', { username: 'bob', password: 'nope' })).status, 401);

  const chatsA = await api('GET', '/api/chats', null, a.body.token);
  // Избранное, RyzikChat Info и общая группа «RyzikChat (Обсуждение)».
  assert.deepEqual(chatsA.body.map((c) => c.type).sort(), ['channel', 'group', 'saved']);
  const discussion = chatsA.body.find((c) => c.type === 'group');
  assert.equal(discussion.title, 'RyzikChat (Обсуждение)');
  assert.ok(discussion.members.length >= 2, 'в общей группе все пользователи');
  assert.equal((await api('DELETE', `/api/chats/${discussion.id}/members/${a.body.user.id}`, null, a.body.token)).body.error, 'discussion_leave');
  const infoA = chatsA.body.find((c) => c.isService);
  assert.equal(infoA.title, 'RyzikChat Info');
  assert.equal(infoA.pinned, true);
  assert.equal((await api('DELETE', `/api/chats/${infoA.id}/members/${a.body.user.id}`, null, a.body.token)).status, 400);

  const found = await api('GET', '/api/users/search?q=bo', null, a.body.token);
  assert.equal(found.body[0].username, 'bob');

  // Bob слушает websocket
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${b.body.token}`);
  const events = [];
  ws.on('message', (d) => events.push(JSON.parse(String(d))));
  await new Promise((r) => ws.on('open', r));

  const direct = await api('POST', '/api/chats/direct', { userId: b.body.user.id }, a.body.token);
  assert.equal(direct.status, 201);
  const again = await api('POST', '/api/chats/direct', { userId: b.body.user.id }, a.body.token);
  assert.equal(again.body.id, direct.body.id);

  const sent = await api('POST', `/api/chats/${direct.body.id}/messages`, { type: 'text', payload: '{"ct":"..."}' }, a.body.token);
  assert.equal(sent.status, 201);
  assert.equal(sent.body.seq, 1);

  const chatsB = await api('GET', '/api/chats', null, b.body.token);
  const dB = chatsB.body.find((c) => c.id === direct.body.id);
  assert.equal(dB.unread, 1);

  await api('PUT', `/api/messages/${sent.body.id}/reaction`, { emoji: '🔥' }, b.body.token);
  const msgs = await api('GET', `/api/chats/${direct.body.id}/messages`, null, b.body.token);
  assert.deepEqual(msgs.body[0].reactions, [{ userId: b.body.user.id, emoji: '🔥' }]);

  // Bob не может удалить сообщение Alice
  assert.equal((await api('DELETE', `/api/messages/${sent.body.id}`, null, b.body.token)).status, 403);

  // Бейджи: только админ
  assert.equal((await api('POST', '/api/admin/badges', { emoji: '⭐', title: 'Звезда' }, b.body.token)).status, 403);
  const badge = await api('POST', '/api/admin/badges', { emoji: '⭐', title: 'Звезда', color: '#FFB300' }, a.body.token);
  assert.equal(badge.status, 201);
  const granted = await api('PUT', `/api/admin/users/${b.body.user.id}/badges/${badge.body.id}`, null, a.body.token);
  assert.equal(granted.body.badges[0].title, 'Звезда');

  await new Promise((r) => setTimeout(r, 100));
  const types = events.map((e) => e.type);
  assert.ok(types.includes('chat.new'));
  assert.ok(types.includes('message.new'));
  assert.ok(types.includes('user.updated'));
  ws.close();
});

test('каналы, премиум, сигналы звонков, документация API', async () => {
  const owner = await reg('chanowner');
  const fan = await reg('chanfan');
  const ch = await api('POST', '/api/chats/channel', { title: 'Новости Рыжика', description: 'Всё самое важное' }, owner.body.token);
  assert.equal(ch.status, 201);
  assert.equal(ch.body.type, 'channel');
  assert.equal(ch.body.myRole, 'owner');

  const found = await api('GET', '/api/channels/search?q=Рыжик', null, fan.body.token);
  assert.equal(found.body[0].id, ch.body.id);
  assert.equal(found.body[0].myRole, null);

  // Публичный @юзернейм: поиск, открытие по ссылке, занятость, освобождение при переходе в частный.
  assert.equal((await api('PATCH', `/api/chats/${ch.body.id}`, { username: 'ab' }, owner.body.token)).body.error, 'bad_username');
  assert.equal((await api('PATCH', `/api/chats/${ch.body.id}`, { username: 'chanfan' }, owner.body.token)).body.error, 'username_taken');
  assert.equal((await api('PATCH', `/api/chats/${ch.body.id}`, { username: 'ryzik_news' }, owner.body.token)).body.username, 'ryzik_news');
  assert.equal((await api('GET', '/api/channels/search?q=@ryzik_news', null, fan.body.token)).body[0].id, ch.body.id);
  assert.equal((await api('GET', '/api/chats/by-username/Ryzik_News', null, fan.body.token)).body.id, ch.body.id);
  assert.equal((await api('GET', '/api/chat-username-check?username=ryzik_news', null, fan.body.token)).body.ok, false);
  const grp = await api('POST', '/api/chats/group', { title: 'Клуб', username: 'ryzik_club' }, fan.body.token);
  assert.equal(grp.body.isPublic, true);
  assert.equal(grp.body.username, 'ryzik_club');
  assert.equal((await api('POST', '/api/chats/group', { title: 'Клуб 2', username: 'RYZIK_CLUB' }, owner.body.token)).body.error, 'username_taken');
  assert.equal((await api('POST', '/api/auth/register', { username: 'ryzik_club', password: 'x'.repeat(64), publicKey: 'k', encryptedPrivateKey: 'k' })).body.error, 'username_taken');
  await api('PATCH', `/api/chats/${grp.body.id}`, { isPublic: false }, fan.body.token);
  assert.equal((await api('GET', '/api/chat-username-check?username=ryzik_club', null, fan.body.token)).body.ok, true);

  const post = await api('POST', `/api/chats/${ch.body.id}/messages`, { type: 'text', payload: '{"v":0,"plain":{"text":"Привет"}}' }, owner.body.token);
  assert.equal(post.status, 201);
  // Не подписан, но читать публичный канал можно
  assert.equal((await api('GET', `/api/chats/${ch.body.id}/messages`, null, fan.body.token)).body.length, 1);

  const sub = await api('POST', `/api/chats/${ch.body.id}/subscribe`, null, fan.body.token);
  assert.equal(sub.body.myRole, 'subscriber');
  assert.equal(sub.body.memberCount, 2);
  assert.equal(sub.body.unread, 0);
  // Подписчик писать не может
  assert.equal((await api('POST', `/api/chats/${ch.body.id}/messages`, { type: 'text', payload: 'x' }, fan.body.token)).status, 403);
  // Отписка
  assert.equal((await api('DELETE', `/api/chats/${ch.body.id}/members/${fan.body.user.id}`, null, fan.body.token)).status, 200);
  assert.equal((await api('GET', '/api/chats', null, fan.body.token)).body.some((c) => c.id === ch.body.id), false);

  // Премиум выдаёт только админ (alice из первого теста)
  const alice = { body: { token: aliceToken } };
  assert.equal((await api('PUT', `/api/admin/users/${fan.body.user.id}/premium`, { isPremium: true }, fan.body.token)).status, 403);
  const prem = await api('PUT', `/api/admin/users/${fan.body.user.id}/premium`, { isPremium: true }, alice.body.token);
  assert.equal(prem.body.isPremium, true);

  // Сигналы звонка доходят только тем, с кем есть общий чат
  await api('POST', '/api/chats/direct', { userId: fan.body.user.id }, owner.body.token);
  const wsUrl = (t) => `${base.replace('http', 'ws')}/ws?token=${t}`;
  const a = new WebSocket(wsUrl(owner.body.token));
  const b = new WebSocket(wsUrl(fan.body.token));
  const got = [];
  b.on('message', (d) => got.push(JSON.parse(String(d))));
  await Promise.all([new Promise((r) => a.on('open', r)), new Promise((r) => b.on('open', r))]);
  a.send(JSON.stringify({ type: 'call.signal', to: fan.body.user.id, data: { kind: 'offer', callId: 'c1', sdp: 'v=0' } }));
  await new Promise((r) => setTimeout(r, 150));
  const sig = got.find((e) => e.type === 'call.signal');
  assert.equal(sig.from, owner.body.user.id);
  assert.equal(sig.data.kind, 'offer');
  // Собеседник принял — звонок больше не висит в очереди
  b.send(JSON.stringify({ type: 'call.signal', to: owner.body.user.id, data: { kind: 'answer', callId: 'c1', sdp: 'v=0' } }));
  b.close();
  await new Promise((r) => setTimeout(r, 150));

  // Собеседник не в сети: звонящий получает «waiting», а offer и ICE приходят, когда тот подключится
  const fromA = [];
  a.on('message', (d) => fromA.push(JSON.parse(String(d))));
  a.send(JSON.stringify({ type: 'call.signal', to: fan.body.user.id, data: { kind: 'offer', callId: 'c2', sdp: 'v=0' } }));
  a.send(JSON.stringify({ type: 'call.signal', to: fan.body.user.id, data: { kind: 'ice', callId: 'c2', candidate: 'x' } }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(fromA.find((e) => e.type === 'call.signal')?.data.kind, 'waiting');
  const late = [];
  const b2 = new WebSocket(wsUrl(fan.body.token));
  b2.on('message', (d) => late.push(JSON.parse(String(d))));
  await new Promise((r) => b2.on('open', r));
  await new Promise((r) => setTimeout(r, 150));
  const replay = late.filter((e) => e.type === 'call.signal').map((e) => e.data.kind);
  assert.deepEqual(replay, ['offer', 'ice']);
  a.send(JSON.stringify({ type: 'call.signal', to: fan.body.user.id, data: { kind: 'hangup', callId: 'c2' } }));
  await new Promise((r) => setTimeout(r, 100));
  b2.close();
  const b3 = new WebSocket(wsUrl(fan.body.token));
  const after = [];
  b3.on('message', (d) => after.push(JSON.parse(String(d))));
  await new Promise((r) => b3.on('open', r));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(after.filter((e) => e.type === 'call.signal').length, 0);
  b3.close();

  // «Кто может мне звонить»: никто — звонящий сразу получает forbidden, сигнал не доходит.
  await api('PATCH', '/api/me', { callPrivacy: 'nobody' }, fan.body.token);
  const fromA2 = [];
  a.on('message', (d) => fromA2.push(JSON.parse(String(d))));
  a.send(JSON.stringify({ type: 'call.signal', to: fan.body.user.id, data: { kind: 'offer', callId: 'c3', sdp: 'v=0' } }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(fromA2.find((e) => e.type === 'call.signal')?.data.kind, 'forbidden');
  // Только контакты: пока владелец не в контактах — нельзя, после добавления — можно.
  await api('PATCH', '/api/me', { callPrivacy: 'contacts' }, fan.body.token);
  assert.equal((await api('GET', '/api/me', null, fan.body.token)).body.callPrivacy, 'contacts');
  await api('PUT', `/api/contacts/${owner.body.user.id}`, null, fan.body.token);
  fromA2.length = 0;
  a.send(JSON.stringify({ type: 'call.signal', to: fan.body.user.id, data: { kind: 'offer', callId: 'c4', sdp: 'v=0' } }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(fromA2.find((e) => e.type === 'call.signal')?.data.kind, 'waiting');
  a.send(JSON.stringify({ type: 'call.signal', to: fan.body.user.id, data: { kind: 'hangup', callId: 'c4' } }));
  a.close();

  const cfg = await api('GET', '/api/calls/config', null, fan.body.token);
  assert.ok(cfg.body.iceServers.length >= 1);
  const spec = await fetch(base + '/api/openapi.json');
  assert.equal(spec.status, 200);
  assert.ok((await spec.json()).paths['/api/chats/channel']);
});

test('открытые и частные группы, приглашения, премиум-оформление', async () => {
  const o = (await reg('owner3')).body;
  const g = (await reg('guest3')).body;

  // Частная группа: не ищется и не открывается без ссылки.
  const priv = await api('POST', '/api/chats/group', { title: 'Тайная группа', memberIds: [], isPublic: false }, o.token);
  assert.equal(priv.status, 201);
  assert.equal(priv.body.isPublic, false);
  assert.ok(priv.body.inviteCode);
  assert.equal((await api('GET', '/api/chats/search?q=Тайная', null, g.token)).body.length, 0);
  assert.equal((await api('POST', `/api/chats/${priv.body.id}/subscribe`, null, g.token)).status, 404);
  const preview = await api('GET', `/api/invite/${priv.body.inviteCode}`, null, g.token);
  assert.equal(preview.body.title, 'Тайная группа');
  assert.equal(preview.body.myRole, null);
  const joined = await api('POST', `/api/invite/${priv.body.inviteCode}/join`, null, g.token);
  assert.equal(joined.body.myRole, 'member');
  assert.equal(joined.body.inviteCode, null, 'обычный участник частной группы не видит ссылку');

  // Сброс ссылки делает старую недействительной.
  const reset = await api('POST', `/api/chats/${priv.body.id}/invite/reset`, null, o.token);
  assert.notEqual(reset.body.inviteCode, priv.body.inviteCode);
  assert.equal((await api('GET', `/api/invite/${priv.body.inviteCode}`, null, g.token)).status, 404);

  // Открытая группа ищется и в неё можно вступить; аватарку можно поставить.
  const pub = await api('POST', '/api/chats/group', { title: 'Открытая группа', memberIds: [], isPublic: true }, o.token);
  const found = await api('GET', '/api/chats/search?q=Открытая', null, g.token);
  assert.equal(found.body[0].id, pub.body.id);
  assert.equal((await api('POST', `/api/chats/${pub.body.id}/subscribe`, null, g.token)).body.myRole, 'member');
  const av = await api('PATCH', `/api/chats/${pub.body.id}`, { avatarFileId: 'file-1', isPublic: false }, o.token);
  assert.equal(av.body.avatarFileId, 'file-1');
  assert.equal(av.body.isPublic, false);
  assert.equal((await api('PATCH', `/api/chats/${pub.body.id}`, { isPublic: true }, g.token)).status, 403);

  // Частный канал не читается посторонними.
  const ch = await api('POST', '/api/chats/channel', { title: 'Закрытый канал', isPublic: false }, o.token);
  assert.equal(ch.body.isPublic, false);
  assert.equal((await api('GET', `/api/chats/${ch.body.id}/messages`, null, g.token)).status, 404);

  // Эмодзи-статус и оформление профиля — только с Премиумом.
  const style = { color1: '#FF5CA8', color2: '#8E5CFF', pattern: '⭐', ring: 'gradient', junk: 'x', nameColor: 'red' };
  assert.equal((await api('PATCH', '/api/me', { emojiStatus: '🔥' }, g.token)).status, 403);
  const admin = { token: aliceToken };
  await api('PUT', `/api/admin/users/${g.user.id}/premium`, { isPremium: true }, admin.token);
  const me = await api('PATCH', '/api/me', { emojiStatus: '🔥', profileStyle: style }, g.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.emojiStatus, '🔥');
  assert.deepEqual(me.body.profileStyle, { color1: '#FF5CA8', color2: '#8E5CFF', pattern: '⭐', ring: 'gradient' });
});

test('контакты, блокировка, «в сети», почта', async () => {
  const p = (await reg('petya')).body;
  const v = (await reg('vasya')).body;
  const direct = (await api('POST', '/api/chats/direct', { userId: v.user.id }, p.token)).body;
  assert.equal(direct.peerIsContact, false);

  // Контакты
  assert.equal((await api('PUT', `/api/contacts/${v.user.id}`, null, p.token)).body.isContact, true);
  assert.deepEqual((await api('GET', '/api/contacts', null, p.token)).body.map((u) => u.username), ['vasya']);
  assert.equal((await api('GET', `/api/chats/${direct.id}`, null, p.token)).body.peerIsContact, true);

  // Блокировка: vasya больше не может писать petya
  assert.equal((await api('PUT', `/api/blocks/${v.user.id}`, null, p.token)).body.isBlocked, true);
  assert.equal((await api('GET', '/api/contacts', null, p.token)).body.length, 0, 'заблокированный убран из контактов');
  const sent = await api('POST', `/api/chats/${direct.id}/messages`, { type: 'text', payload: 'x' }, v.token);
  assert.equal(sent.body.error, 'blocked');
  await api('DELETE', `/api/blocks/${v.user.id}`, null, p.token);
  assert.equal((await api('POST', `/api/chats/${direct.id}/messages`, { type: 'text', payload: 'x' }, v.token)).status, 201);

  // «В сети» — только пока приложение открыто (фоновое соединение с active=0 не считается)
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${v.token}&active=0`);
  await new Promise((r) => ws.on('open', r));
  assert.equal((await api('GET', `/api/users/${v.user.id}`, null, p.token)).body.online, false);
  ws.send(JSON.stringify({ type: 'presence', active: true }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await api('GET', `/api/users/${v.user.id}`, null, p.token)).body.online, true);
  ws.send(JSON.stringify({ type: 'presence', active: false }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await api('GET', `/api/users/${v.user.id}`, null, p.token)).body.online, false);
  ws.close();

  // Служебного пользователя не найти поиском
  assert.equal((await api('GET', '/api/users/search?q=ryzikchat', null, p.token)).body.length, 0);
});

test('аватарки открываются без токена, остальные файлы — нет', async () => {
  const u = (await reg('avatarka')).body;
  const upload = async () => {
    const form = new FormData();
    form.append('mime', 'image/png');
    form.append('file', new Blob([Buffer.from('fake-png')]), 'blob');
    const res = await fetch(base + '/api/files', { method: 'POST', headers: { authorization: `Bearer ${u.token}` }, body: form });
    return (await res.json()).id;
  };
  const avatar = await upload();
  const secret = await upload();
  await api('PATCH', '/api/me', { avatarFileId: avatar }, u.token);
  const ok = await fetch(`${base}/api/avatars/${avatar}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal(await ok.text(), 'fake-png');
  assert.equal((await fetch(`${base}/api/avatars/${secret}`)).status, 404, 'не аватарку так не скачать');
  assert.equal((await fetch(`${base}/api/files/${secret}`)).status, 401);
});

async function uploadImage(token, body = 'img') {
  const form = new FormData();
  form.append('mime', 'image/png');
  form.append('file', new Blob([Buffer.from(body)]), 'blob');
  const res = await fetch(base + '/api/files', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return (await res.json()).id;
}

test('обои чата видят все участники', async () => {
  const x = (await reg('wallx')).body;
  const y = (await reg('wally')).body;
  const chat = (await api('POST', '/api/chats/direct', { userId: y.user.id }, x.token)).body;
  const pic = await uploadImage(x.token, 'wall');
  const set = await api('PUT', `/api/chats/${chat.id}/wallpaper`, { fileId: pic }, x.token);
  assert.equal(set.body.wallpaperFileId, pic);
  const seen = (await api('GET', '/api/chats', null, y.token)).body.find((c) => c.id === chat.id);
  assert.equal(seen.wallpaperFileId, pic, 'собеседник видит те же обои');
  assert.equal(await (await fetch(`${base}/api/avatars/${pic}`)).text(), 'wall');
  // Чужую картинку поставить нельзя.
  assert.equal((await api('PUT', `/api/chats/${chat.id}/wallpaper`, { fileId: pic }, y.token)).status, 400);
  assert.equal((await api('PUT', `/api/chats/${chat.id}/wallpaper`, { fileId: null }, y.token)).body.wallpaperFileId, null);
});

test('свои стикеры: набор, добавление, пересылка другу', async () => {
  const x = (await reg('stickx')).body;
  const y = (await reg('sticky')).body;
  const pack = (await api('POST', '/api/stickers/packs', { title: 'Котики' }, x.token)).body;
  assert.equal(pack.isMine, true);
  assert.equal(pack.isAdded, true);
  const pic = await uploadImage(x.token, 'cat');
  const withSticker = await api('POST', `/api/stickers/packs/${pack.id}/stickers`, { fileId: pic, emoji: '😺' }, x.token);
  assert.equal(withSticker.status, 201);
  assert.equal(withSticker.body.stickers.length, 1);
  assert.equal(await (await fetch(`${base}/api/avatars/${pic}`)).text(), 'cat', 'стикер открывается без токена');
  // Друг открывает набор по ссылке и добавляет себе, но менять его не может.
  const shared = (await api('GET', `/api/stickers/packs/${pack.id}`, null, y.token)).body;
  assert.equal(shared.isAdded, false);
  assert.equal((await api('PUT', `/api/stickers/packs/${pack.id}/added`, null, y.token)).body.isAdded, true);
  assert.deepEqual((await api('GET', '/api/stickers', null, y.token)).body.map((p) => p.title), ['Котики']);
  assert.equal((await api('POST', `/api/stickers/packs/${pack.id}/stickers`, { fileId: pic }, y.token)).status, 403);
  assert.equal((await api('DELETE', `/api/stickers/packs/${pack.id}/added`, null, y.token)).body.isAdded, false);
  const sid = withSticker.body.stickers[0].id;
  assert.equal((await api('DELETE', `/api/stickers/packs/${pack.id}/stickers/${sid}`, null, x.token)).body.stickers.length, 0);
});

test('обновления приложения раздаёт сам сервер', async () => {
  assert.equal((await fetch(`${base}/api/app/update`)).status, 404);
  const admin = (await api('POST', '/api/auth/login', { username: 'alice', password: 'x'.repeat(64) })).body.token;
  const form = new FormData();
  form.append('versionCode', '42');
  form.append('versionName', '9.9.9');
  form.append('notes', 'Новое');
  form.append('apk', new Blob([Buffer.from('apk-bytes')]), 'RyzikChat.apk');
  const up = await fetch(base + '/api/admin/app', { method: 'POST', headers: { authorization: `Bearer ${admin}` }, body: form });
  assert.equal(up.status, 200);
  const info = await (await fetch(`${base}/api/app/update`)).json();
  assert.equal(info.versionCode, 42);
  assert.equal(info.apk, '/api/app/apk');
  assert.equal(await (await fetch(base + info.apk)).text(), 'apk-bytes');
});

test('модерация: бан, ограничение, блокировка и удаление групп', async () => {
  const admin = (await api('POST', '/api/auth/login', { username: 'alice', password: 'x'.repeat(64) })).body.token;
  const bad = (await reg('troll')).body;
  const friend = (await reg('trollfriend')).body;
  // Не админ не может модерировать.
  assert.equal((await api('POST', `/api/admin/users/${friend.user.id}/ban`, {}, bad.token)).status, 403);

  // Ограничение: читать можно, писать нельзя.
  const dm = (await api('POST', '/api/chats/direct', { userId: friend.user.id }, bad.token)).body;
  const r1 = await api('POST', `/api/admin/users/${bad.user.id}/restrict`, { reason: 'спам', days: 1 }, admin);
  assert.ok(r1.body.restrictedUntil > Date.now());
  assert.equal((await api('GET', '/api/me', null, bad.token)).body.restrictReason, 'спам');
  const send = await api('POST', `/api/chats/${dm.id}/messages`, { type: 'text', payload: 'x' }, bad.token);
  assert.equal(send.status, 403);
  assert.equal(send.body.error, 'restricted');
  assert.equal((await api('POST', '/api/chats/group', { title: 'g' }, bad.token)).body.error, 'restricted');
  assert.equal((await api('GET', '/api/chats', null, bad.token)).status, 200);
  await api('DELETE', `/api/admin/users/${bad.user.id}/restrict`, null, admin);
  assert.equal((await api('POST', `/api/chats/${dm.id}/messages`, { type: 'text', payload: 'x' }, bad.token)).status, 201);

  // Бан: сеансы закрыты, войти нельзя, админа банить нельзя.
  assert.equal((await api('POST', `/api/admin/users/${(await api('GET', '/api/me', null, admin)).body.id}/ban`, {}, admin)).status, 400);
  const ban = await api('POST', `/api/admin/users/${bad.user.id}/ban`, { reason: 'оскорбления' }, admin);
  assert.ok(ban.body.isBanned);
  assert.equal((await api('GET', '/api/me', null, bad.token)).status, 401);
  const login = await api('POST', '/api/auth/login', { username: 'troll', password: 'x'.repeat(64) });
  assert.equal(login.body.error, 'banned');
  assert.match(login.body.message, /оскорбления/);
  assert.deepEqual((await api('GET', '/api/admin/users', null, admin)).body.map((u) => u.username), ['troll']);
  await api('DELETE', `/api/admin/users/${bad.user.id}/ban`, null, admin);
  assert.ok((await api('POST', '/api/auth/login', { username: 'troll', password: 'x'.repeat(64) })).body.token);

  // Блокировка канала: не ищется, не вступить, не написать. Потом удаление.
  const ch = (await api('POST', '/api/chats/channel', { title: 'Плохой канал', isPublic: true }, friend.token)).body;
  const b = await api('POST', `/api/admin/chats/${ch.id}/ban`, { reason: 'нарушения' }, admin);
  assert.equal(b.body.banned, true);
  assert.equal((await api('GET', '/api/channels/search?q=Плохой', null, admin)).body.length, 0);
  assert.equal((await api('POST', `/api/chats/${ch.id}/subscribe`, null, admin)).body.error, 'chat_banned');
  assert.equal((await api('POST', `/api/chats/${ch.id}/messages`, { type: 'text', payload: 'x' }, friend.token)).body.error, 'chat_banned');
  assert.equal((await api('GET', `/api/chats/${ch.id}`, null, friend.token)).body.banReason, 'нарушения');
  await api('DELETE', `/api/admin/chats/${ch.id}/ban`, null, admin);
  assert.equal((await api('POST', `/api/chats/${ch.id}/messages`, { type: 'text', payload: 'x' }, friend.token)).status, 201);
  assert.equal((await api('DELETE', `/api/admin/chats/${ch.id}`, null, admin)).status, 200);
  assert.equal((await api('GET', `/api/chats/${ch.id}`, null, friend.token)).status, 404);
  const log = (await api('GET', '/api/admin/log', null, admin)).body;
  assert.ok(log.some((l) => l.action === 'delete' && l.targetName === 'Плохой канал'));
});

test('FLUX: выдача, подарки (NFT), Премиум за FLUX, платные сообщения', async () => {
  const admin = (await api('POST', '/api/auth/login', { username: 'alice', password: 'x'.repeat(64) })).body.token;
  const x = (await reg('fluxx')).body;
  const y = (await reg('fluxy')).body;
  assert.equal((await api('GET', '/api/me', null, x.token)).body.flux, 0);
  assert.equal((await api('POST', `/api/admin/users/${x.user.id}/flux`, { amount: 1500, note: 'тест' }, x.token)).status, 403);
  assert.equal((await api('POST', `/api/admin/users/${x.user.id}/flux`, { amount: 1500, note: 'тест' }, admin)).body.flux, 1500);

  // NFT-создатель: картинка, цена, тираж 1.
  const pic = await uploadImage(admin, 'nft');
  const item = (await api('POST', '/api/admin/gift-items', { title: 'Рыжик', price: 300, supply: 1, fileId: pic }, admin)).body;
  assert.equal(item.left, 1);
  assert.equal(await (await fetch(`${base}/api/avatars/${pic}`)).text(), 'nft');
  const bought = await api('POST', '/api/gifts/buy', { itemId: item.id, toUserId: y.user.id, message: 'держи' }, x.token);
  assert.equal(bought.status, 201);
  assert.equal(bought.body.serial, 1);
  assert.equal((await api('POST', '/api/gifts/buy', { itemId: item.id }, x.token)).body.error, 'sold_out');
  const yGifts = (await api('GET', `/api/users/${y.user.id}/gifts`, null, x.token)).body;
  assert.equal(yGifts[0].from.username, 'fluxx');
  // На витрине есть встроенные подарки-эмодзи.
  const shop = (await api('GET', '/api/gifts/shop', null, x.token)).body;
  assert.ok(shop.some((g) => g.kind === 'emoji' && g.emoji === '🧸' && g.animation === 'bounce'));
  assert.equal(shop.find((g) => g.id === item.id)?.kind, 'nft');
  // Подарок виден в личном чате как сообщение от дарителя.
  const giftChat = (await api('POST', '/api/chats/direct', { userId: x.user.id }, y.token)).body;
  const giftMsgs = (await api('GET', `/api/chats/${giftChat.id}/messages`, null, y.token)).body;
  const gm = (giftMsgs.messages ?? giftMsgs).find((m) => m.type === 'gift');
  assert.ok(gm, 'сообщение о подарке в чате');
  assert.equal(gm.senderId, x.user.id);
  assert.equal(JSON.parse(gm.payload).plain.gift.title, 'Рыжик');
  // Y передаёт NFT обратно X.
  assert.equal((await api('POST', `/api/gifts/${yGifts[0].id}/transfer`, { toUserId: x.user.id }, y.token)).body.ownerId, x.user.id);
  assert.equal((await api('POST', `/api/gifts/${yGifts[0].id}/transfer`, { toUserId: x.user.id }, y.token)).status, 404);

  // Премиум за 1000 FLUX: остаток 1200 → 200.
  const prem = await api('POST', '/api/premium/buy', { months: 1 }, x.token);
  assert.equal(prem.body.isPremium, true);
  assert.equal(prem.body.flux, 200);
  assert.ok(prem.body.premiumUntil > Date.now());
  assert.equal((await api('POST', '/api/premium/buy', { months: 1 }, x.token)).body.error, 'need_flux');

  // Платные сообщения: Y берёт 150 FLUX за сообщение от незнакомцев.
  await api('PATCH', '/api/me', { messagePrice: 150 }, y.token);
  const dm = (await api('POST', '/api/chats/direct', { userId: y.user.id }, x.token)).body;
  assert.equal((await api('POST', `/api/chats/${dm.id}/messages`, { type: 'text', payload: 'a' }, x.token)).status, 201);
  assert.equal((await api('GET', '/api/me', null, y.token)).body.flux, 150);
  assert.equal((await api('POST', `/api/chats/${dm.id}/messages`, { type: 'text', payload: 'b' }, x.token)).body.error, 'need_flux');
  await api('PUT', `/api/contacts/${x.user.id}`, null, y.token);
  assert.equal((await api('POST', `/api/chats/${dm.id}/messages`, { type: 'text', payload: 'c' }, x.token)).status, 201, 'контактам бесплатно');
  const hist = (await api('GET', '/api/flux', null, x.token)).body;
  assert.deepEqual(hist.history.map((h) => h.kind), ['paid_message', 'premium', 'gift', 'admin']);
});
