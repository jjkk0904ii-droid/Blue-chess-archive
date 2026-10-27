import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CharacterFactory, createPiece } from './pieces.js';
import { newGame, legalMoves, apply, status, inCheck, bestMove, sqName } from './chess.js';

const $ = (id) => document.getElementById(id);
const posOf = (sq) => new THREE.Vector3((sq % 8) - 3.5, 0, 3.5 - Math.floor(sq / 8));

// ───────── 씬 ─────────
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfd8f6);
scene.fog = new THREE.Fog(0xcfd8f6, 18, 40);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 9.5, 10.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.3, 0); controls.enablePan = false;
controls.minDistance = 7; controls.maxDistance = 20; controls.maxPolarAngle = Math.PI * 0.46;
controls.enableDamping = true;
// 시점이 판 기준 85°~105°(수직에 가까운 각도)이면 손을 뗀 뒤 자동으로 90°(완전 위에서 내려다보기)로 맞춤
// 각도는 판 평면과 시선이 이루는 각 (90° = 정수직). OrbitControls 는 90° 를 넘길 수 없어 실질적으로 85°~90° 구간이 해당됨
const SNAP_MIN_DEG = 85, SNAP_MAX_DEG = 105, SNAP_PHI = 0.0001;
let camDragging = false;
controls.addEventListener('start', () => { camDragging = true; });
controls.addEventListener('end', () => { camDragging = false; });
const _snapOff = new THREE.Vector3(), _snapSph = new THREE.Spherical();
function snapTopDown(dt) {
  if (camDragging) return;
  _snapOff.copy(camera.position).sub(controls.target);
  _snapSph.setFromVector3(_snapOff);
  const elev = 90 - THREE.MathUtils.radToDeg(_snapSph.phi);   // 판 평면 기준 시선 각도
  if (elev < SNAP_MIN_DEG || elev > SNAP_MAX_DEG || _snapSph.phi <= SNAP_PHI * 1.5) return;
  _snapSph.phi += (SNAP_PHI - _snapSph.phi) * Math.min(1, dt * 12);   // 부드럽게 접근
  if (_snapSph.phi < SNAP_PHI * 1.5) _snapSph.phi = SNAP_PHI;
  _snapOff.setFromSpherical(_snapSph);
  camera.position.copy(controls.target).add(_snapOff);
}

scene.add(new THREE.HemisphereLight(0xffffff, 0xb9aed6, 2.1));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
sun.position.set(-5, 12, 6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// 보드
const boardGroup = new THREE.Group(); scene.add(boardGroup);
const tiles = [], hl = [], marks = [];
const frame = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 9), new THREE.MeshToonMaterial({ color: 0x5b4b8a }));
frame.position.y = -0.22; frame.receiveShadow = true; boardGroup.add(frame);
const tileGeo = new THREE.BoxGeometry(1, 0.2, 1), planeGeo = new THREE.PlaneGeometry(0.98, 0.98);
const ringGeo = new THREE.RingGeometry(0.36, 0.46, 32), dotGeo = new THREE.CircleGeometry(0.15, 24);
for (let sq = 0; sq < 64; sq++) {
  const light = ((sq % 8) + Math.floor(sq / 8)) % 2 === 1;
  const t = new THREE.Mesh(tileGeo, new THREE.MeshToonMaterial({ color: light ? 0xf6ecdc : 0x9a8fc7 }));
  t.position.copy(posOf(sq)); t.position.y = -0.1; t.receiveShadow = true; t.userData.sq = sq;
  boardGroup.add(t); tiles.push(t);
  const h = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  h.rotation.x = -Math.PI / 2; h.position.copy(posOf(sq)); h.position.y = 0.004; h.raycast = () => {};
  boardGroup.add(h); hl.push(h);
  const mk = new THREE.Group(); mk.position.copy(posOf(sq)); mk.position.y = 0.01; mk.visible = false;
  const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0x4d8bff, transparent: true, opacity: 0.8 }));
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  dot.rotation.x = ring.rotation.x = -Math.PI / 2; dot.raycast = ring.raycast = () => {};
  mk.add(dot, ring); mk.userData = { dot, ring }; boardGroup.add(mk); marks.push(mk);
}

// ───────── 게임 상태 ─────────
const chars = { P: new CharacterFactory(0.78), Q: new CharacterFactory(0.85), R: new CharacterFactory(0.82, 'Mouth_107'), B: new CharacterFactory(0.82, 'Mouth_300'), N: new CharacterFactory(0.82, 'Mouth_400'), bP: new CharacterFactory(0.78, 'Mouth_401', 'Formation_Pickup'), bN: new CharacterFactory(0.82, 'Mouth_401', 'Formation_Pickup'), bB: new CharacterFactory(0.82, 'Mouth_300', 'Tactical_Start'), bR: new CharacterFactory(0.82, 'Mouth_300', 'Formation_Pickup'), bQ: new CharacterFactory(0.85, 'Mouth_401', 'Formation_Pickup'), chaosW: new CharacterFactory(0.82, 'Mouth_100', 'Formation_Pickup'), chaosB: new CharacterFactory(0.82, 'Mouth_207', 'Formation_Pickup') };   // bK=레이사(카오스 모드 흑 전체)   // K=코유키(카오스 모드 백 전체)
//   // P=하루카, Q=히나, R=아코, B=카요코, N=아루, bP=코하루(흑 폰), bN=Mine(흑 나이트), bB=Nagisa(흑 비숍), bR=Hanako(흑 룩), bQ=Mika(흑 퀸)
const G = {
  state: newGame(), pieces: new Array(64).fill(null), legal: [], selected: null,
  last: null, busy: false, over: false, hist: [], moved: new Set(), mode: 'ai', human: 'w', depth: 2, level: 2, chaos: false, groups: new Set(),
};
const pickGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 8), pickMat = new THREE.MeshBasicMaterial({ visible: false });

// ───────── 직각(90°) 시점 전용: 기물을 2D 이미지로 표시 ─────────
const PIECE2D_SIZE = 0.88;   // 칸(1.0) 대비 이미지 크기 (하이라이트 테두리가 보이도록 약간 작게)
const PIECE2D_FILES = { wP: './images/pawn_white_2d.jpg', wB: './images/bishop_white_2d.jpg', wN: './images/knight_white_2d.jpg', wR: './images/rook_white_2d.jpg', wQ: './images/queen_white_2d.jpg', bP: './images/pawn_black_2d.jpg', bQ: './images/queen_black_2d.jpg', bR: './images/rook_black_2d.jpg', bB: './images/bishop_black_2d.jpg', bN: './images/knight_black_2d.png',
  cb: './images/chaos_black_2d.jpg', cw: './images/chaos_white_2d.jpg' };   // 색+기물 종류 → 이미지 / cb·cw = 카오스 모드의 흑·백 기물 전부(종류 무관)
const piece2d = {};
for (const [type, url] of Object.entries(PIECE2D_FILES)) {
  const geo = new THREE.PlaneGeometry(PIECE2D_SIZE, PIECE2D_SIZE);
  const tex = new THREE.TextureLoader().load(url, (t) => {   // 이미지 비율 유지
    const { width, height } = t.image, k = PIECE2D_SIZE / Math.max(width, height);
    geo.dispose(); piece2d[type].mesh_geo = new THREE.PlaneGeometry(width * k, height * k);
    for (const g of G.groups) if (g.userData.flat && g.userData.key2d === type) g.userData.flat.children[0].geometry = piece2d[type].mesh_geo;
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // 조명·톤매핑·안개 영향을 받지 않게 해서 원본 이미지 색 그대로 표시
  piece2d[type] = { geo, mesh_geo: geo, mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }) };
}
let topDown = false;   // 현재 직각으로 내려다보는 중인가
function attachPiece2D(g) {
  // 카오스 모드: 색별로 기물 전부 같은 이미지('cb' / 'cw') / 일반 모드: 색+종류별 이미지
  const key = G.chaos ? 'c' + g.userData.color : g.userData.color + g.userData.type;
  const d = key && piece2d[key]; if (!d) return;
  g.userData.key2d = key;
  const flat = new THREE.Group(); flat.visible = topDown;
  const m = new THREE.Mesh(d.mesh_geo, d.mat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.raycast = () => {};
  flat.add(m); g.add(flat); g.userData.flat = flat;
  applyTopDownTo(g);
}
function applyTopDownTo(g) {
  const flat = g.userData.flat; if (!flat) return;
  for (const c of g.children) if (c !== flat && c !== g.userData.pk) c.visible = !topDown;   // 3D 모델 숨김 (클릭 판정용 pk 는 유지)
  flat.visible = topDown;
}
function updateTopDownView() {
  const phi = controls.getPolarAngle();
  if (!topDown && phi < 0.02) { topDown = true; G.groups.forEach(applyTopDownTo); }
  else if (topDown && phi > 0.06) { topDown = false; G.groups.forEach(applyTopDownTo); }
  if (!topDown) return;
  // 이미지의 위쪽이 항상 화면 위쪽을 향하도록 카메라 방향에 맞춰 회전
  const th = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  for (const g of G.groups) if (g.userData.flat) g.userData.flat.rotation.y = th - g.rotation.y;
}

function spawn(type, color, sq) {
  const g = createPiece(type, color, chars, G.chaos);
  const pk = new THREE.Mesh(pickGeo, pickMat); pk.position.y = 0.55; pk.userData.pick = g; g.add(pk);
  g.position.copy(posOf(sq)); g.userData.sq = sq; g.userData.pk = pk;
  attachPiece2D(g);   // 2D 이미지가 지정된 기물: 직각 시점에서 2D 이미지로 전환 (일반/카오스 모드별로 이미지 지정)
  scene.add(g); G.groups.add(g); G.pieces[sq] = g; return g;
}
function disposeGroup(g) { scene.remove(g); G.groups.delete(g); }
function buildBoard() {
  for (const g of [...G.groups]) disposeGroup(g);
  G.pieces.fill(null);
  G.state.b.forEach((p, sq) => { if (p) spawn(p[1], p[0], sq); });
}

// ───────── 트윈 ─────────
const tweens = [];
const tween = (dur, fn) => new Promise((res) => tweens.push({ t: 0, dur, fn, res }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (x) => x * x * (3 - 2 * x);
const angLerp = (a, b, t) => { let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; return a + d * t; };

async function slide(g, to, { hop = 0.12, walk = true } = {}) {
  const from = g.position.clone(), dest = posOf(to);
  const dir = dest.clone().sub(from), dist = dir.length();
  const yaw0 = g.rotation.y, yawT = Math.atan2(dir.x, dir.z);
  if (g.userData.pawn && walk) g.userData.play('Cafe_Walk');
  await tween(0.35 + dist * 0.12, (t) => {
    const e = ease(t);
    g.position.set(from.x + dir.x * e, Math.sin(Math.PI * e) * hop, from.z + dir.z * e);
    if (walk) g.rotation.y = angLerp(yaw0, yawT, Math.min(1, t * 4)) ;
  });
  g.position.copy(dest);
  await tween(0.15, (t) => { g.rotation.y = angLerp(g.rotation.y, g.userData.faceYaw, ease(t)); });
  g.rotation.y = g.userData.faceYaw;
  if (g.userData.pawn) g.userData.play('Formation_Idle');
}
async function vanish(g) {
  if (g.userData.pawn) g.userData.playOnce('Cafe_Reaction');
  const s0 = g.scale.x;
  await tween(0.7, (t) => { g.scale.setScalar(s0 * (t < 0.3 ? 1 + t : Math.max(0.001, 1.3 * (1 - (t - 0.3) / 0.7)))); g.position.y = t * 0.5; });
  disposeGroup(g);
}

// ───────── 하이라이트 ─────────
function setHl(sq, color, op) { hl[sq].material.color.set(color); hl[sq].material.opacity = op; }
function refreshHighlights() {
  hl.forEach((h) => (h.material.opacity = 0));
  marks.forEach((m) => (m.visible = false));
  if (G.last) { setHl(G.last.from, 0x7fb2ff, 0.45); setHl(G.last.to, 0x7fb2ff, 0.55); }
  const st = G.state;
  if (inCheck(st)) setHl(st.b.indexOf(st.turn + 'K'), 0xff3355, 0.7);
  if (G.selected !== null) {
    setHl(G.selected, 0xffd84d, 0.7);
    for (const m of G.legal.filter((m) => m.from === G.selected)) {
      const mk = marks[m.to]; mk.visible = true;
      mk.userData.dot.visible = !m.cap; mk.userData.ring.visible = !!m.cap;
    }
  }
}
function select(sq) {
  G.selected = sq; refreshHighlights();
  const g = G.pieces[sq]; if (g?.userData.pawn) g.userData.playOnce(g.userData.selectAnim);
}
const clearSel = () => { G.selected = null; refreshHighlights(); };

// ───────── 진행 ─────────
const NAMES = { w: '백', b: '흑' };
function updateHud() {
  const st = status(G.state);
  const who = G.mode === 'ai' ? (G.state.turn === G.human ? '내 차례' : 'AI 생각 중…') : G.mode === 'online' ? (G.state.turn === G.human ? '내 차례' : '상대 차례') : `${NAMES[G.state.turn]} 차례`;
  let txt = `${NAMES[G.state.turn]} · ${who}`;
  if (st.check) txt += '  ⚠ 체크!';
  $('status').textContent = txt;
  $('turnDot').style.background = G.state.turn === 'w' ? '#fff' : '#2b2540';
  return st;
}
function endGame(st) {
  G.over = true;
  const msg = { checkmate: `체크메이트! ${NAMES[st.winner]} 승리 🎉`, stalemate: '스테일메이트 – 무승부', fifty: '50수 규칙 – 무승부', insufficient: '기물 부족 – 무승부', timeout: `시간 초과! ${NAMES[st.winner]} 승리 ⏱`, resign: `기권 – ${NAMES[st.winner]} 승리 🏳`, disconnect: `상대 연결 끊김 – ${NAMES[st.winner]} 승리` }[st.result];
  $('overText').textContent = msg; $('over').classList.remove('hidden');
}

// ───────── 대국 시계 (무제한 / 1분 / 10분 — 각자 제한 시간) ─────────
const TIME_MODES = [0, 60, 600];   // 초 (0 = 무제한)
const TIME_LABELS = { 0: '⏱ 무제한', 60: '⏱ 1분', 600: '⏱ 10분' };
Object.assign(G, { home: true, timeLimit: 0, clock: { w: 0, b: 0 }, clockSide: null, clockStamp: 0, timeLoss: false });
const fmtTime = (sec) => { const t = Math.max(0, Math.ceil(sec)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function updateClockUi() {
  $('clocks').classList.toggle('hidden', !G.timeLimit);
  if (!G.timeLimit) return;
  for (const c of ['w', 'b']) {
    const el = $(c === 'w' ? 'clockW' : 'clockB');
    const txt = fmtTime(G.clock[c]);
    if (el.lastChild.textContent !== txt) el.lastChild.textContent = txt;
    el.classList.toggle('active', G.clockSide === c && !G.over);
    el.classList.toggle('low', G.clock[c] <= 10);
  }
}
function clockStart(side) { G.clockSide = G.timeLimit ? side : null; G.clockStamp = performance.now(); updateClockUi(); }
function clockReset() { G.clock = { w: G.timeLimit, b: G.timeLimit }; G.timeLoss = false; clockStart('w'); }
function tickClock() {
  const now = performance.now();
  const side = G.clockSide;
  if (side && G.timeLimit && !G.over && !G.home) {
    G.clock[side] -= (now - G.clockStamp) / 1000;
    if (G.clock[side] <= 0 && G.mode === 'online') { G.clock[side] = 0; G.clockStamp = now; updateClockUi(); return; }   // 온라인: 시간 초과 판정은 서버가 함
    if (G.clock[side] <= 0) {   // 시간 초과 → 상대 승리
      G.clock[side] = 0; G.clockSide = null; G.timeLoss = true;
      G.selected = null; G.legal = []; refreshHighlights(); $('promo').classList.add('hidden');
      updateClockUi();
      endGame({ result: 'timeout', winner: side === 'w' ? 'b' : 'w' });
      return;
    }
  }
  G.clockStamp = now;
  updateClockUi();
}
// 탭이 가려져 있던 시간은 시계에 반영하지 않음
document.addEventListener('visibilitychange', () => { if (!document.hidden) G.clockStamp = performance.now(); });

// ───────── 효과음 ─────────
// 먼저 시작된 효과음이 끝날 때까지, 나중에 시작된 효과음은 음소거로 재생(진행은 계속됨)
const activeSfx = [];   // 시작 순서대로 재생 중인 효과음 (맨 앞 = 소리 나는 효과음)
const makeSfx = (name) => {
  const a = new Audio();
  a.src = a.canPlayType('audio/ogg; codecs="vorbis"') ? `./sounds/${name}.ogg` : `./sounds/${name}.mp3`;
  a.preload = 'auto';
  return () => {
    const c = a.cloneNode(); c.volume = 1;
    c.muted = activeSfx.length > 0 && !G.chaos;   // 카오스 모드에서는 겹쳐도 모두 재생(음소거 없음)
    activeSfx.push(c);
    const done = () => {
      const i = activeSfx.indexOf(c); if (i < 0) return;
      activeSfx.splice(i, 1);
      if (i === 0 && activeSfx[0]) activeSfx[0].muted = false;   // 다음 순서가 소리를 이어받음
    };
    c.addEventListener('ended', done); c.addEventListener('error', done);
    c.play().catch(done);
  };
};
const sfxMove = makeSfx('haruka_move');       // 백 폰 첫 직진
const sfxKoyukiMove = makeSfx('koyuki_move');  // 카오스 모드: 백 기물 매 이동
const sfxReisaMove = makeSfx('reisa_move');    // 카오스 모드: 흑 기물 매 이동
const sfxKoyukiAttacks = [1, 2].map((i) => makeSfx('koyuki_attack_' + i));   // 카오스 모드: 백 기물이 기물을 잡을 때 (둘 중 랜덤)
const sfxKoyukiCaptureds = [1, 2].map((i) => makeSfx('koyuki_captured_' + i));   // 카오스 모드: 백 기물이 잡힐 때 (둘 중 랜덤)
const sfxReisaCaptured = makeSfx('reisa_captured');   // 카오스 모드: 흑 기물이 잡힐 때
const sfxReisaAttacks = [1, 2, 3].map((i) => makeSfx('reisa_attack_' + i));   // 카오스 모드: 흑 기물이 기물을 잡을 때 (셋 중 랜덤)
const sfxCapture = makeSfx('haruka_attack');  // 백 폰이 기물을 잡을 때
const sfxCaptured = makeSfx('haruka_captured'); // 백 폰이 상대에게 잡힐 때
const sfxQueenMove = makeSfx('hina_move');     // 백 퀸의 첫 이동
const sfxQueenCapture = makeSfx('hina_attack'); // 백 퀸이 기물을 잡을 때
const sfxQueenCaptured = makeSfx('hina_captured'); // 백 퀸이 상대에게 잡힐 때
const sfxRookCapture = makeSfx('ako_attack');   // 백 룩이 기물을 잡을 때
const sfxRookCaptured = makeSfx('ako_captured'); // 백 룩이 상대에게 잡힐 때
const sfxRookMove = makeSfx('ako_move');         // 백 룩의 첫 이동
const sfxBlackRookMove = makeSfx('hanako_move'); // 흑 룩의 첫 이동
const sfxBlackRookCapture = makeSfx('hanako_attack'); // 흑 룩이 기물을 잡을 때
const sfxBlackRookCaptured = makeSfx('hanako_captured'); // 흑 룩이 상대에게 잡힐 때
const sfxBlackPawnMove = makeSfx('koharu_move'); // 흑 폰의 첫 직진
const sfxBlackPawnCaptured = makeSfx('koharu_captured'); // 흑 폰이 상대에게 잡힐 때
const sfxBlackPawnCapture = makeSfx('koharu_attack'); // 흑 폰이 기물을 잡을 때
const sfxBlackBishopMove = makeSfx('nagisa_move'); // 흑 비숍의 첫 이동
const sfxBlackBishopCapture = makeSfx('nagisa_attack'); // 흑 비숍이 기물을 잡을 때
const sfxBlackBishopCaptured = makeSfx('nagisa_captured'); // 흑 비숍이 상대에게 잡힐 때
const sfxBlackKnightMove = makeSfx('mine_move'); // 흑 나이트의 첫 이동
const sfxBlackKnightCapture = makeSfx('mine_attack'); // 흑 나이트가 기물을 잡을 때
const sfxBlackKnightCaptured = makeSfx('mine_captured'); // 흑 나이트가 상대에게 잡힐 때
const sfxBlackQueenCapture = makeSfx('mika_attack'); // 흑 퀸이 기물을 잡을 때
const sfxBlackQueenCaptured = makeSfx('mika_captured'); // 흑 퀸이 상대에게 잡힐 때
const sfxBlackQueenMove = makeSfx('mika_move'); // 흑 퀸의 첫 이동
const sfxBishopMove = makeSfx('kayoko_move');   // 백 비숍의 첫 이동
const sfxKnightMove = makeSfx('aru_move');      // 백 나이트의 첫 이동
const sfxKnightCapture = makeSfx('aru_attack'); // 백 나이트가 기물을 잡을 때
const sfxKnightCaptured = makeSfx('aru_captured'); // 백 나이트가 상대에게 잡힐 때
const sfxBishopCapture = makeSfx('kayoko_attack'); // 백 비숍이 기물을 잡을 때
const sfxBishopCaptured = makeSfx('kayoko_captured'); // 백 비숍이 상대에게 잡힐 때

// ───────── 배경음악 (전곡 순서대로 반복 재생) ─────────
const BGM_TRACKS = [1, 2, 3, 4, 5, 6].map((i) => `./sounds/bgm/bgm${i}.mp3`);
const BGM_VOLUME = 0.35;   // 효과음이 묻히지 않도록 낮게
const bgm = new Audio();
bgm.volume = BGM_VOLUME; bgm.preload = 'auto';
let bgmIdx = 0, bgmOn = true, bgmStarted = false;
const bgmLoad = () => { bgm.src = BGM_TRACKS[bgmIdx]; };
bgm.addEventListener('ended', () => { bgmIdx = (bgmIdx + 1) % BGM_TRACKS.length; bgmLoad(); if (bgmOn) bgm.play().catch(() => {}); });
bgm.addEventListener('error', () => { bgmIdx = (bgmIdx + 1) % BGM_TRACKS.length; bgmLoad(); if (bgmOn) bgm.play().catch(() => {}); });
// 카오스 모드에서는 배경음악 1.75배속 (곡이 바뀌어도 유지되도록 defaultPlaybackRate 도 함께 설정)
const BGM_CHAOS_RATE = 1.75;
const bgmApplyRate = () => { const r = G.chaos ? BGM_CHAOS_RATE : 1; bgm.defaultPlaybackRate = r; bgm.playbackRate = r; };
bgmLoad(); bgmApplyRate();
const bgmUpdateBtn = () => { const b = document.getElementById('btnBgm'); if (b) b.textContent = bgmOn ? '🎵 BGM 켜짐' : '🔇 BGM 꺼짐'; };
// 브라우저 자동재생 제한 때문에 첫 터치/클릭/키 입력 때 재생 시작
const bgmStart = (e) => {
  if (bgmStarted) return;
  if (e && e.target && (e.target.id === 'btnBgm' || e.target.id === 'hmBgm')) return;   // BGM 버튼은 자체 처리
  bgmStarted = true;
  if (bgmOn) bgm.play().catch(() => { bgmStarted = false; });
};
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, bgmStart));
document.getElementById('btnBgm').onclick = () => {
  bgmOn = !bgmOn; bgmStarted = true;
  if (bgmOn) bgm.play().catch(() => {}); else bgm.pause();
  bgmUpdateBtn();
};
// 앱 전환/화면 꺼짐 시 일시정지, 돌아오면 이어서 재생
document.addEventListener('visibilitychange', () => {
  if (document.hidden) bgm.pause(); else if (bgmOn && bgmStarted) bgm.play().catch(() => {});
});
bgmUpdateBtn();

// ───────── 잡기 효과음 선택 (기물 점수 비교) ─────────
// 잡는 기물 < 잡히는 기물 → 잡히는 기물의 '잡힐 때' 소리 / 잡는 기물 > 잡히는 기물 → 잡는 기물의 '잡을 때' 소리 / 같으면 둘 중 랜덤
const PIECE_VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const SFX_ATTACK = { wP: sfxCapture, bP: sfxBlackPawnCapture, wQ: sfxQueenCapture, bQ: sfxBlackQueenCapture, wR: sfxRookCapture, bR: sfxBlackRookCapture, wB: sfxBishopCapture, bB: sfxBlackBishopCapture, wN: sfxKnightCapture, bN: sfxBlackKnightCapture };
const SFX_CAPTURED = { wP: sfxCaptured, bP: sfxBlackPawnCaptured, wQ: sfxQueenCaptured, bQ: sfxBlackQueenCaptured, wR: sfxRookCaptured, bR: sfxBlackRookCaptured, wB: sfxBishopCaptured, bB: sfxBlackBishopCaptured, wN: sfxKnightCaptured, bN: sfxBlackKnightCaptured };
function playCaptureSfx(attackerKey, victimKey) {
  // 카오스 모드: 흑 기물이 잡을 때는 기물 종류와 상관없이 레이사 잡기 소리 3개 중 하나를 랜덤 재생
  if (G.chaos) {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    if (attackerKey[0] === 'w') {
      pick(sfxKoyukiAttacks)();                                                   // 카오스 백: 코유키 잡기 소리 2개 중 랜덤
      if (victimKey[0] === 'b') sfxReisaCaptured();                               // 흑 기물이 잡힐 때: 레이사 잡힘 소리 (겹치면 나중 소리는 음소거)
      return;
    }
    pick(sfxReisaAttacks)();                                                      // 카오스 흑: 레이사 잡기 소리 3개 중 랜덤
    if (victimKey[0] === 'w') pick(sfxKoyukiCaptureds)();                         // 백 기물이 잡힐 때: 코유키 잡힘 소리 2개 중 랜덤 (겹치면 나중 소리는 음소거)
    return;
  }
  const va = PIECE_VALUE[attackerKey[1]], vv = PIECE_VALUE[victimKey[1]];
  let useAttack = va > vv ? true : va < vv ? false : Math.random() < 0.5;
  const f = (useAttack ? SFX_ATTACK[attackerKey] : SFX_CAPTURED[victimKey]) || SFX_ATTACK[attackerKey] || SFX_CAPTURED[victimKey];   // 해당 소리가 없으면(킹 등) 다른 쪽으로 대체
  if (f) f();
}

async function doMove(m) {
  G.busy = true; G.selected = null; G.hist.push({ state: G.state, last: G.last, moved: new Set(G.moved) });
  G.clockSide = null; updateClockUi();   // 이동 연출 중에는 시계 정지
  const mover = G.pieces[m.from];
  const capSq = m.ep ? m.epCap : m.to;
  const victim = m.cap ? G.pieces[capSq] : null;
  G.pieces[m.from] = null; if (m.ep) G.pieces[capSq] = null;
  G.last = { from: m.from, to: m.to }; G.legal = []; refreshHighlights();
  // 백 폰의 '첫 이동'(2랭크 출발)이면서 '직진'(잡기 아님, 같은 파일)일 때만 효과음 재생
  // 카오스 모드에서는 백 기물이 전부 코유키 → 매 이동마다 코유키 효과음 (기존 캐릭터별 첫 이동 효과음은 대신 재생하지 않음)
  const koyuki = G.chaos && m.piece[0] === 'w';
  if (koyuki) sfxKoyukiMove();
  // 카오스 모드에서는 흑 기물이 전부 레이사 → 매 이동마다 레이사 효과음 (기존 흑 캐릭터별 첫 이동 효과음은 대신 재생하지 않음)
  const reisa = G.chaos && m.piece[0] === 'b';
  if (reisa) sfxReisaMove();
  if (!koyuki && m.piece === 'wP' && !m.cap && !m.ep && m.from % 8 === m.to % 8 && Math.floor(m.from / 8) === 1) sfxMove();
  // 흑 폰의 '첫 이동'(7랭크 출발)이면서 '직진'(잡기 아님, 같은 파일)일 때만 효과음 재생
  if (!reisa && m.piece === 'bP' && !m.cap && !m.ep && m.from % 8 === m.to % 8 && Math.floor(m.from / 8) === 6) sfxBlackPawnMove();
  // 백 퀸·룩·비숍·나이트의 '첫 이동'일 때만 재생 (이동한 기물은 위치로 추적: 무르기/새 게임 시 복원)
  if (!reisa && m.piece === 'bQ' && !m.cap && !G.moved.has(m.from)) sfxBlackQueenMove();   // 흑 퀸의 첫 이동 (잡는 이동이면 효과음 없음)
  if (!koyuki && m.piece === 'wQ' && !m.cap && !G.moved.has(m.from)) sfxQueenMove();   // 잡는 이동이면 잡기 효과음이 대신 재생(겹침 방지)
  G.moved.delete(capSq);                    // 잡힌 칸의 퀸 기록 제거
  if (!koyuki && m.piece === 'wR' && !m.cap && !G.moved.has(m.from)) sfxRookMove();      // 백 룩의 첫 이동
  if (!koyuki && m.castle && m.piece === 'wK') sfxRookMove();                              // 캐슬링으로 룩이 처음 움직일 때
  if (!reisa && m.piece === 'bR' && !m.cap && !G.moved.has(m.from)) sfxBlackRookMove();   // 흑 룩의 첫 이동 (잡는 이동이면 효과음 없음)
  if (!reisa && m.castle && m.piece === 'bK') sfxBlackRookMove();                         // 캐슬링으로 흑 룩이 처음 움직일 때
  if (!reisa && m.piece === 'bB' && !m.cap && !G.moved.has(m.from)) sfxBlackBishopMove();   // 흑 비숍의 첫 이동 (잡는 이동이면 효과음 없음)
  if (!koyuki && m.piece === 'wB' && !m.cap && !G.moved.has(m.from)) sfxBishopMove();   // 백 비숍의 첫 이동 (잡는 이동이면 잡기 효과음이 대신 재생)
  if (!reisa && m.piece === 'bN' && !m.cap && !G.moved.has(m.from)) sfxBlackKnightMove();   // 흑 나이트의 첫 이동 (잡는 이동이면 효과음 없음)
  if (!koyuki && m.piece === 'wN' && !m.cap && !G.moved.has(m.from)) sfxKnightMove();   // 백 나이트의 첫 이동 (잡는 이동이면 잡기 효과음이 대신 재생)
  if (m.piece === 'wQ' || m.piece === 'bQ' || m.piece === 'wR' || m.piece === 'bR' || m.piece === 'wB' || m.piece === 'bB' || m.piece === 'wN' || m.piece === 'bN') { G.moved.delete(m.from); G.moved.add(m.to); }
  if (m.castle) { G.moved.delete(m.rookFrom); G.moved.add(m.rookTo); }
  const jobs = [slide(mover, m.to, { hop: m.piece[1] === 'N' ? 0.7 : 0.12, walk: true })];
  if (m.castle) { const rk = G.pieces[m.rookFrom]; G.pieces[m.rookFrom] = null; G.pieces[m.rookTo] = rk; rk.userData.sq = m.rookTo; jobs.push(slide(rk, m.rookTo, { hop: 0.1, walk: false })); }
  await Promise.all(jobs);
  if (victim) playCaptureSfx(m.piece, victim.userData.color + victim.userData.type);   // 기물 점수 비교로 '잡는/잡히는' 소리 중 하나만 재생
  if (victim) {
    G.pieces[capSq] = null;
    vanish(victim);
  }
  mover.userData.sq = m.to; G.pieces[m.to] = mover;
  if (m.promo) {
    disposeGroup(mover);
    const q = spawn(m.promo, G.state.turn, m.to); q.scale.setScalar(0.01);
    await tween(0.45, (t) => q.scale.setScalar(Math.max(0.01, ease(t) * 1.0)));
  }
  G.state = apply(G.state, m);
  G.legal = legalMoves(G.state);
  refreshHighlights();
  const st = updateHud();
  G.busy = false;
  if (st.over) { updateClockUi(); return endGame(st); }
  clockStart(G.state.turn);   // 상대 시계 시작
  maybeAI();
}
function maybeAI() {
  if (G.mode !== 'ai' || G.over || G.state.turn === G.human) return;
  G.busy = true;
  setTimeout(() => {
    if (G.over) { G.busy = false; return; }   // 그 사이 시간 초과 등으로 종료됨
    const m = bestMove(G.state, G.depth);
    G.busy = false;
    if (m) doMove(m);
  }, 2200);   // 플레이어 이동이 끝난 뒤 2.2초 후 AI가 이동
}

function onTap(sq) {
  if (G.busy || G.over) return;
  if ((G.mode === 'ai' || G.mode === 'online') && G.state.turn !== G.human) return;
  if (G.selected !== null) {
    const cand = G.legal.filter((m) => m.from === G.selected && m.to === sq);
    if (cand.length) {
      if (cand[0].promo) return askPromo(cand);
      return playMine(cand[0]);
    }
  }
  const p = G.state.b[sq];
  if (p && p[0] === G.state.turn && G.legal.some((m) => m.from === sq)) select(sq); else clearSel();
}
function askPromo(cand) {
  $('promo').classList.remove('hidden');
  document.querySelectorAll('#promo button').forEach((b) => {
    b.onclick = () => { $('promo').classList.add('hidden'); playMine(cand.find((m) => m.promo === b.dataset.p)); };
  });
}

// ───────── 입력 ─────────
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
  if (moved > 8 || dt > 500) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = [...tiles, ...[...G.groups].map((g) => g.userData.pk)];
  const hit = ray.intersectObjects(targets, false)[0];
  if (!hit) return;
  const sq = hit.object.userData.sq ?? hit.object.userData.pick?.userData.sq;
  if (sq !== undefined) onTap(sq);
});

// ───────── UI 버튼 ─────────
function newGameStart() {
  $('over').classList.add('hidden'); $('promo').classList.add('hidden');
  G.state = newGame(); G.last = null; G.selected = null; G.over = false; G.busy = false; G.hist = []; G.moved = new Set();
  buildBoard(); G.legal = legalMoves(G.state); refreshHighlights(); updateHud();
  clockReset();
  setView(G.mode === 'ai' || G.mode === 'online' ? G.human : 'w');
  maybeAI();
}
function setView(side) {
  const d = camera.position.clone().sub(controls.target); const len = Math.hypot(d.x, d.z);
  const s = side === 'w' ? 1 : -1;
  camera.position.set(0, d.y, s * len); controls.update();
}
$('btnNew').onclick = newGameStart;
$('btnAgain').onclick = () => {
  if (G.mode === 'online') { $('over').classList.add('hidden'); leaveOnline(); showHome(); return; }   // 온라인: 다시 하기 = 홈으로
  newGameStart();
};
$('btnUndo').onclick = () => {
  if (G.busy || !G.hist.length || G.timeLoss || G.mode === 'online') return;
  let back = G.mode === 'ai' ? 2 : 1;
  let h; while (back-- && G.hist.length) h = G.hist.pop();
  G.state = h.state; G.last = h.last; G.moved = new Set(h.moved); G.over = false; $('over').classList.add('hidden');
  G.selected = null; buildBoard(); G.legal = legalMoves(G.state); refreshHighlights(); updateHud();
  clockStart(G.state.turn);   // 무르기로 시간이 돌아오지는 않음 (현재 남은 시간 유지)
};
$('btnTime').onclick = () => {
  G.timeLimit = TIME_MODES[(TIME_MODES.indexOf(G.timeLimit) + 1) % TIME_MODES.length];
  $('btnTime').textContent = TIME_LABELS[G.timeLimit];
  newGameStart();   // 시간 모드를 바꾸면 새 게임으로 시작
};
$('btnMode').onclick = () => { G.mode = G.mode === 'ai' ? '2p' : 'ai'; $('btnMode').textContent = G.mode === 'ai' ? '🤖 AI 대전' : '👥 2인 대전'; newGameStart(); };
// 난이도: ★ → ★★ → ★★★ → 🔥 카오스 → ★ …  (카오스는 현재 UI만 추가, 탐색 깊이는 ★★★와 동일)
const LEVEL_LABELS = ['', '난이도 ★', '난이도 ★★', '난이도 ★★★', '🔥 카오스'];
// 카오스 모드 진입/해제 시 백 기물 외형을 다시 만든다 (애니메이션 중이면 끝난 뒤)
function applyChaosSkin() {
  if (G.busy) { setTimeout(applyChaosSkin, 150); return; }
  G.selected = null; buildBoard(); refreshHighlights();
}
$('btnLevel').onclick = () => {
  const wasChaos = G.chaos;
  G.level = G.level % 4 + 1;
  G.chaos = G.level === 4;
  bgmApplyRate();
  G.depth = G.chaos ? 3 : G.level;
  $('btnLevel').textContent = LEVEL_LABELS[G.level];
  $('btnLevel').classList.toggle('chaos', G.chaos);
  document.body.classList.toggle('chaos', G.chaos);
  if (G.chaos !== wasChaos) applyChaosSkin();
};

// ───────── 홈 화면 (임시) ─────────
function syncHome() {
  $('hmLevel').textContent = $('btnLevel').textContent; $('hmLevel').classList.toggle('chaos', G.chaos);
  $('hmTime').textContent = $('btnTime').textContent;
  $('hmBgm').textContent = $('btnBgm').textContent;
  $('hmResume').classList.toggle('hidden', !(G.hist.length && !G.over));   // 진행 중인 게임이 있을 때만 이어하기
}
function showHome() {
  if (G.mode === 'online' && net?.started) {
    if (!G.over && !confirm('나가면 기권 처리됩니다. 홈으로 갈까요?')) return;
    leaveOnline();
  }
  G.home = true; document.body.classList.add('home');
  $('home').classList.remove('hidden'); $('promo').classList.add('hidden'); syncHome();
}
function hideHome() { G.home = false; document.body.classList.remove('home'); $('home').classList.add('hidden'); }
function setMode(m) { G.mode = m; $('btnMode').textContent = m === 'ai' ? '🤖 AI 대전' : '👥 2인 대전'; }
$('hmAI').onclick = () => { setMode('ai'); hideHome(); newGameStart(); };
$('hmP2').onclick = () => { setMode('2p'); hideHome(); newGameStart(); };
$('hmResume').onclick = () => { hideHome(); clockStart(G.state.turn); };
$('hmLevel').onclick = () => { $('btnLevel').click(); syncHome(); };
$('hmTime').onclick = () => { $('btnTime').click(); syncHome(); };
$('hmBgm').onclick = () => { $('btnBgm').click(); syncHome(); };
$('btnHome').onclick = showHome;

// ───────── 온라인 대전 (server.js 와 웹소켓으로 통신) ─────────
let net = null;                 // { ws, color, room, started, pending }
let modeBeforeOnline = 'ai';
const netSend = (o) => { if (net?.ws?.readyState === 1) net.ws.send(JSON.stringify(o)); };
const olMsg = (txt, err = false) => { $('olMsg').textContent = txt; $('olMsg').classList.toggle('err', err); };
function closeNet() { if (net?.ws) { net.ws.onclose = null; try { net.ws.close(); } catch {} } net = null; }
function olShowLobby() { $('olLobby').classList.remove('hidden'); $('olWait').classList.add('hidden'); }
function openOnline() {
  closeNet(); olShowLobby(); olMsg('');
  $('olTime').textContent = TIME_LABELS[G.timeLimit];
  $('home').classList.add('hidden'); $('online').classList.remove('hidden');
}
function connect(onOpen) {
  closeNet();
  let ws;
  try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`); }
  catch { olMsg('온라인 서버에 연결할 수 없습니다. (node server.js 로 실행한 주소로 접속해 주세요)', true); return; }
  net = { ws, color: null, room: null, started: false, pending: 0 };
  ws.onopen = () => onOpen();
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onNet(m); };
  ws.onclose = () => {
    if (net?.ws !== ws) return;
    if (net.started) {
      if (!G.over) { G.over = true; G.clockSide = null; $('overText').textContent = '서버와 연결이 끊겼습니다'; $('over').classList.remove('hidden'); }
    } else { net = null; olShowLobby(); olMsg('서버에 연결할 수 없습니다. node server.js 로 실행한 주소로 접속했는지 확인해 주세요.', true); }
  };
}
function onNet(m) {
  if (m.t === 'created') {
    net.room = m.room; net.color = m.color;
    $('olCodeShow').textContent = m.room; $('olLobby').classList.add('hidden'); $('olWait').classList.remove('hidden'); olMsg('');
  } else if (m.t === 'error') {
    olMsg(m.msg, true); closeNet(); olShowLobby();
  } else if (m.t === 'start') {
    net.color = m.color; net.started = true; startOnlineGame(m);
  } else if (m.t === 'move') {
    if (m.clock) { G.clock = m.clock; G.clockStamp = performance.now(); updateClockUi(); }
    if (m.by !== net.color) { net.pending++; playRemote(m); }
  } else if (m.t === 'over') {
    onlineOver(m);
  } else if (m.t === 'reject') {
    if (!G.over) { G.over = true; G.clockSide = null; $('overText').textContent = `${m.msg} (동기화 오류 – 홈으로 돌아갑니다)`; $('over').classList.remove('hidden'); }
  }
}
function startOnlineGame(m) {
  if (G.mode !== 'online') modeBeforeOnline = G.mode;
  G.mode = 'online'; G.human = net.color; G.timeLimit = m.time;
  $('btnTime').textContent = TIME_LABELS[G.timeLimit];
  document.body.classList.add('online');
  $('online').classList.add('hidden'); hideHome(); newGameStart();
}
function leaveOnline() {
  closeNet();
  document.body.classList.remove('online');
  G.over = true; G.clockSide = null; G.human = 'w';
  setMode(modeBeforeOnline);
}
const playMine = (m) => { if (G.mode === 'online') netSend({ t: 'move', from: m.from, to: m.to, promo: m.promo || null }); doMove(m); };
function playRemote(m) {
  if (!net || G.over && !G.busy) { if (net) net.pending--; return; }
  if (G.busy) return void setTimeout(() => playRemote(m), 80);
  const mv = G.legal.find((x) => x.from === m.from && x.to === m.to && (x.promo || null) === (m.promo || null));
  net.pending--;
  if (mv) doMove(mv);
  else if (!G.over) { G.over = true; G.clockSide = null; $('overText').textContent = '게임 상태가 맞지 않습니다 (동기화 오류)'; $('over').classList.remove('hidden'); }
}
function onlineOver(m) {
  const natural = ['checkmate', 'stalemate', 'fifty', 'insufficient'].includes(m.result);
  const fin = () => {
    if (!net) return;
    if (natural && (G.busy || net.pending > 0)) return void setTimeout(fin, 100);   // 마지막 이동 연출이 끝난 뒤에 결과 표시
    if (m.clock) G.clock = m.clock;
    if (!G.over) { G.over = true; G.clockSide = null; endGame({ result: m.result, winner: m.winner }); }
    updateClockUi();
  };
  fin();
}
$('hmOnline').onclick = openOnline;
$('olBack').onclick = () => { closeNet(); $('online').classList.add('hidden'); $('home').classList.remove('hidden'); syncHome(); };
$('olTime').onclick = () => { G.timeLimit = TIME_MODES[(TIME_MODES.indexOf(G.timeLimit) + 1) % TIME_MODES.length]; $('olTime').textContent = TIME_LABELS[G.timeLimit]; $('btnTime').textContent = TIME_LABELS[G.timeLimit]; };
$('olCreate').onclick = () => { olMsg('서버에 연결 중…'); connect(() => { olMsg(''); netSend({ t: 'create', time: G.timeLimit, color: 'r' }); }); };
$('olJoin').onclick = () => {
  const code = $('olCode').value.trim().toUpperCase();
  if (code.length !== 4) return olMsg('방 코드 4자리를 입력해 주세요.', true);
  olMsg('서버에 연결 중…'); connect(() => { olMsg(''); netSend({ t: 'join', room: code }); });
};
$('olCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('olJoin').click(); });
$('btnResign').onclick = () => { if (net?.started && !G.over && confirm('기권하시겠습니까?')) netSend({ t: 'resign' }); };

// ───────── 루프 ─────────
// 체스판(+기물 높이)이 화면 안에 통째로 들어오도록 카메라 거리를 자동 계산 (모바일 세로 화면 대응)
const FIT_PTS = [];
for (const x of [-4.4, 4.4]) for (const z of [-4.4, 4.4]) for (const y of [0, 1.4]) FIT_PTS.push(new THREE.Vector3(x, y, z));
function fitDistance(minDist) {
  const h = window.innerHeight;
  const xLim = 0.94;                                   // 좌우 여백 약 3%
  const yLim = Math.max(0.5, 1 - 2 * 120 / h);         // 위/아래 버튼(HUD) 높이만큼 여백
  const dir = camera.position.clone().sub(controls.target).normalize();
  const v = new THREE.Vector3();
  for (let d = minDist; d < 45; d += 0.25) {
    camera.position.copy(controls.target).addScaledVector(dir, d);
    camera.lookAt(controls.target); camera.updateMatrixWorld();
    if (FIT_PTS.every((p) => { v.copy(p).project(camera); return Math.abs(v.x) <= xLim && Math.abs(v.y) <= yLim; })) return d;
  }
  return 45;
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  const d = fitDistance(13);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, d);
  controls.maxDistance = Math.max(20, d * 1.25);       // 자동 맞춤 거리가 확대 제한에 걸리지 않게
  scene.fog.near = d * 1.4; scene.fog.far = d * 3.2;   // 멀리 물러나도 체스판에 안개가 끼지 않게
  controls.update();
}
window.addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05), now = performance.now() / 1000;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]; tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
  for (const g of G.groups) {
    if (g.userData.mixer) g.userData.mixer.update(dt);
    else g.traverse((o) => { if (o.userData.halo) { o.position.y += Math.sin(now * 2 + g.id) * 0.0008; o.rotation.z += dt * 0.8; } });
  }
  snapTopDown(dt);
  tickClock();
  controls.update(); updateTopDownView(); renderer.render(scene, camera);
}

// ───────── 시작 ─────────
(async () => {
  try {
    const prog = new Array(12).fill(0);
    const upd = (i) => (e) => { if (e.total) { prog[i] = e.loaded / e.total; $('bar').style.width = Math.round(prog.reduce((a, b) => a + b, 0) * (100 / prog.length)) + '%'; } };
    await Promise.all([chars.P.load('./models/pawn.glb', upd(0)), chars.Q.load('./models/hina.glb', upd(1)), chars.R.load('./models/ako.glb', upd(2)), chars.B.load('./models/kayoko.glb', upd(3)), chars.N.load('./models/aru.glb', upd(4)), chars.bP.load('./models/koharu.glb', upd(5)), chars.bN.load('./models/knight_black.glb', upd(6)), chars.bB.load('./models/bishop_black.glb', upd(7)), chars.bR.load('./models/rook_black.glb', upd(8)), chars.bQ.load('./models/queen_black.glb', upd(9)), chars.chaosW.load('./models/koyuki.glb', upd(10)), chars.chaosB.load('./models/reisa.glb', upd(11))]);
  } catch (err) {
    $('loadText').textContent = '모델 로드 실패: ' + err.message; return;
  }
  $('loading').classList.add('hidden');
  newGameStart(); loop();
})();
