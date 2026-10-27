// SD 체스 온라인 서버 (외부 패키지 없이 Node.js 만으로 동작)
//   실행:  node server.js          (기본 포트 8000, 환경변수 PORT 로 변경)
//   역할:  ① 게임 파일(정적 파일) 제공   ② 웹소켓으로 2명의 플레이어를 방 코드로 연결
//   규칙 검증/시계/기권/연결 끊김 처리는 모두 서버가 담당 (chess.js 규칙 엔진 재사용)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { newGame, legalMoves, apply, status } from './chess.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8000;
const TIME_MODES = [0, 60, 600];   // 초 (0 = 무제한) — 클라이언트와 동일
const BLOCKED = new Set(['server.js', 'package.json']);

// ───────── 정적 파일 ─────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
const httpServer = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT + path.sep) || BLOCKED.has(path.relative(ROOT, file))) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',   // 오디오 재생(특히 Safari)에 필요
      'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=86400',
    };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      end = Math.min(end, st.size - 1);
      if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    }
  });
});

// ───────── 최소 웹소켓 구현 (RFC 6455, 텍스트 메시지만 사용) ─────────
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 64 * 1024;
function frame(opcode, payload = Buffer.alloc(0)) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}
class Client {
  constructor(socket) { this.socket = socket; this.buf = Buffer.alloc(0); this.frag = null; this.alive = true; this.room = null; this.color = null; }
  send(obj) { if (this.alive) this.socket.write(frame(0x1, Buffer.from(JSON.stringify(obj)))); }
  close() { if (this.alive) { this.alive = false; try { this.socket.end(frame(0x8)); } catch {} } }
}
httpServer.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const c = new Client(socket);
  socket.on('data', (d) => { c.buf = Buffer.concat([c.buf, d]); try { parse(c); } catch { c.close(); } });
  const gone = () => { if (c.alive || c.room) { c.alive = false; onDisconnect(c); } };
  socket.on('close', gone); socket.on('error', gone);
});
function parse(c) {
  for (;;) {
    const b = c.buf; if (b.length < 2) return;
    const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > MAX_MSG) throw new Error('too big');
    if (!masked) throw new Error('unmasked');
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4);
    const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    c.buf = b.subarray(off + 4 + len);
    if (op === 0x8) { c.close(); return; }
    if (op === 0x9) { c.socket.write(frame(0xA, data)); continue; }   // ping → pong
    if (op === 0xA) continue;
    if (op === 0x1 || op === 0x0) {
      c.frag = op === 0x1 ? [data] : [...(c.frag || []), data];
      if (fin) { const text = Buffer.concat(c.frag).toString('utf8'); c.frag = null; handle(c, text); }
    }
  }
}
setInterval(() => { for (const r of rooms.values()) for (const p of r.players) if (p?.alive) p.socket.write(frame(0x9)); }, 25000);   // 프록시 연결 유지

// ───────── 방 / 게임 ─────────
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let s = ''; for (let i = 0; i < 4; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(s)) return s;
  }
}
const other = (c) => (c === 'w' ? 'b' : 'w');
const send = (r, obj) => r.players.forEach((p) => p?.send(obj));
const clockOf = (r) => (r.time ? { w: r.clock.w, b: r.clock.b } : null);
function settleClock(r, now = Date.now()) {   // 지금까지 흐른 시간을 차례인 쪽 시계에서 차감
  if (!r.time || !r.started || r.over) return;
  r.clock[r.state.turn] -= (now - r.stamp) / 1000; r.stamp = now;
}
function endRoom(r, result, winner) {
  if (r.over) return;
  settleClock(r); r.over = true;
  send(r, { t: 'over', result, winner, clock: clockOf(r) });
}
function onDisconnect(c) {
  const r = c.room; if (!r) return;
  c.room = null;
  const i = r.players.indexOf(c); if (i >= 0) r.players[i] = null;
  if (r.started && !r.over) endRoom(r, 'disconnect', other(c.color));   // 대국 중 이탈 → 남은 쪽 승리
  else if (!r.started) { r.players.forEach((p) => p?.close()); }       // 대기 중 방장이 나가면 방 삭제
  if (!r.players.some(Boolean)) rooms.delete(r.code);
}
function handle(c, text) {
  let m; try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m.t !== 'string') return;

  if (m.t === 'create') {
    if (c.room) return;
    const time = TIME_MODES.includes(m.time) ? m.time : 0;
    const hostColor = m.color === 'w' || m.color === 'b' ? m.color : (crypto.randomInt(2) ? 'w' : 'b');
    const code = newCode();
    const r = { code, time, hostColor, players: [null, null], state: null, clock: { w: time, b: time }, stamp: 0, started: false, over: false };
    r.players[hostColor === 'w' ? 0 : 1] = c; c.room = r; c.color = hostColor; rooms.set(code, r);
    c.send({ t: 'created', room: code, color: hostColor, time });
    return;
  }
  if (m.t === 'join') {
    if (c.room) return;
    const r = rooms.get(String(m.room || '').toUpperCase().trim());
    if (!r) return c.send({ t: 'error', msg: '방을 찾을 수 없습니다. 코드를 확인해 주세요.' });
    if (r.started || r.players.every(Boolean)) return c.send({ t: 'error', msg: '이미 가득 찬 방입니다.' });
    const color = other(r.hostColor);
    r.players[color === 'w' ? 0 : 1] = c; c.room = r; c.color = color;
    r.state = newGame(); r.started = true; r.stamp = Date.now();
    r.players.forEach((p) => p.send({ t: 'start', room: r.code, color: p.color, time: r.time, clock: clockOf(r) }));
    return;
  }

  const r = c.room; if (!r || !r.started || r.over) return;
  if (m.t === 'move') {
    if (r.state.turn !== c.color) return c.send({ t: 'reject', msg: '상대 차례입니다.' });
    const mv = legalMoves(r.state).find((x) => x.from === m.from && x.to === m.to && (x.promo || null) === (m.promo || null));
    if (!mv) return c.send({ t: 'reject', msg: '둘 수 없는 수입니다.' });
    settleClock(r);
    if (r.time && r.clock[c.color] <= 0) return endRoom(r, 'timeout', other(c.color));
    r.state = apply(r.state, mv); r.stamp = Date.now();
    send(r, { t: 'move', by: c.color, from: mv.from, to: mv.to, promo: mv.promo || null, clock: clockOf(r) });
    const st = status(r.state);
    if (st.over) endRoom(r, st.result, st.winner);
  } else if (m.t === 'resign') {
    endRoom(r, 'resign', other(c.color));
  }
}
// 시간 초과 감시
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.time || !r.started || r.over) continue;
    const side = r.state.turn;
    if (r.clock[side] - (Date.now() - r.stamp) / 1000 <= 0) endRoom(r, 'timeout', other(side));
  }
}, 250);

httpServer.listen(PORT, () => {
  console.log(`SD 체스 서버 실행 중:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`같은 Wi-Fi 기기에서 접속:  http://${i.address}:${PORT}`);
});
