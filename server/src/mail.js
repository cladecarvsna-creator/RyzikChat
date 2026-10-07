import net from 'node:net';
import tls from 'node:tls';

/**
 * Простая отправка писем по SMTP без сторонних библиотек.
 * Настройка через переменные окружения:
 *   SMTP_HOST, SMTP_PORT (465 — сразу TLS, 587/25 — STARTTLS, если сервер умеет),
 *   SMTP_USER, SMTP_PASS, SMTP_FROM (по умолчанию = SMTP_USER).
 * Например, Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=you@gmail.com SMTP_PASS=<пароль приложения>.
 */
export function mailConfigFromEnv(env = process.env) {
  if (!env.SMTP_HOST) return null;
  return {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 465),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.SMTP_FROM || env.SMTP_USER || 'ryzikchat@localhost',
  };
}

/** Читает ответы SMTP-сервера построчно (многострочные ответы — «250-…», последний — «250 …»). */
function replies(socket) {
  let buf = '';
  const waiting = [];
  const ready = [];
  let current = [];
  const onData = (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      current.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: current };
        current = [];
        if (waiting.length) waiting.shift().resolve(reply); else ready.push(reply);
      }
    }
  };
  const onError = (e) => { while (waiting.length) waiting.shift().reject(e); };
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', () => onError(new Error('SMTP: соединение закрыто')));
  return {
    next: () => (ready.length ? Promise.resolve(ready.shift()) : new Promise((resolve, reject) => waiting.push({ resolve, reject }))),
    detach: () => { socket.off('data', onData); socket.off('error', onError); },
  };
}

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const s = cfg.port === 465
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => resolve(s))
      : net.connect({ host: cfg.host, port: cfg.port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(20_000, () => s.destroy(new Error('SMTP: нет ответа')));
  });
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export async function sendMail(cfg, { to, subject, text }) {
  let socket = await connect(cfg);
  let r = replies(socket);
  const cmd = async (line, ok) => {
    if (line !== null) socket.write(line + '\r\n');
    const reply = await r.next();
    if (!ok.includes(reply.code)) throw new Error(`SMTP: ${reply.lines.join(' ')}`);
    return reply;
  };
  try {
    await cmd(null, [220]);
    let ehlo = await cmd('EHLO ryzikchat', [250]);
    if (cfg.port !== 465 && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
      await cmd('STARTTLS', [220]);
      r.detach();
      socket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: cfg.host }, () => resolve(t));
        t.once('error', reject);
      });
      r = replies(socket);
      ehlo = await cmd('EHLO ryzikchat', [250]);
    }
    if (cfg.user) {
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(cfg.user), [334]);
      await cmd(b64(cfg.pass), [235]);
    }
    const fromAddr = cfg.from.match(/<([^>]+)>/)?.[1] ?? cfg.from;
    await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const body = [
      `From: ${cfg.from.includes('<') ? cfg.from : `RyzikChat <${fromAddr}>`}`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      `Date: ${new Date().toUTCString()}`,
      '',
      b64(text).replace(/.{1,76}/g, '$&\r\n').trimEnd(),
      '.',
    ].join('\r\n');
    await cmd(body, [250]);
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}
