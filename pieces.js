import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ───────── 공통 재질 ─────────
const grad = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: grad });
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1b1626, side: THREE.BackSide });

const TEAM = {
  w: { body: 0xf6f2ea, trim: 0xe9b949, base: 0xf3e9d2, glow: 0xffe08a },
  b: { body: 0x343a52, trim: 0xb28cff, base: 0x2a2540, glow: 0xa98cff },
};
const SKIN = 0xffe0cc;

function mesh(geo, color, { outline = true, x = 0, y = 0, z = 0 } = {}) {
  const m = new THREE.Mesh(geo, toon(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  if (outline) {
    const o = new THREE.Mesh(geo, outlineMat);
    o.scale.setScalar(1.06); o.raycast = () => {};
    m.add(o);
  }
  return m;
}

// ───────── 받침대 + 헤일로 (모든 말 공통) ─────────
function pedestal(color) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.43, 0.07, 36), TEAM[color].base, { y: 0.035 }));
  const ring = mesh(new THREE.TorusGeometry(0.4, 0.025, 8, 40), TEAM[color].trim, { outline: false, y: 0.075 });
  ring.rotation.x = Math.PI / 2; g.add(ring);
  return g;
}
function halo(color, y) {
  const h = mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 32), TEAM[color].glow, { outline: false });
  h.material = new THREE.MeshBasicMaterial({ color: TEAM[color].glow });
  h.rotation.x = Math.PI / 2 - 0.25; h.position.y = y; h.userData.halo = true;
  return h;
}

// ───────── SD(2등신) 스타일 절차적 말: K Q B N R ─────────
function sdPiece(type, color) {
  const t = TEAM[color];
  const g = new THREE.Group();
  g.add(pedestal(color));
  const bodyH = { K: 0.5, Q: 0.48, B: 0.46, N: 0.4, R: 0.42 }[type];
  // 몸통 (통통한 로브)
  const prof = [[0.30, 0], [0.31, 0.06], [0.25, bodyH * 0.55], [0.17, bodyH]].map(([r, y]) => new THREE.Vector2(r, y));
  const body = mesh(new THREE.LatheGeometry(prof, 28), t.body, { y: 0.07 });
  g.add(body);
  const belt = mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 28), t.trim, { outline: false, y: 0.07 + bodyH * 0.55 });
  belt.rotation.x = Math.PI / 2; g.add(belt);
  // 큰 머리
  const hy = 0.07 + bodyH + 0.17;
  g.add(mesh(new THREE.SphereGeometry(0.2, 28, 20), SKIN, { y: hy }));
  for (const sx of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.027, 12, 10), 0x2a2030, { outline: false, x: sx * 0.075, y: hy - 0.01, z: 0.185 }));
    g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), 0xff9fae, { outline: false, x: sx * 0.12, y: hy - 0.06, z: 0.165 }));
  }
  const top = hy + 0.17;
  const hat = new THREE.Group(); hat.position.y = top - 0.02; g.add(hat);
  if (type === 'K') {
    hat.add(mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.1, 20), t.trim, { y: 0.03 }));
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2;
      hat.add(mesh(new THREE.ConeGeometry(0.04, 0.1, 8), t.trim, { x: Math.cos(a) * 0.15, y: 0.13, z: Math.sin(a) * 0.15 })); }
    hat.add(mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), t.trim, { y: 0.2 }));
    hat.add(mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), t.trim, { y: 0.22 }));
  } else if (type === 'Q') {
    const tr = mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), t.trim, { y: 0.05 }); tr.rotation.x = Math.PI / 2; hat.add(tr);
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2;
      hat.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), 0xff6f9c, { x: Math.cos(a) * 0.16, y: 0.09, z: Math.sin(a) * 0.16 })); }
    hat.add(mesh(new THREE.SphereGeometry(0.06, 14, 10), t.trim, { y: 0.14 }));
  } else if (type === 'B') {
    const c = mesh(new THREE.ConeGeometry(0.16, 0.34, 18), t.body, { y: 0.15 }); hat.add(c);
    hat.add(mesh(new THREE.BoxGeometry(0.04, 0.2, 0.17), t.trim, { y: 0.12, z: 0.02 }));
    hat.add(mesh(new THREE.SphereGeometry(0.045, 10, 8), t.trim, { y: 0.34 }));
  } else if (type === 'N') {
    hat.add(mesh(new THREE.SphereGeometry(0.19, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), t.body, { y: -0.02 }));
    for (const sx of [-1, 1]) hat.add(mesh(new THREE.ConeGeometry(0.06, 0.18, 10), t.body, { x: sx * 0.1, y: 0.2, z: -0.02 }));
    const mane = mesh(new THREE.BoxGeometry(0.06, 0.2, 0.22), t.trim, { y: 0.08, z: -0.16 }); hat.add(mane);
    const snout = mesh(new THREE.SphereGeometry(0.09, 14, 10), t.body, { y: -0.12, z: 0.2 }); snout.scale.set(1, 0.85, 1.3); hat.add(snout);
  } else if (type === 'R') {
    hat.add(mesh(new THREE.CylinderGeometry(0.2, 0.19, 0.16, 18), t.body, { y: 0.06 }));
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2;
      const m = mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), t.trim, { x: Math.cos(a) * 0.17, y: 0.18, z: Math.sin(a) * 0.17 }); m.rotation.y = -a; hat.add(m); }
  }
  g.add(halo(color, top + (type === 'N' ? 0.28 : 0.34)));
  return g;
}

// ───────── GLB 캐릭터 공장: 폰(하루카) / 퀸(히나) 공용 ─────────
export class CharacterFactory {
  constructor(scale = 0.78, mouth = 'Mouth_100', selectAnim = 'Tactical_Start') { this.scale = scale; this.mouth = mouth; this.selectAnim = selectAnim; this.gltf = null; this.clips = {}; }
  async load(url, onProgress) {
    const loader = new GLTFLoader();
    this.gltf = await loader.loadAsync(url, onProgress);
    this.gltf.animations.forEach((a) => { this.clips[a.name] = a; });
    // 표정(Mouth_*) 은 여러 개가 겹쳐 있으므로 기본 표정(this.mouth)만 남김
    this.gltf.scene.traverse((o) => {
      if (o.name && /^Mouth_\d+(_Flipped)?$/.test(o.name) && o.name !== this.mouth) o.visible = false;
      if (o.isMesh || o.isSkinnedMesh) {
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const nm = mats.map((m) => {
          const l = new THREE.MeshLambertMaterial({
            map: m.map, color: m.color,   // 텍스처 없는 재질(눈썹 등)의 원본 색 유지
            side: THREE.DoubleSide,
            alphaTest: m.alphaTest || (m.alphaMode === 'MASK' ? 0.5 : 0),
            transparent: false,
          });
          if (l.map) l.map.colorSpace = THREE.SRGBColorSpace;
          return l;
        });
        o.material = Array.isArray(o.material) ? nm : nm[0];
        o.castShadow = true;
      }
    });
  }
  create(color, scale) {
    const g = new THREE.Group();
    g.add(pedestal(color));
    const model = SkeletonUtils.clone(this.gltf.scene);
    model.traverse((o) => {                 // 클론마다 눈/입 중복 방지 재적용
      if (o.name && /^Mouth_\d+(_Flipped)?$/.test(o.name)) o.visible = (o.name === this.mouth);
      if (o.isMesh) o.frustumCulled = false;
    });
    const S = scale ?? this.scale;           // 칸(1.0)에 맞는 크기 (scale 지정 시 우선)
    model.scale.setScalar(S);
    model.position.y = 0.07;
    g.add(model);
    g.userData.model = model;
    g.userData.pawn = true;
    g.userData.selectAnim = this.selectAnim;   // 기물을 선택했을 때 재생할 애니메이션
    // 팀 구분: 어두운 팀은 몸쪽에 받침/링 색으로 구분, 모델은 원본 그대로
    const mixer = new THREE.AnimationMixer(model);
    const play = (name, { loop = true, fade = 0.2 } = {}) => {
      const clip = this.clips[name]; if (!clip) return;
      const a = mixer.clipAction(clip);
      mixer.stopAllAction();
      a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop; a.fadeIn(fade).play();
    };
    const playOnce = (name) => {
      const clip = this.clips[name]; if (!clip) return;
      play(name, { loop: false });
      clearTimeout(g.userData.t);
      g.userData.t = setTimeout(() => play('Formation_Idle', { fade: 0.3 }), Math.min(clip.duration, 3) * 1000);
    };
    g.userData.mixer = mixer; g.userData.play = play; g.userData.playOnce = playOnce;
    play('Formation_Idle');
    mixer.setTime(Math.random() * 3);
    return g;
  }
}

// ───────── 흑(상대): 기본 스타운턴 스타일 체스 기물 ─────────
const classicMat = new THREE.MeshStandardMaterial({ color: 0x25252b, roughness: 0.42, metalness: 0.12 });
const classicAccent = new THREE.MeshStandardMaterial({ color: 0x6c6c78, roughness: 0.5, metalness: 0.1 });

function cMesh(geo, { mat = classicMat, x = 0, y = 0, z = 0 } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function lathe(points) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 40);
}
const BASE = [[0, 0], [0.34, 0], [0.35, 0.04], [0.33, 0.09], [0.25, 0.14]];

function classicPiece(type) {
  const g = new THREE.Group();
  if (type === 'P') {
    g.add(cMesh(lathe([[0, 0], [0.30, 0], [0.31, 0.04], [0.29, 0.08], [0.20, 0.12], [0.12, 0.2], [0.10, 0.34], [0.16, 0.37], [0.17, 0.40], [0.10, 0.43], [0, 0.43]])));
    g.add(cMesh(new THREE.SphereGeometry(0.14, 32, 24), { y: 0.52 }));
  } else if (type === 'R') {
    g.add(cMesh(lathe([...BASE, [0.22, 0.2], [0.20, 0.45], [0.27, 0.5], [0.28, 0.54], [0.28, 0.6], [0, 0.6]])));
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const m = cMesh(new THREE.BoxGeometry(0.13, 0.12, 0.09), { x: Math.cos(a) * 0.22, y: 0.66, z: Math.sin(a) * 0.22 });
      m.rotation.y = -a + Math.PI / 2; g.add(m);
    }
  } else if (type === 'N') {
    g.add(cMesh(lathe([...BASE, [0.24, 0.2], [0, 0.2]])));
    const sh = new THREE.Shape();
    [[-0.2, 0.18], [0.2, 0.18], [0.14, 0.38], [0.30, 0.46], [0.34, 0.56], [0.28, 0.62], [0.12, 0.72],
     [0.10, 0.82], [0.03, 0.76], [-0.02, 0.84], [-0.08, 0.74], [-0.22, 0.55], [-0.22, 0.18]]
      .forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 });
    geo.translate(0, 0, -0.08); geo.rotateY(-Math.PI / 2);   // 얼굴이 +Z를 향하게
    geo.computeVertexNormals();
    g.add(cMesh(geo));
    for (const sx of [-1, 1]) g.add(cMesh(new THREE.SphereGeometry(0.025, 12, 10), { mat: classicAccent, x: sx * 0.115, y: 0.64, z: 0.14 }));
  } else if (type === 'B') {
    g.add(cMesh(lathe([...BASE, [0.17, 0.22], [0.11, 0.4], [0.10, 0.5], [0.19, 0.53], [0.19, 0.57], [0.10, 0.60], [0, 0.60]])));
    const mitre = cMesh(new THREE.SphereGeometry(0.15, 32, 24), { y: 0.74 }); mitre.scale.set(1, 1.45, 1); g.add(mitre);
    const slit = cMesh(new THREE.BoxGeometry(0.36, 0.025, 0.07), { mat: classicAccent, y: 0.78 }); slit.rotation.z = 0.7; g.add(slit);
    g.add(cMesh(new THREE.SphereGeometry(0.05, 16, 12), { y: 0.95 }));
  } else if (type === 'Q' || type === 'K') {
    const top = type === 'Q' ? 0.9 : 0.88;
    g.add(cMesh(lathe([[0, 0], [0.36, 0], [0.37, 0.04], [0.35, 0.09], [0.27, 0.15], [0.18, 0.25], [0.12, 0.45], [0.11, 0.6], [0.22, 0.66], [0.22, 0.70], [0.13, 0.74], [0.2, 0.84], [0.22, top], [0, top]])));
    if (type === 'Q') {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        g.add(cMesh(new THREE.SphereGeometry(0.035, 12, 10), { x: Math.cos(a) * 0.19, y: top + 0.02, z: Math.sin(a) * 0.19 }));
      }
      g.add(cMesh(new THREE.SphereGeometry(0.06, 20, 14), { y: top + 0.07 }));
    } else {
      g.add(cMesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), { y: top + 0.13 }));
      g.add(cMesh(new THREE.BoxGeometry(0.21, 0.07, 0.07), { y: top + 0.18 }));
    }
  }
  return g;
}

// 카오스 모드: 백 기물 전부를 코유키(chars.chaosW), 흑 기물 전부를 레이사(chars.chaosB) 디자인으로, 기물 종류별로 크기만 다르게
const CHAOS_SCALE = { P: 0.78, N: 0.82, B: 0.82, R: 0.82, Q: 0.85, K: 0.9 };
export function createPiece(type, color, chars, chaos = false) {
  // 백(플레이어): 폰=하루카 GLB, 퀸=히나 GLB, 나머지=SD 기물
  // 흑(상대): 폰=코하루 GLB, 나이트=Mine GLB, 비숍=Nagisa GLB, 룩=Hanako GLB, 퀸=Mika GLB, 나머지=기본 체스 기물
  let g;
  if (color === 'w' && chaos && chars.chaosW) g = chars.chaosW.create(color, CHAOS_SCALE[type]);
  else if (color === 'b' && chaos && chars.chaosB) g = chars.chaosB.create(color, CHAOS_SCALE[type]);   // 카오스: 흑 전체 = 레이사
  else if (color === 'w') g = chars[type] ? chars[type].create(color) : sdPiece(type, color);
  else if (type === 'P' && chars.bP) g = chars.bP.create(color);
  else if (type === 'N' && chars.bN) g = chars.bN.create(color);
  else if (type === 'B' && chars.bB) g = chars.bB.create(color);
  else if (type === 'R' && chars.bR) g = chars.bR.create(color);
  else if (type === 'Q' && chars.bQ) g = chars.bQ.create(color);
  else g = classicPiece(type);
  g.userData.type = type; g.userData.color = color;
  // 모델의 정면은 +Z. 백은 -Z(상대 진영)를, 흑은 +Z를 바라보도록 배치
  g.rotation.y = color === 'w' ? Math.PI : 0;
  g.userData.faceYaw = g.rotation.y;
  return g;
}
