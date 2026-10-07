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

  const login = await api('POST', '/api/auth/login', { username: 'bob', password: 'x'.repeat(64) });
  assert.equal(login.status, 200);
  assert.equal(login.body.encryptedPrivateKey, 'enc-bob');
  assert.equal((await api('POST', '/api/auth/login', { username: 'bob', password: 'nope' })).status, 401);

  const chatsA = await api('GET', '/api/chats', null, a.body.token);
  assert.equal(chatsA.body.length, 1);
  assert.equal(chatsA.body[0].type, 'saved');

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
  const alice = await api('POST', '/api/auth/login', { username: 'alice', password: 'x'.repeat(64) });
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
  a.close(); b3.close();

  const cfg = await api('GET', '/api/calls/config', null, fan.body.token);
  assert.ok(cfg.body.iceServers.length >= 1);
  const spec = await fetch(base + '/api/openapi.json');
  assert.equal(spec.status, 200);
  assert.ok((await spec.json()).paths['/api/chats/channel']);
});
