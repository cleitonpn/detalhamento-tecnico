// Linhas ocultas e vista 3D com WebGL. Fora do navegador (testes) tudo é tratado como visível.
import * as THREE from "three";
import { VIEW_DEFS, featureEdges } from "./techdraw.js";
import { SCALE } from "../domain/project.js";

let shared = null;
function renderer() {
  if (shared !== null) return shared || null;
  try {
    if (typeof document === "undefined") throw Error("sem DOM");
    const canvas = document.createElement("canvas");
    shared = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    shared.setPixelRatio(1);
  } catch {
    shared = false;
  }
  return shared || null;
}

const RES = 1400;

/**
 * Classifica as linhas projetadas em visíveis e ocultas.
 * `projected`: [[sx1, sy1, c1, sx2, sy2, c2], ...] (c = proximidade do observador).
 */
export function classifyLines(triangles, projected, view, dimensions) {
  const gl = renderer();
  const def = VIEW_DEFS[view];
  const [w, h] = def.size(dimensions);
  if (!gl || !triangles.length || w <= 0 || h <= 0)
    return { visible: projected, hidden: [], exact: false };

  // Geometria já no espaço da vista: x, y de tela e z = proximidade
  const pos = new Float32Array(triangles.length);
  let cMin = Infinity,
    cMax = -Infinity;
  for (let i = 0; i < triangles.length; i += 3) {
    const p = def.map(
      [triangles[i], triangles[i + 1], triangles[i + 2]],
      dimensions,
    );
    pos[i] = p[0];
    pos[i + 1] = p[1];
    pos[i + 2] = p[2];
    cMin = Math.min(cMin, p[2]);
    cMax = Math.max(cMax, p[2]);
  }
  const range = Math.max(cMax - cMin, 1e-3);
  const pad = Math.max(w, h) * 0.01;
  const resX = Math.max(
    8,
    Math.round((RES * (w + 2 * pad)) / Math.max(w + 2 * pad, h + 2 * pad)),
  );
  const resY = Math.max(
    8,
    Math.round((RES * (h + 2 * pad)) / Math.max(w + 2 * pad, h + 2 * pad)),
  );
  const camZ = cMax + range * 0.1 + 0.01,
    near = 0.001,
    far = camZ - cMin + range * 0.1 + 0.01;
  const camera = new THREE.OrthographicCamera(
    -pad,
    w + pad,
    h + pad,
    -pad,
    near,
    far,
  );
  camera.position.set(0, 0, camZ);
  camera.updateProjectionMatrix();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  // Grava a proximidade normalizada em 24 bits (RGB) com codificação própria,
  // independente do formato interno de profundidade de cada versão do three.js.
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
    uniforms: { cMin: { value: cMin }, range: { value: range } },
    vertexShader: `varying float vC;
      void main() { vC = position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float;
      uniform float cMin; uniform float range; varying float vC;
      void main() {
        float v = floor(clamp((vC - cMin) / range, 0.0, 1.0) * 16777215.0);
        float r = floor(v / 65536.0); float g = floor((v - r * 65536.0) / 256.0); float b = v - r * 65536.0 - g * 256.0;
        gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const target = new THREE.WebGLRenderTarget(resX, resY, {
    type: THREE.UnsignedByteType,
  });
  gl.setRenderTarget(target);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(scene, camera);
  const buf = new Uint8Array(resX * resY * 4);
  gl.readRenderTargetPixels(target, 0, 0, resX, resY, buf);
  gl.setRenderTarget(null);
  target.dispose();
  geometry.dispose();
  material.dispose();

  // Proximidade da superfície mais próxima em cada pixel (−∞ onde não há nada)
  const front = new Float32Array(resX * resY);
  for (let i = 0; i < front.length; i++) {
    const k = i * 4;
    front[i] =
      buf[k + 3] < 128
        ? -Infinity
        : cMin +
          ((buf[k] * 65536 + buf[k + 1] * 256 + buf[k + 2]) / 16777215) * range;
  }
  const px = (x) => ((x + pad) / (w + 2 * pad)) * resX;
  const py = (y) => ((y + pad) / (h + 2 * pad)) * resY;
  const eps = Math.max(range * 0.004, 5e-4);
  const isVisible = (x, y, c) => {
    const cx = Math.floor(px(x)),
      cy = Math.floor(py(y));
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const X = cx + dx,
          Y = cy + dy;
        if (X < 0 || Y < 0 || X >= resX || Y >= resY) return true;
        if (front[Y * resX + X] <= c + eps) return true;
      }
    return false;
  };
  const visible = [],
    hidden = [];
  const texel = (w + 2 * pad) / resX;
  for (const [x1, y1, c1, x2, y2, c2] of projected) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.min(400, Math.ceil(len / texel)));
    let runStart = 0,
      runVis = null;
    const flags = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      flags.push(
        isVisible(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, c1 + (c2 - c1) * t),
      );
    }
    // Ignora trocas de 1 amostra (ruído do buffer)
    for (let s = 1; s < flags.length - 1; s++)
      if (flags[s - 1] === flags[s + 1] && flags[s] !== flags[s - 1])
        flags[s] = flags[s - 1];
    const emit = (a, b, vis) => {
      const ta = a / steps,
        tb = b / steps;
      const seg = [
        x1 + (x2 - x1) * ta,
        y1 + (y2 - y1) * ta,
        c1,
        x1 + (x2 - x1) * tb,
        y1 + (y2 - y1) * tb,
        c2,
      ];
      (vis ? visible : hidden).push(seg);
    };
    for (let s = 0; s <= steps; s++) {
      if (runVis === null) runVis = flags[s];
      if (flags[s] !== runVis) {
        emit(runStart, s, runVis);
        runStart = s;
        runVis = flags[s];
      }
    }
    emit(runStart, steps, runVis);
  }
  // Proteção: uma vista nunca fica vazia por falha da leitura de profundidade
  if (!visible.length && projected.length)
    return { visible: projected, hidden: [], exact: false };
  return { visible, hidden, exact: true };
}

/** Imagem isométrica da peça (PNG em data URL), em tons de cinza com arestas. */
export function isometricImage(
  triangles,
  edges3d,
  dimensions,
  { width = 900, height = 700 } = {},
) {
  const gl = renderer();
  if (!gl || !triangles.length) return null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(triangles, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({
    color: 0xdfe5ea,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  scene.add(new THREE.Mesh(geometry, material));
  const ePos = new Float32Array(edges3d.length * 6);
  edges3d.forEach(([a, b], i) => ePos.set([...a, ...b], i * 6));
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
  const eMat = new THREE.LineBasicMaterial({ color: 0x173b48 });
  scene.add(new THREE.LineSegments(eGeo, eMat));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-0.6, 1, 0.9);
  scene.add(sun);

  // Isométrica pelo canto frontal-esquerdo, como a vista lateral esquerda
  const [w, h, d] = dimensions;
  const center = new THREE.Vector3(w / 2, h / 2, d / 2);
  const dir = new THREE.Vector3(-1, 0.82, 1).normalize();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 1000);
  const span = Math.hypot(w, h, d) || 1;
  camera.position.copy(center).addScaledVector(dir, span * 2);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  // Enquadra pelos cantos projetados
  const corners = [];
  for (let i = 0; i < 8; i++)
    corners.push(
      new THREE.Vector3(
        i & 1 ? w : 0,
        i & 2 ? h : 0,
        i & 4 ? d : 0,
      ).applyMatrix4(camera.matrixWorldInverse),
    );
  const xs = corners.map((c) => c.x),
    ys = corners.map((c) => c.y);
  const cw = Math.max(...xs) - Math.min(...xs),
    ch = Math.max(...ys) - Math.min(...ys);
  const aspect = width / height;
  let halfW = (cw / 2) * 1.08,
    halfH = (ch / 2) * 1.08;
  if (halfW / halfH > aspect) halfH = halfW / aspect;
  else halfW = halfH * aspect;
  const mx = (Math.max(...xs) + Math.min(...xs)) / 2,
    my = (Math.max(...ys) + Math.min(...ys)) / 2;
  Object.assign(camera, {
    left: mx - halfW,
    right: mx + halfW,
    top: my + halfH,
    bottom: my - halfH,
    near: 0.001,
    far: span * 6,
  });
  camera.updateProjectionMatrix();

  gl.setSize(width, height, false);
  gl.setRenderTarget(null);
  gl.render(scene, camera);
  const url = gl.domElement.toDataURL("image/png");
  geometry.dispose();
  material.dispose();
  eGeo.dispose();
  eMat.dispose();
  return url;
}

const edgeGeoCache = new WeakMap();
function edgeGeometry(geometry) {
  let g = edgeGeoCache.get(geometry);
  if (!g) {
    g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(featureEdges(geometry), 3),
    );
    edgeGeoCache.set(geometry, g);
  }
  return g;
}

/**
 * Vista isométrica do stand inteiro: peças do caderno em destaque, demais em cinza.
 * Devolve a imagem e a posição (0–1) do marcador numerado de cada peça destacada.
 */
export function overviewImage(
  project,
  meshMap,
  highlighted,
  sourceUnit,
  { width = 1600, height = 1200 } = {},
) {
  const gl = renderer();
  if (!gl || !meshMap.size) return null;
  const scale = SCALE[sourceUnit] || 1;
  const owner = new Map();
  highlighted.forEach((p, i) => p.meshIds.forEach((id) => owner.set(id, i)));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const mats = {
    on: new THREE.MeshLambertMaterial({
      color: 0x8fd9b8,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    // Demais peças como "fantasma": a peça destacada aparece mesmo atrás de uma parede
    off: new THREE.MeshLambertMaterial({
      color: 0xe3e8ed,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
    onEdge: new THREE.LineBasicMaterial({ color: 0x0b5c46 }),
    offEdge: new THREE.LineBasicMaterial({
      color: 0xb4bec8,
      transparent: true,
      opacity: 0.55,
    }),
  };
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  const box = new THREE.Box3();
  const fills = [],
    edges = [];
  for (const [id, mesh] of meshMap) {
    if (!mesh.geometry?.attributes.position) continue;
    mesh.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4().multiplyMatrices(S, mesh.matrixWorld);
    const on = owner.has(id);
    const fill = new THREE.Mesh(mesh.geometry, on ? mats.on : mats.off);
    const lines = new THREE.LineSegments(
      edgeGeometry(mesh.geometry),
      on ? mats.onEdge : mats.offEdge,
    );
    fill.userData.on = on;
    fills.push(fill);
    edges.push(lines);
    for (const o of [fill, lines]) {
      o.matrixAutoUpdate = false;
      o.matrix.copy(m);
      scene.add(o);
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(m));
  }
  if (box.isEmpty()) return null;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(-0.6, 1, 0.9);
  scene.add(sun);

  const center = box.getCenter(new THREE.Vector3());
  const span = box.getSize(new THREE.Vector3()).length() || 1;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, span * 10);
  const aim = (dir, aspect) => {
    camera.position
      .copy(center)
      .addScaledVector(dir.clone().normalize(), span * 2);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const pts = [];
    for (let i = 0; i < 8; i++)
      pts.push(
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(camera.matrixWorldInverse),
      );
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    let halfW = ((Math.max(...xs) - Math.min(...xs)) / 2) * 1.06,
      halfH = ((Math.max(...ys) - Math.min(...ys)) / 2) * 1.06;
    if (halfW / halfH > aspect) halfH = halfW / aspect;
    else halfW = halfH * aspect;
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2,
      my = (Math.max(...ys) + Math.min(...ys)) / 2;
    Object.assign(camera, {
      left: mx - halfW,
      right: mx + halfW,
      top: my + halfH,
      bottom: my - halfH,
    });
    camera.updateProjectionMatrix();
  };
  const aspect = width / height;

  // Escolhe, entre os 4 cantos isométricos, o que mais mostra as peças destacadas:
  // render rápido com as demais peças opacas e conta os pixels da cor de destaque.
  const corners = [
    new THREE.Vector3(-1, 0.82, 1),
    new THREE.Vector3(1, 0.82, 1),
    new THREE.Vector3(1, 0.82, -1),
    new THREE.Vector3(-1, 0.82, -1),
  ];
  let best = corners[0];
  if (highlighted.length) {
    const probeOn = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      side: THREE.DoubleSide,
    });
    const probeOff = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    const saved = fills.map((o) => o.material);
    fills.forEach((o) => (o.material = o.userData.on ? probeOn : probeOff));
    edges.forEach((o) => (o.visible = false));
    const pw = 320,
      ph = Math.round(320 / aspect);
    const target = new THREE.WebGLRenderTarget(pw, ph);
    const px = new Uint8Array(pw * ph * 4);
    let bestCount = -1;
    for (const dir of corners) {
      aim(dir, aspect);
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 1);
      gl.clear();
      gl.render(scene, camera);
      gl.readRenderTargetPixels(target, 0, 0, pw, ph, px);
      let count = 0;
      for (let i = 0; i < px.length; i += 4)
        if (px[i + 1] > 200 && px[i] < 80) count++;
      if (count > bestCount) {
        bestCount = count;
        best = dir;
      }
    }
    gl.setRenderTarget(null);
    target.dispose();
    probeOn.dispose();
    probeOff.dispose();
    fills.forEach((o, i) => (o.material = saved[i]));
    edges.forEach((o) => (o.visible = true));
  }
  aim(best, aspect);

  gl.setSize(width, height, false);
  gl.setRenderTarget(null);
  gl.render(scene, camera);
  const url = gl.domElement.toDataURL("image/png");
  Object.values(mats).forEach((m) => m.dispose());

  // Marcadores no centro de cada peça destacada (bounds já em metros, no referencial do stand)
  const labels = highlighted.map((p, i) => {
    const c = new THREE.Vector3(
      ...[0, 1, 2].map((k) => (p.bounds.min[k] + p.bounds.max[k]) / 2),
    ).project(camera);
    return { n: i + 1, x: (c.x + 1) / 2, y: (1 - c.y) / 2 };
  });
  return { url, labels, aspect };
}
