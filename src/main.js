import './style.css';
import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const video = document.getElementById('webcam');
const overlayCanvas = document.getElementById('output_canvas');
const statusEl = document.getElementById('status');
const overlayCtx = overlayCanvas.getContext('2d');
const modeButtons = document.querySelectorAll('.mode-btn');
const MIRROR_CAMERA = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.z = 18;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.dataset.three = 'scene';
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const rim = new THREE.DirectionalLight(0x7ea1ff, 1.2);
rim.position.set(6, 8, 8);
scene.add(rim);

let handLandmarker;
let lastVideoTime = -1;
let detectedHands = [];
let activeMode = 'galaxy';
const FLOWER_VARIANTS = ['rose', 'sunflower', 'lotus', 'daisy', 'camellia', 'chrysanthemum'];

let galaxy = null;
let solarSystem = null;
let flowerWorld = null;
let butterflySystem = null;
let skeletonWorld = null;

const raycaster = new THREE.Raycaster();
const grabState = {
  item: null,
  kind: null,
  pinchActive: false,
  grabPlaneZ: 0,
};

const galaxyControl = {
  targetScale: 1,
  currentScale: 1,
  spinBoost: 0.012,
  depthSpeed: 0.03,
  colorShiftActive: false,
  colorHue: 0.62,
};

const flowerControl = {
  targetScale: 1,
  currentScale: 1,
  spinBoost: 0.01,
  variantIndex: 0,
  openPalmHeld: false,
  lastVariantSwitchMs: 0,
};

const companionControl = {
  tiltX: 0,
  tiltY: 0,
  motionSpeed: 0.01,
};

const skeletonControl = {
  targetScale: 1.15,
  currentScale: 1.15,
  danceActive: false,
  spinBoost: 0.01,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function describeError(err) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function setActiveModeButton() {
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === activeMode);
  });
}

function createGalaxy() {
  const count = 9000;
  const arms = 4;
  const radius = 11;
  const randomSpread = 1.1;

  const positions = new Float32Array(count * 3);
  const basePositions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const twists = new Float32Array(count);

  const inner = new THREE.Color(0xd6e5ff);
  const middle = new THREE.Color(0x8cb8ff);
  const outer = new THREE.Color(0xff9de0);

  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const r = Math.pow(Math.random(), 0.8) * radius;
    const armAngle = ((i % arms) / arms) * Math.PI * 2;
    const spinAngle = r * 1.05;
    const randomX = (Math.random() - 0.5) * randomSpread * (r / radius);
    const randomY = (Math.random() - 0.5) * randomSpread * 0.35;
    const randomZ = (Math.random() - 0.5) * randomSpread * (r / radius);

    positions[i3] = Math.cos(armAngle + spinAngle) * r + randomX;
    positions[i3 + 1] = (Math.random() - 0.5) * 0.9 + randomY;
    positions[i3 + 2] = Math.sin(armAngle + spinAngle) * r + randomZ;

    basePositions[i3] = positions[i3];
    basePositions[i3 + 1] = positions[i3 + 1];
    basePositions[i3 + 2] = positions[i3 + 2];

    radii[i] = Math.hypot(positions[i3], positions[i3 + 2]);
    twists[i] = (Math.random() - 0.5) * 0.9;

    const midMix = Math.min(1, (r / radius) * 1.6);
    const color = inner.clone().lerp(middle, midMix).lerp(outer, Math.max(0, (r / radius) - 0.45));
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.userData = { basePositions, radii, twists };
  scene.add(points);
  return points;
}

function createSolarSystem() {
  const group = new THREE.Group();
  group.position.set(0, -2, -3);
  group.visible = false;

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xffcc5c, emissive: 0xffa500, emissiveIntensity: 0.6 }),
  );
  group.add(sun);

  const planetDefs = [
    { radius: 0.24, distance: 2.3, speed: 1.6, color: 0x8bc6ff },
    { radius: 0.34, distance: 3.3, speed: 1.2, color: 0xff8bb3 },
    { radius: 0.42, distance: 4.5, speed: 0.9, color: 0x91ffcf },
    { radius: 0.62, distance: 6.2, speed: 0.65, color: 0xd0b3ff },
  ];

  const planets = [];
  for (const def of planetDefs) {
    const orbitPivot = new THREE.Object3D();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(def.radius, 20, 20),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.6, metalness: 0.1 }),
    );
    mesh.position.x = def.distance;
    orbitPivot.add(mesh);
    group.add(orbitPivot);
    planets.push({ orbitPivot, mesh, speed: def.speed, angle: Math.random() * Math.PI * 2, isGrabbed: false });
  }

  group.userData.planets = planets;
  scene.add(group);
  return group;
}

function createFlowerWorld() {
  const group = new THREE.Group();
  group.position.set(0, -0.5, -2.8);
  group.visible = false;
  group.userData = { center: null, petals: [], bloomRoot: null, variant: FLOWER_VARIANTS[0] };
  applyFlowerVariant(group, FLOWER_VARIANTS[0]);
  scene.add(group);
  return group;
}

function addPetalRing(root, petals, options) {
  const {
    count,
    radius,
    size,
    color,
    y = 0,
    jitter = 0.06,
    tilt = Math.PI / 2.5,
    roughness = 0.52,
    wave = 0.035,
  } = options;

  for (let i = 0; i < count; i += 1) {
    const petal = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 22, 22),
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: 0.02,
        emissive: new THREE.Color(color).multiplyScalar(0.05),
      }),
    );
    const angle = (i / count) * Math.PI * 2;
    const localRadius = radius + (Math.random() - 0.5) * jitter;
    petal.position.set(
      Math.cos(angle) * localRadius,
      y + Math.sin(i * 0.45) * wave,
      Math.sin(angle) * localRadius,
    );
    petal.scale.set(size[0], size[1], size[2]);
    petal.rotation.z = angle;
    petal.rotation.x = tilt;
    petal.userData.baseScaleX = size[0];
    petal.userData.baseScaleY = size[1];
    petal.userData.baseScaleZ = size[2];
    root.add(petal);
    petals.push(petal);
  }
}

function applyFlowerVariant(group, variantName) {
  if (!group) return;

  if (group.userData.bloomRoot) {
    group.remove(group.userData.bloomRoot);
    disposeObject3D(group.userData.bloomRoot);
  }

  const bloomRoot = new THREE.Group();
  const petals = [];
  let center = null;

  switch (variantName) {
    case 'rose':
      addPetalRing(bloomRoot, petals, { count: 24, radius: 1.55, size: [2.15, 0.84, 0.96], color: 0xe74d6f, y: 0.01, tilt: Math.PI / 2.75 });
      addPetalRing(bloomRoot, petals, { count: 18, radius: 1.16, size: [1.72, 0.74, 0.9], color: 0xf06788, y: 0.12, tilt: Math.PI / 2.85 });
      addPetalRing(bloomRoot, petals, { count: 12, radius: 0.82, size: [1.28, 0.66, 0.82], color: 0xff8ca2, y: 0.2, tilt: Math.PI / 3.1 });
      center = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0xb7314f, roughness: 0.7, emissive: 0x651a2b, emissiveIntensity: 0.18 }),
      );
      center.scale.set(1, 0.9, 1);
      break;
    case 'sunflower':
      addPetalRing(bloomRoot, petals, { count: 30, radius: 2.05, size: [2.35, 0.7, 0.86], color: 0xffc739, y: 0.04, tilt: Math.PI / 2.45, roughness: 0.6 });
      addPetalRing(bloomRoot, petals, { count: 22, radius: 1.6, size: [1.8, 0.6, 0.8], color: 0xffd95e, y: 0.07, tilt: Math.PI / 2.55, roughness: 0.63 });
      center = new THREE.Mesh(
        new THREE.SphereGeometry(1.12, 36, 36),
        new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.95, emissive: 0x1f1208, emissiveIntensity: 0.15 }),
      );
      center.scale.set(1, 0.88, 1);
      break;
    case 'lotus':
      addPetalRing(bloomRoot, petals, { count: 18, radius: 1.95, size: [2.0, 0.72, 0.92], color: 0xffaacb, y: -0.02, tilt: Math.PI / 2.15 });
      addPetalRing(bloomRoot, petals, { count: 14, radius: 1.36, size: [1.58, 0.66, 0.84], color: 0xffbed8, y: 0.12, tilt: Math.PI / 2.2 });
      addPetalRing(bloomRoot, petals, { count: 10, radius: 0.92, size: [1.2, 0.58, 0.76], color: 0xffd3e6, y: 0.22, tilt: Math.PI / 2.3 });
      center = new THREE.Mesh(
        new THREE.SphereGeometry(0.78, 28, 28),
        new THREE.MeshStandardMaterial({ color: 0xf9dc7a, roughness: 0.82, emissive: 0xd2b04b, emissiveIntensity: 0.15 }),
      );
      center.scale.set(1, 0.94, 1);
      break;
    case 'daisy':
      addPetalRing(bloomRoot, petals, { count: 26, radius: 1.82, size: [2.08, 0.62, 0.82], color: 0xf8f8ff, y: 0.02, tilt: Math.PI / 2.35, roughness: 0.5 });
      addPetalRing(bloomRoot, petals, { count: 18, radius: 1.32, size: [1.45, 0.54, 0.72], color: 0xffffff, y: 0.11, tilt: Math.PI / 2.45, roughness: 0.48 });
      center = new THREE.Mesh(
        new THREE.SphereGeometry(0.94, 30, 30),
        new THREE.MeshStandardMaterial({ color: 0xffd648, roughness: 0.75, emissive: 0xd79e22, emissiveIntensity: 0.2 }),
      );
      center.scale.set(1, 0.9, 1);
      break;
    case 'camellia':
      addPetalRing(bloomRoot, petals, { count: 22, radius: 1.7, size: [1.95, 0.82, 0.95], color: 0xff90ad, y: 0.03, tilt: Math.PI / 2.7 });
      addPetalRing(bloomRoot, petals, { count: 16, radius: 1.18, size: [1.55, 0.72, 0.84], color: 0xffa8c0, y: 0.14, tilt: Math.PI / 2.85 });
      addPetalRing(bloomRoot, petals, { count: 12, radius: 0.8, size: [1.2, 0.62, 0.72], color: 0xffbfd3, y: 0.2, tilt: Math.PI / 3 });
      center = new THREE.Mesh(
        new THREE.SphereGeometry(0.52, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0xf8cfde, roughness: 0.72, emissive: 0xd98ea4, emissiveIntensity: 0.14 }),
      );
      center.scale.set(1, 0.92, 1);
      break;
    default:
      addPetalRing(bloomRoot, petals, { count: 28, radius: 1.75, size: [2.12, 0.72, 0.9], color: 0xffa9df, y: 0.02, tilt: Math.PI / 2.55 });
      addPetalRing(bloomRoot, petals, { count: 20, radius: 1.22, size: [1.62, 0.62, 0.78], color: 0xffc3e8, y: 0.1, tilt: Math.PI / 2.65 });
      addPetalRing(bloomRoot, petals, { count: 14, radius: 0.88, size: [1.22, 0.56, 0.72], color: 0xffd8f1, y: 0.19, tilt: Math.PI / 2.8 });
      center = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 26, 26),
        new THREE.MeshStandardMaterial({ color: 0xfff0a6, roughness: 0.8, emissive: 0xe8bf5a, emissiveIntensity: 0.14 }),
      );
      center.scale.set(1, 0.92, 1);
      break;
  }

  center.userData.baseScaleX = center.scale.x;
  center.userData.baseScaleY = center.scale.y;
  center.userData.baseScaleZ = center.scale.z;
  bloomRoot.add(center);
  group.add(bloomRoot);
  group.userData.center = center;
  group.userData.petals = petals;
  group.userData.bloomRoot = bloomRoot;
  group.userData.variant = variantName;
}

function cycleFlowerVariant() {
  if (!flowerWorld) return;
  const now = performance.now();
  if (now - flowerControl.lastVariantSwitchMs < 700) return;

  flowerControl.lastVariantSwitchMs = now;
  flowerControl.variantIndex = (flowerControl.variantIndex + 1) % FLOWER_VARIANTS.length;
  const variantName = FLOWER_VARIANTS[flowerControl.variantIndex];
  applyFlowerVariant(flowerWorld, variantName);
  setStatus(`Flower changed: ${variantName}. Open palm again to switch.`);
}

function createButterflySystem() {
  const group = new THREE.Group();
  group.position.set(0, 0.2, -1.8);
  group.visible = false;

  const defs = [
    { radius: 3.2, y: 0.4, speed: 1.1, color: 0x95e8ff },
    { radius: 4.1, y: 1.1, speed: 0.85, color: 0xffb2f6 },
    { radius: 2.6, y: -0.2, speed: 1.3, color: 0xfff08f },
    { radius: 3.7, y: 0.7, speed: 1.0, color: 0xc3ffc5 },
  ];

  const butterflies = [];
  for (const def of defs) {
    const pivot = new THREE.Object3D();
    const b = new THREE.Group();

    const thorax = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.32, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x211a2f, roughness: 0.55, metalness: 0.08 }),
    );
    thorax.rotation.z = Math.PI / 2;
    b.add(thorax);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x2c2242, roughness: 0.45 }),
    );
    head.position.x = 0.2;
    b.add(head);

    const abdomen = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.06, 0.34, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x1c1628, roughness: 0.62 }),
    );
    abdomen.rotation.z = Math.PI / 2;
    abdomen.position.x = -0.18;
    b.add(abdomen);

    const antennaMat = new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 0.7 });
    const antennaL = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 8), antennaMat);
    antennaL.position.set(0.24, 0.05, 0.03);
    antennaL.rotation.z = -0.45;
    antennaL.rotation.x = 0.35;
    const antennaR = antennaL.clone();
    antennaR.position.z = -0.03;
    antennaR.rotation.x = -0.35;
    b.add(antennaL, antennaR);

    const wingColor = new THREE.Color(def.color);
    const foreWingGeo = new THREE.SphereGeometry(0.26, 18, 18, 0, Math.PI);
    const hindWingGeo = new THREE.SphereGeometry(0.2, 16, 16, 0, Math.PI);
    const wingMat = new THREE.MeshStandardMaterial({
      color: wingColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
      roughness: 0.38,
      metalness: 0.06,
      emissive: wingColor.clone().multiplyScalar(0.12),
    });

    const wingRootL = new THREE.Group();
    const foreWingL = new THREE.Mesh(foreWingGeo, wingMat.clone());
    foreWingL.scale.set(1.35, 1.05, 0.22);
    foreWingL.rotation.set(Math.PI / 2, 0.25, Math.PI / 2);
    foreWingL.position.set(-0.02, 0.08, 0.19);
    const hindWingL = new THREE.Mesh(hindWingGeo, wingMat.clone());
    hindWingL.scale.set(1.2, 0.9, 0.22);
    hindWingL.rotation.set(Math.PI / 2, -0.1, Math.PI / 2);
    hindWingL.position.set(-0.09, -0.02, 0.15);
    wingRootL.add(foreWingL, hindWingL);
    wingRootL.position.set(0.02, 0, 0);

    const wingRootR = wingRootL.clone();
    wingRootR.scale.z = -1;

    b.add(wingRootL, wingRootR);
    b.position.set(def.radius, def.y, 0);
    pivot.add(b);
    group.add(pivot);

    butterflies.push({
      pivot,
      body: thorax,
      wingRootL,
      wingRootR,
      foreWingL,
      hindWingL,
      radius: def.radius,
      baseY: def.y,
      speed: def.speed,
      angle: Math.random() * Math.PI * 2,
      flapPhase: Math.random() * Math.PI * 2,
      bobPhase: Math.random() * Math.PI * 2,
      isGrabbed: false,
    });
  }

  group.userData.butterflies = butterflies;
  scene.add(group);
  return group;
}

function createSkeletonWorld() {
  const root = new THREE.Group();
  root.position.set(0, -2.55, -2.8);
  root.scale.setScalar(1.35);
  root.visible = false;

  const boneMat = new THREE.MeshStandardMaterial({ color: 0xf0eee7, roughness: 0.42, metalness: 0.03 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f1e1b, roughness: 0.85, metalness: 0.01 });

  function addJoint(radius, x, y, z, parent = root) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 20), boneMat.clone());
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  function addBone(radiusTop, radiusBottom, length, x, y, z, rotX, rotY, rotZ, parent = root) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry((radiusTop + radiusBottom) * 0.5, length - radiusTop, 6, 12), boneMat.clone());
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, rotY, rotZ);
    parent.add(mesh);
    return mesh;
  }

  const hips = addJoint(0.24, 0, 0.08, 0);

  const pelvis = new THREE.Group();
  const iliacL = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 10, 20, Math.PI * 1.15), boneMat.clone());
  iliacL.rotation.set(Math.PI / 2.05, 0, Math.PI / 2.6);
  iliacL.position.set(-0.17, 0.05, 0.02);
  const iliacR = iliacL.clone();
  iliacR.position.x *= -1;
  iliacR.rotation.z *= -1;
  const sacrum = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.28, 4, 10), boneMat.clone());
  sacrum.position.set(0, -0.03, -0.02);
  sacrum.rotation.x = Math.PI / 2;
  pelvis.add(iliacL, iliacR, sacrum);
  root.add(pelvis);

  const spine = addBone(0.075, 0.085, 1.48, 0, 0.9, 0, 0, 0, 0);
  const vertebrae = [];
  for (let i = 0; i < 7; i += 1) {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.085 - i * 0.005, 0.085 - i * 0.005, 0.05, 10), boneMat.clone());
    v.position.set(0, 0.35 + i * 0.2, 0);
    vertebrae.push(v);
    root.add(v);
  }

  const chest = addJoint(0.2, 0, 1.68, 0);

  const ribCage = new THREE.Group();
  for (let i = 0; i < 6; i += 1) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.43 - i * 0.035, 0.018, 8, 20, Math.PI * 1.2), boneMat.clone());
    r.rotation.set(Math.PI / 2, 0, Math.PI + 0.23);
    r.position.set(0, 1.68 - i * 0.11, -0.02 + i * 0.01);
    ribCage.add(r);
  }
  root.add(ribCage);

  const neck = addBone(0.05, 0.055, 0.28, 0, 2.02, 0, 0, 0, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 30, 30), boneMat.clone());
  head.scale.set(1, 1.1, 1.15);
  head.position.set(0, 2.45, 0.01);
  root.add(head);

  const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 10, 18, Math.PI * 1.1), boneMat.clone());
  jaw.position.set(0, 2.28, 0.13);
  jaw.rotation.set(Math.PI / 2.2, 0, 0);
  root.add(jaw);

  const eyeSocketL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), darkMat);
  const eyeSocketR = eyeSocketL.clone();
  eyeSocketL.position.set(-0.11, 2.46, 0.29);
  eyeSocketR.position.set(0.11, 2.46, 0.29);
  root.add(eyeSocketL, eyeSocketR);
  const noseHole = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.08, 3), darkMat);
  noseHole.position.set(0, 2.37, 0.32);
  noseHole.rotation.x = Math.PI / 2;
  root.add(noseHole);

  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.03), boneMat.clone());
  teeth.position.set(0, 2.18, 0.2);
  root.add(teeth);

  const clavicle = new THREE.Group();
  const clavicleL = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.35, 4, 10), boneMat.clone());
  clavicleL.position.set(-0.2, 1.78, 0.04);
  clavicleL.rotation.z = Math.PI / 3.6;
  const clavicleR = clavicleL.clone();
  clavicleR.position.x *= -1;
  clavicleR.rotation.z *= -1;
  clavicle.add(clavicleL, clavicleR);
  root.add(clavicle);
  const shoulderL = addJoint(0.13, -0.54, 1.66, 0);
  const shoulderR = addJoint(0.13, 0.54, 1.66, 0);
  const upperArmL = addBone(0.065, 0.055, 0.72, -0.84, 1.4, 0, 0, 0, 0.42);
  const upperArmR = addBone(0.065, 0.055, 0.72, 0.84, 1.4, 0, 0, 0, -0.42);
  const foreArmL = addBone(0.055, 0.045, 0.68, -1.2, 0.95, 0, 0, 0, 0.08);
  const foreArmR = addBone(0.055, 0.045, 0.68, 1.2, 0.95, 0, 0, 0, -0.08);
  const handL = addJoint(0.085, -1.37, 0.62, 0);
  const handR = addJoint(0.085, 1.37, 0.62, 0);

  for (let i = 0; i < 4; i += 1) {
    const fingerL = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.11, 3, 8), boneMat.clone());
    fingerL.position.set(-1.43 - i * 0.012, 0.56 - i * 0.01, 0.05 - i * 0.035);
    fingerL.rotation.set(0.08, 0, 0.5);
    const fingerR = fingerL.clone();
    fingerR.position.x *= -1;
    fingerR.rotation.z *= -1;
    root.add(fingerL, fingerR);
  }

  const thighL = addBone(0.1, 0.08, 1.0, -0.24, -0.62, 0, 0, 0, 0.06);
  const thighR = addBone(0.1, 0.08, 1.0, 0.24, -0.62, 0, 0, 0, -0.06);
  const kneeL = addJoint(0.11, -0.3, -1.1, 0);
  const kneeR = addJoint(0.11, 0.3, -1.1, 0);
  const shinL = addBone(0.08, 0.06, 1.0, -0.33, -1.62, 0, 0, 0, 0.03);
  const shinR = addBone(0.08, 0.06, 1.0, 0.33, -1.62, 0, 0, 0, -0.03);
  const ankleL = addJoint(0.08, -0.35, -2.1, 0.03);
  const ankleR = addJoint(0.08, 0.35, -2.1, 0.03);
  const footL = addBone(0.05, 0.04, 0.56, -0.4, -2.15, 0.21, Math.PI / 2.35, 0, 0);
  const footR = addBone(0.05, 0.04, 0.56, 0.4, -2.15, 0.21, Math.PI / 2.35, 0, 0);

  for (let i = 0; i < 5; i += 1) {
    const toeL = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.08, 3, 8), boneMat.clone());
    toeL.position.set(-0.56 - i * 0.04, -2.17, 0.22 - i * 0.03);
    toeL.rotation.set(Math.PI / 2.35, 0, 0);
    const toeR = toeL.clone();
    toeR.position.x *= -1;
    root.add(toeL, toeR);
  }

  const stage = new THREE.Mesh(
    new THREE.CircleGeometry(2.95, 48),
    new THREE.MeshStandardMaterial({
      color: 0x171822,
      roughness: 0.82,
      metalness: 0.06,
      emissive: 0x0f111b,
      emissiveIntensity: 0.32,
      transparent: true,
      opacity: 0.94,
    }),
  );
  stage.rotation.x = -Math.PI / 2;
  stage.position.set(0, -2.33, 0.03);
  root.add(stage);

  const stageRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.55, 0.06, 12, 64),
    new THREE.MeshStandardMaterial({
      color: 0x8cb8ff,
      roughness: 0.4,
      metalness: 0.15,
      emissive: 0x5a88d8,
      emissiveIntensity: 0.28,
      transparent: true,
      opacity: 0.88,
    }),
  );
  stageRing.rotation.x = Math.PI / 2;
  stageRing.position.set(0, -2.31, 0.04);
  root.add(stageRing);

  const defaultPose = {
    chestZ: 0,
    chestY: 0,
    headY: 0,
    headX: 0,
    hipsX: 0,
    hipsY: 0,
    hipsZ: 0,
    pelvisX: 0,
    pelvisY: 0,
    pelvisZ: 0,
    spineX: 0,
    spineY: 0,
    ribCageY: 0,
    ribCageZ: 0,
    neckX: 0,
    neckY: 0,
    clavicleZ: 0,
    jawX: Math.PI / 2.1,
    upperArmLX: 0,
    upperArmRX: 0,
    upperArmLY: 0,
    upperArmRY: 0,
    upperArmLZ: 0.42,
    upperArmRZ: -0.42,
    foreArmLX: 0,
    foreArmRX: 0,
    foreArmLZ: 0.08,
    foreArmRZ: -0.08,
    handLX: 0,
    handRX: 0,
    handLZ: 0,
    handRZ: 0,
    thighLX: 0,
    thighRX: 0,
    thighLZ: 0.06,
    thighRZ: -0.06,
    shinLX: 0,
    shinRX: 0,
    shinLZ: 0.03,
    shinRZ: -0.03,
    footLX: Math.PI / 2.35,
    footRX: Math.PI / 2.35,
    footLZ: 0,
    footRZ: 0,
  };

  root.userData = {
    hips,
    pelvis,
    chest,
    ribCage,
    vertebrae,
    clavicle,
    spine,
    neck,
    jaw,
    head,
    shoulderL,
    shoulderR,
    upperArmL,
    upperArmR,
    foreArmL,
    foreArmR,
    handL,
    handR,
    thighL,
    thighR,
    kneeL,
    kneeR,
    shinL,
    shinR,
    ankleL,
    ankleR,
    footL,
    footR,
    stage,
    stageRing,
    defaultPose,
  };

  scene.add(root);
  return root;
}

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}

function isPinch(landmarks) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  if (!thumb || !index) return false;
  const d = Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z);
  return d < 0.05;
}

function isFist(landmarks) {
  const tipIds = [8, 12, 16, 20];
  const mcpIds = [5, 9, 13, 17];
  let curled = 0;

  for (let i = 0; i < tipIds.length; i += 1) {
    const tip = landmarks[tipIds[i]];
    const mcp = landmarks[mcpIds[i]];
    if (!tip || !mcp) continue;
    const d = Math.hypot(tip.x - mcp.x, tip.y - mcp.y, tip.z - mcp.z);
    if (d < 0.13) curled += 1;
  }

  return curled >= 3;
}

function isOpenPalm(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const wrist = landmarks[0];
  const tipIds = [8, 12, 16, 20];

  let extended = 0;
  for (const tipId of tipIds) {
    const tip = landmarks[tipId];
    const dist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y, tip.z - wrist.z);
    if (dist > 0.24) extended += 1;
  }

  return extended >= 3;
}

function drawLandmarks(hands) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!hands?.length) return;

  const colors = ['rgba(77, 255, 208, 0.9)', 'rgba(255, 188, 77, 0.9)'];
  hands.forEach((landmarks, handIndex) => {
    overlayCtx.fillStyle = colors[handIndex] ?? 'rgba(180, 200, 255, 0.9)';
    for (const lm of landmarks) {
      const x = (1 - lm.x) * overlayCanvas.width;
      const y = lm.y * overlayCanvas.height;
      overlayCtx.beginPath();
      overlayCtx.arc(x, y, 4, 0, Math.PI * 2);
      overlayCtx.fill();
    }
  });
}

function getPinchNdc(landmarks) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  if (!thumb || !index) return null;
  const pinchX = (thumb.x + index.x) * 0.5;
  const pinchY = (thumb.y + index.y) * 0.5;
  const mirroredX = 1 - pinchX;
  return { x: mirroredX * 2 - 1, y: -(pinchY * 2 - 1) };
}

function worldPointFromNdcOnZPlane(ndcX, ndcY, planeZ) {
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}

function dropGrabbedItem() {
  if (!grabState.item) return;
  grabState.item.isGrabbed = false;
  grabState.item = null;
  grabState.kind = null;
}

function tryGrabItem(landmarks) {
  const ndc = getPinchNdc(landmarks);
  if (!ndc || grabState.item) return;

  let meshes = [];
  if (activeMode === 'galaxy' && solarSystem) meshes = (solarSystem.userData.planets ?? []).map((p) => p.mesh);
  if (activeMode === 'flower' && butterflySystem) meshes = (butterflySystem.userData.butterflies ?? []).map((b) => b.body);

  if (!meshes.length) return;

  raycaster.setFromCamera({ x: ndc.x, y: ndc.y }, camera);
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return;

  const selectedMesh = hits[0].object;

  if (activeMode === 'galaxy' && solarSystem) {
    const selected = (solarSystem.userData.planets ?? []).find((p) => p.mesh === selectedMesh);
    if (!selected) return;
    selected.isGrabbed = true;
    const worldPos = new THREE.Vector3();
    selected.mesh.getWorldPosition(worldPos);
    grabState.item = selected;
    grabState.kind = 'planet';
    grabState.grabPlaneZ = worldPos.z;
    return;
  }

  if (activeMode === 'flower' && butterflySystem) {
    const selected = (butterflySystem.userData.butterflies ?? []).find((b) => b.body === selectedMesh);
    if (!selected) return;
    selected.isGrabbed = true;
    const worldPos = new THREE.Vector3();
    selected.pivot.getWorldPosition(worldPos);
    grabState.item = selected;
    grabState.kind = 'butterfly';
    grabState.grabPlaneZ = worldPos.z;
  }
}

function updateGrabbedItem(landmarks) {
  if (!grabState.item || !grabState.kind) return;
  const ndc = getPinchNdc(landmarks);
  if (!ndc) return;

  const worldPoint = worldPointFromNdcOnZPlane(ndc.x, ndc.y, grabState.grabPlaneZ);
  if (!worldPoint) return;

  if (grabState.kind === 'planet') {
    const localPoint = grabState.item.orbitPivot.worldToLocal(worldPoint.clone());
    grabState.item.mesh.position.copy(localPoint);
    return;
  }

  if (grabState.kind === 'butterfly' && butterflySystem) {
    const localPoint = butterflySystem.worldToLocal(worldPoint.clone());
    grabState.item.pivot.position.copy(localPoint);
  }
}

function updatePrimaryFromHand(landmarks) {
  if (!landmarks) return;

  const wrist = landmarks[0];
  const x = wrist ? (1 - wrist.x - 0.5) * 2 : 0;
  const y = wrist ? (wrist.y - 0.5) * 2 : 0;
  const pinch = isPinch(landmarks);
  const fist = isFist(landmarks);
  const openPalm = isOpenPalm(landmarks);

  if (activeMode === 'galaxy' && galaxy) {
    galaxy.rotation.y = x * 0.9;
    galaxy.rotation.x = y * 0.5;
    galaxyControl.targetScale = pinch ? 1.7 : 1;
    galaxyControl.spinBoost = fist ? 0.06 : 0.012;
    galaxyControl.colorShiftActive = openPalm;

    const palmOpen = landmarks[9] && landmarks[0]
      ? Math.hypot(
          landmarks[9].x - landmarks[0].x,
          landmarks[9].y - landmarks[0].y,
          landmarks[9].z - landmarks[0].z,
        )
      : 0.12;
    galaxyControl.depthSpeed = THREE.MathUtils.clamp(0.015 + palmOpen * 0.35, 0.015, 0.1);
  }

  if (activeMode === 'flower' && flowerWorld) {
    flowerWorld.rotation.y = x * 0.8;
    flowerWorld.rotation.x = y * 0.35;
    flowerControl.targetScale = pinch ? 1.45 : 1;
    flowerControl.spinBoost = fist ? 0.045 : 0.01;
    if (openPalm && !flowerControl.openPalmHeld) {
      cycleFlowerVariant();
    }
    flowerControl.openPalmHeld = openPalm;
  }

  if (activeMode === 'skeleton' && skeletonWorld) {
    skeletonControl.targetScale = pinch ? 1.55 : 1.15;
    skeletonControl.danceActive = openPalm;
  }
}

function updateCompanionFromHand(landmarks) {
  if (activeMode === 'skeleton') {
    dropGrabbedItem();
    grabState.pinchActive = false;
    return;
  }

  if (!landmarks) {
    dropGrabbedItem();
    grabState.pinchActive = false;
    return;
  }

  const wrist = landmarks[0];
  if (wrist) {
    companionControl.tiltY = (1 - wrist.x - 0.5) * 2 * 0.75;
    companionControl.tiltX = (wrist.y - 0.5) * 2 * 0.45;
  }

  companionControl.motionSpeed = isFist(landmarks) ? 0.04 : 0.01;

  const pinchNow = isPinch(landmarks);
  if (pinchNow && !grabState.pinchActive) tryGrabItem(landmarks);
  if (pinchNow) updateGrabbedItem(landmarks);
  if (!pinchNow && grabState.pinchActive) dropGrabbedItem();
  grabState.pinchActive = pinchNow;
}

function ensureModeObjects() {
  if (!galaxy) galaxy = createGalaxy();
  if (!solarSystem) solarSystem = createSolarSystem();
  if (!flowerWorld) flowerWorld = createFlowerWorld();
  if (!butterflySystem) butterflySystem = createButterflySystem();
  if (!skeletonWorld) skeletonWorld = createSkeletonWorld();
}

function setModeVisibility(visible) {
  if (galaxy) galaxy.visible = visible && activeMode === 'galaxy';
  if (solarSystem) solarSystem.visible = visible && activeMode === 'galaxy';
  if (flowerWorld) flowerWorld.visible = visible && activeMode === 'flower';
  if (butterflySystem) butterflySystem.visible = visible && activeMode === 'flower';
  if (skeletonWorld) skeletonWorld.visible = visible && activeMode === 'skeleton';
}

function switchMode(mode) {
  if (mode === activeMode) return;
  activeMode = mode;
  dropGrabbedItem();
  grabState.pinchActive = false;
  flowerControl.openPalmHeld = false;
  skeletonControl.danceActive = false;
  ensureModeObjects();
  setModeVisibility(Boolean(detectedHands[0]));
  setActiveModeButton();
  if (activeMode === 'galaxy') {
    setStatus('Galaxy mode selected. Hand 1 galaxy, hand 2 planets.');
  } else if (activeMode === 'flower') {
    setStatus('Flower mode selected. Open palm to switch flower type.');
  } else {
    setStatus('Skeleton mode selected. Open palm to make it dance.');
  }
}

function animateGalaxy(t) {
  if (!galaxy?.visible) return;

  galaxyControl.currentScale += (galaxyControl.targetScale - galaxyControl.currentScale) * 0.14;
  const pulse = 1 + Math.sin(t * 2.2) * 0.045;
  galaxy.scale.setScalar(galaxyControl.currentScale * pulse);
  galaxy.rotation.z += galaxyControl.spinBoost * 0.9;

  const pos = galaxy.geometry.attributes.position.array;
  const { basePositions, radii, twists } = galaxy.userData;
  const swirlSpeed = THREE.MathUtils.mapLinear(galaxyControl.depthSpeed, 0.015, 0.1, 0.5, 2);

  for (let i = 0; i < radii.length; i += 1) {
    const i3 = i * 3;
    const bx = basePositions[i3];
    const by = basePositions[i3 + 1];
    const bz = basePositions[i3 + 2];
    const r = radii[i];
    const baseAngle = Math.atan2(bz, bx);
    const angle = baseAngle + t * (0.1 * swirlSpeed + r * 0.0028) + twists[i];
    const wobble = 1 + Math.sin(t * 1.8 + twists[i] * 8 + r * 0.85) * 0.06;

    pos[i3] = Math.cos(angle) * r * wobble + Math.sin(t * 0.8 + i * 0.013) * 0.02;
    pos[i3 + 1] = by + Math.sin(t * 1.4 + r * 0.7 + twists[i] * 3) * 0.04;
    pos[i3 + 2] = Math.sin(angle) * r * wobble;
  }

  galaxy.geometry.attributes.position.needsUpdate = true;
  galaxy.material.opacity = 0.82 + Math.sin(t * 2.1) * 0.12;

  if (galaxyControl.colorShiftActive) {
    galaxyControl.colorHue = (galaxyControl.colorHue + 0.003) % 1;
    galaxy.material.color.setHSL(galaxyControl.colorHue, 0.85, 0.7);
  } else {
    galaxy.material.color.lerp(new THREE.Color(0xffffff), 0.08);
  }
}

function animatePlanets() {
  if (!solarSystem?.visible) return;

  solarSystem.rotation.x += (companionControl.tiltX - solarSystem.rotation.x) * 0.1;
  solarSystem.rotation.y += (companionControl.tiltY - solarSystem.rotation.y) * 0.1;

  const planets = solarSystem.userData.planets ?? [];
  for (const planet of planets) {
    if (planet.isGrabbed) continue;
    planet.angle += planet.speed * companionControl.motionSpeed;
    planet.orbitPivot.rotation.y = planet.angle;
  }
}

function animateFlower(t) {
  if (!flowerWorld?.visible) return;

  flowerControl.currentScale += (flowerControl.targetScale - flowerControl.currentScale) * 0.12;
  const bloomPulse = 1 + Math.sin(t * 2.8) * 0.035;
  flowerWorld.scale.setScalar(flowerControl.currentScale * bloomPulse * 1.38);
  flowerWorld.rotation.z += flowerControl.spinBoost * 0.3;

  const petals = flowerWorld.userData.petals ?? [];
  petals.forEach((petal, idx) => {
    const wobble = 1 + Math.sin(t * 3.2 + idx * 0.7) * 0.06;
    petal.scale.x = petal.userData.baseScaleX * wobble;
    petal.scale.y = petal.userData.baseScaleY + Math.sin(t * 2.5 + idx) * 0.03;
    petal.scale.z = petal.userData.baseScaleZ;
  });

  const center = flowerWorld.userData.center;
  if (center) {
    const p = 1 + Math.sin(t * 2.2) * 0.03;
    center.scale.set(
      center.userData.baseScaleX * p,
      center.userData.baseScaleY * p,
      center.userData.baseScaleZ * p,
    );
    center.material.emissiveIntensity = 0.12 + Math.sin(t * 1.7) * 0.05;
  }
}

function animateButterflies(t) {
  if (!butterflySystem?.visible) return;

  butterflySystem.rotation.x += (companionControl.tiltX - butterflySystem.rotation.x) * 0.09;
  butterflySystem.rotation.y += (companionControl.tiltY - butterflySystem.rotation.y) * 0.09;

  const butterflies = butterflySystem.userData.butterflies ?? [];
  for (const b of butterflies) {
    if (!b.isGrabbed) {
      b.angle += b.speed * companionControl.motionSpeed * 0.55;
      b.pivot.position.x = Math.cos(b.angle) * b.radius;
      b.pivot.position.z = Math.sin(b.angle) * b.radius;
      b.pivot.position.y = b.baseY + Math.sin(t * 2.2 + b.angle * 1.5 + b.bobPhase) * 0.35;
      b.pivot.lookAt(0, b.pivot.position.y, 0);
      b.body.rotation.y = Math.sin(t * 5 + b.bobPhase) * 0.12;
      b.body.rotation.x = Math.sin(t * 3 + b.bobPhase) * 0.06;
    }

    const flap = Math.sin(t * 17 + b.flapPhase) * 0.9;
    const glide = Math.cos(t * 8 + b.flapPhase) * 0.08;
    b.wingRootL.rotation.y = flap + 0.25 + glide;
    b.wingRootR.rotation.y = -flap - 0.25 - glide;
    b.foreWingL.rotation.x = Math.PI / 2 + Math.sin(t * 9 + b.flapPhase) * 0.12;
    b.hindWingL.rotation.x = Math.PI / 2 + Math.sin(t * 9 + b.flapPhase + 0.5) * 0.1;
  }
}

function animateSkeleton(t) {
  if (!skeletonWorld?.visible) return;

  skeletonControl.currentScale += (skeletonControl.targetScale - skeletonControl.currentScale) * 0.12;
  const basePulse = 1 + Math.sin(t * 1.4) * 0.01;
  skeletonWorld.scale.setScalar(skeletonControl.currentScale * basePulse * 1.35);

  const s = skeletonWorld.userData;
  if (!s) return;
  const p = s.defaultPose;
  if (!p) return;

  const settle = (value, target, speed = 0.12) => value + (target - value) * speed;
  const dance = skeletonControl.danceActive;
  const beat = t * 7.2;
  const groove = Math.sin(beat);
  const counter = Math.sin(beat + Math.PI * 0.5);
  const accent = Math.max(0, Math.sin(beat * 2));
  const sweep = Math.sin(beat * 0.5 + Math.PI * 0.2);

  const rootXTarget = dance ? groove * 0.26 : 0;
  const rootYTarget = dance ? -2.55 + accent * 0.22 : -2.55;
  const rootRotYTarget = dance ? counter * 0.2 : 0;
  const rootRotZTarget = dance ? groove * 0.1 : 0;

  skeletonWorld.position.x = settle(skeletonWorld.position.x, rootXTarget, dance ? 0.18 : 0.12);
  skeletonWorld.position.y = settle(skeletonWorld.position.y, rootYTarget, dance ? 0.2 : 0.12);
  skeletonWorld.rotation.x = settle(skeletonWorld.rotation.x, 0, 0.16);
  skeletonWorld.rotation.y = settle(skeletonWorld.rotation.y, rootRotYTarget, dance ? 0.18 : 0.12);
  skeletonWorld.rotation.z = settle(skeletonWorld.rotation.z, rootRotZTarget, dance ? 0.18 : 0.12);

  if (dance) {
    const armDriveL = Math.sin(beat * 1.2 + Math.PI * 0.25);
    const armDriveR = Math.sin(beat * 1.2 + Math.PI * 1.25);
    const elbowSwingL = Math.sin(beat * 1.9 + Math.PI * 0.15);
    const elbowSwingR = Math.sin(beat * 1.9 + Math.PI * 1.15);
    const legDriveL = Math.sin(beat);
    const legDriveR = Math.sin(beat + Math.PI);
    const kickL = Math.max(0, Math.sin(beat * 1.6 + Math.PI * 0.15));
    const kickR = Math.max(0, Math.sin(beat * 1.6 + Math.PI * 1.15));

    s.hips.rotation.x = settle(s.hips.rotation.x, p.hipsX + accent * 0.05, 0.2);
    s.hips.rotation.y = settle(s.hips.rotation.y, p.hipsY + counter * 0.15, 0.2);
    s.hips.rotation.z = settle(s.hips.rotation.z, p.hipsZ + groove * 0.18, 0.2);
    s.pelvis.rotation.x = settle(s.pelvis.rotation.x, p.pelvisX + accent * 0.08, 0.22);
    s.pelvis.rotation.y = settle(s.pelvis.rotation.y, p.pelvisY + counter * 0.18, 0.22);
    s.pelvis.rotation.z = settle(s.pelvis.rotation.z, p.pelvisZ + groove * 0.16, 0.22);
    s.spine.rotation.x = settle(s.spine.rotation.x, p.spineX + accent * 0.07, 0.2);
    s.spine.rotation.y = settle(s.spine.rotation.y, p.spineY + counter * 0.14, 0.2);
    s.ribCage.rotation.y = settle(s.ribCage.rotation.y, p.ribCageY - counter * 0.24, 0.22);
    s.ribCage.rotation.z = settle(s.ribCage.rotation.z, p.ribCageZ - groove * 0.18, 0.22);
    s.chest.rotation.z = settle(s.chest.rotation.z, p.chestZ - groove * 0.22 + Math.sin(beat * 2) * 0.06, 0.24);
    s.chest.rotation.y = settle(s.chest.rotation.y, p.chestY + counter * 0.22, 0.24);
    s.clavicle.rotation.z = settle(s.clavicle.rotation.z, p.clavicleZ + groove * 0.09, 0.2);
    s.neck.rotation.x = settle(s.neck.rotation.x, p.neckX + sweep * 0.08, 0.2);
    s.neck.rotation.y = settle(s.neck.rotation.y, p.neckY + counter * 0.18, 0.2);
    s.head.rotation.y = settle(s.head.rotation.y, p.headY + counter * 0.36, 0.24);
    s.head.rotation.x = settle(s.head.rotation.x, p.headX + sweep * 0.1, 0.22);
    s.head.rotation.z = settle(s.head.rotation.z, groove * 0.08, 0.22);
    s.jaw.rotation.x = settle(s.jaw.rotation.x, p.jawX + accent * 0.11, 0.2);

    s.upperArmL.rotation.x = settle(s.upperArmL.rotation.x, p.upperArmLX + 0.28 + armDriveL * 0.45, 0.26);
    s.upperArmR.rotation.x = settle(s.upperArmR.rotation.x, p.upperArmRX + 0.28 + armDriveR * 0.45, 0.26);
    s.upperArmL.rotation.y = settle(s.upperArmL.rotation.y, p.upperArmLY + counter * 0.3, 0.24);
    s.upperArmR.rotation.y = settle(s.upperArmR.rotation.y, p.upperArmRY - counter * 0.3, 0.24);
    s.upperArmL.rotation.z = settle(s.upperArmL.rotation.z, p.upperArmLZ + 0.65 + groove * 0.5, 0.26);
    s.upperArmR.rotation.z = settle(s.upperArmR.rotation.z, p.upperArmRZ - 0.65 - groove * 0.5, 0.26);
    s.foreArmL.rotation.x = settle(s.foreArmL.rotation.x, p.foreArmLX + 0.34 + elbowSwingL * 0.28, 0.26);
    s.foreArmR.rotation.x = settle(s.foreArmR.rotation.x, p.foreArmRX + 0.34 + elbowSwingR * 0.28, 0.26);
    s.foreArmL.rotation.z = settle(s.foreArmL.rotation.z, p.foreArmLZ + 0.54 + elbowSwingL * 0.38, 0.26);
    s.foreArmR.rotation.z = settle(s.foreArmR.rotation.z, p.foreArmRZ - 0.54 - elbowSwingR * 0.38, 0.26);
    s.handL.rotation.x = settle(s.handL.rotation.x, p.handLX + elbowSwingL * 0.14, 0.24);
    s.handR.rotation.x = settle(s.handR.rotation.x, p.handRX + elbowSwingR * 0.14, 0.24);
    s.handL.rotation.z = settle(s.handL.rotation.z, p.handLZ + armDriveL * 0.2, 0.24);
    s.handR.rotation.z = settle(s.handR.rotation.z, p.handRZ - armDriveR * 0.2, 0.24);

    s.thighL.rotation.x = settle(s.thighL.rotation.x, p.thighLX + legDriveL * 0.28 + kickL * 0.13, 0.22);
    s.thighR.rotation.x = settle(s.thighR.rotation.x, p.thighRX + legDriveR * 0.28 + kickR * 0.13, 0.22);
    s.thighL.rotation.z = settle(s.thighL.rotation.z, p.thighLZ + groove * 0.12, 0.2);
    s.thighR.rotation.z = settle(s.thighR.rotation.z, p.thighRZ - groove * 0.12, 0.2);
    s.shinL.rotation.x = settle(s.shinL.rotation.x, p.shinLX + kickL * 0.46, 0.22);
    s.shinR.rotation.x = settle(s.shinR.rotation.x, p.shinRX + kickR * 0.46, 0.22);
    s.shinL.rotation.z = settle(s.shinL.rotation.z, p.shinLZ + Math.sin(beat * 2) * 0.08, 0.2);
    s.shinR.rotation.z = settle(s.shinR.rotation.z, p.shinRZ - Math.sin(beat * 2 + Math.PI * 0.5) * 0.08, 0.2);
    s.footL.rotation.x = settle(s.footL.rotation.x, p.footLX + kickL * 0.16 + accent * 0.08, 0.24);
    s.footR.rotation.x = settle(s.footR.rotation.x, p.footRX + kickR * 0.16 + accent * 0.08, 0.24);
    s.footL.rotation.z = settle(s.footL.rotation.z, p.footLZ + groove * 0.06, 0.22);
    s.footR.rotation.z = settle(s.footR.rotation.z, p.footRZ - groove * 0.06, 0.22);

    if (s.stage) s.stage.material.emissiveIntensity = 0.24 + accent * 0.38;
    if (s.stageRing) {
      s.stageRing.rotation.z += 0.012;
      s.stageRing.material.emissiveIntensity = 0.26 + accent * 0.44;
    }
  } else {
    s.hips.rotation.x = settle(s.hips.rotation.x, p.hipsX, 0.12);
    s.hips.rotation.y = settle(s.hips.rotation.y, p.hipsY, 0.12);
    s.hips.rotation.z = settle(s.hips.rotation.z, p.hipsZ, 0.12);
    s.pelvis.rotation.x = settle(s.pelvis.rotation.x, p.pelvisX, 0.12);
    s.pelvis.rotation.y = settle(s.pelvis.rotation.y, p.pelvisY, 0.12);
    s.pelvis.rotation.z = settle(s.pelvis.rotation.z, p.pelvisZ, 0.12);
    s.spine.rotation.x = settle(s.spine.rotation.x, p.spineX, 0.12);
    s.spine.rotation.y = settle(s.spine.rotation.y, p.spineY, 0.12);
    s.ribCage.rotation.y = settle(s.ribCage.rotation.y, p.ribCageY, 0.12);
    s.ribCage.rotation.z = settle(s.ribCage.rotation.z, p.ribCageZ, 0.12);
    s.chest.rotation.z = settle(s.chest.rotation.z, p.chestZ, 0.12);
    s.chest.rotation.y = settle(s.chest.rotation.y, p.chestY, 0.12);
    s.clavicle.rotation.z = settle(s.clavicle.rotation.z, p.clavicleZ, 0.12);
    s.neck.rotation.x = settle(s.neck.rotation.x, p.neckX, 0.12);
    s.neck.rotation.y = settle(s.neck.rotation.y, p.neckY, 0.12);
    s.head.rotation.y = settle(s.head.rotation.y, p.headY, 0.12);
    s.head.rotation.x = settle(s.head.rotation.x, p.headX, 0.12);
    s.head.rotation.z = settle(s.head.rotation.z, 0, 0.12);
    s.jaw.rotation.x = settle(s.jaw.rotation.x, p.jawX, 0.12);
    s.upperArmL.rotation.x = settle(s.upperArmL.rotation.x, p.upperArmLX, 0.12);
    s.upperArmR.rotation.x = settle(s.upperArmR.rotation.x, p.upperArmRX, 0.12);
    s.upperArmL.rotation.y = settle(s.upperArmL.rotation.y, p.upperArmLY, 0.12);
    s.upperArmR.rotation.y = settle(s.upperArmR.rotation.y, p.upperArmRY, 0.12);
    s.upperArmL.rotation.z = settle(s.upperArmL.rotation.z, p.upperArmLZ, 0.12);
    s.upperArmR.rotation.z = settle(s.upperArmR.rotation.z, p.upperArmRZ, 0.12);
    s.foreArmL.rotation.x = settle(s.foreArmL.rotation.x, p.foreArmLX, 0.12);
    s.foreArmR.rotation.x = settle(s.foreArmR.rotation.x, p.foreArmRX, 0.12);
    s.foreArmL.rotation.z = settle(s.foreArmL.rotation.z, p.foreArmLZ, 0.12);
    s.foreArmR.rotation.z = settle(s.foreArmR.rotation.z, p.foreArmRZ, 0.12);
    s.handL.rotation.x = settle(s.handL.rotation.x, p.handLX, 0.12);
    s.handR.rotation.x = settle(s.handR.rotation.x, p.handRX, 0.12);
    s.handL.rotation.z = settle(s.handL.rotation.z, p.handLZ, 0.12);
    s.handR.rotation.z = settle(s.handR.rotation.z, p.handRZ, 0.12);
    s.thighL.rotation.x = settle(s.thighL.rotation.x, p.thighLX, 0.12);
    s.thighR.rotation.x = settle(s.thighR.rotation.x, p.thighRX, 0.12);
    s.thighL.rotation.z = settle(s.thighL.rotation.z, p.thighLZ, 0.12);
    s.thighR.rotation.z = settle(s.thighR.rotation.z, p.thighRZ, 0.12);
    s.shinL.rotation.x = settle(s.shinL.rotation.x, p.shinLX, 0.12);
    s.shinR.rotation.x = settle(s.shinR.rotation.x, p.shinRX, 0.12);
    s.shinL.rotation.z = settle(s.shinL.rotation.z, p.shinLZ, 0.12);
    s.shinR.rotation.z = settle(s.shinR.rotation.z, p.shinRZ, 0.12);
    s.footL.rotation.x = settle(s.footL.rotation.x, p.footLX, 0.12);
    s.footR.rotation.x = settle(s.footR.rotation.x, p.footRX, 0.12);
    s.footL.rotation.z = settle(s.footL.rotation.z, p.footLZ, 0.12);
    s.footR.rotation.z = settle(s.footR.rotation.z, p.footRZ, 0.12);
    if (s.stage) s.stage.material.emissiveIntensity = settle(s.stage.material.emissiveIntensity, 0.32, 0.08);
    if (s.stageRing) {
      s.stageRing.rotation.z = settle(s.stageRing.rotation.z, 0, 0.08);
      s.stageRing.material.emissiveIntensity = settle(s.stageRing.material.emissiveIntensity, 0.28, 0.08);
    }
  }
}

function resizeLayers() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  overlayCanvas.width = w;
  overlayCanvas.height = h;
}

function applyCameraMirror(enabled) {
  const mirrorValue = enabled ? 'scaleX(-1)' : 'none';
  video.style.transform = mirrorValue;
  overlayCanvas.style.transform = mirrorValue;
}

async function setupHandLandmarker() {
  let vision;
  try {
    vision = await FilesetResolver.forVisionTasks('/mediapipe');
  } catch (localWasmError) {
    console.warn('Local MediaPipe WASM load failed, trying CDN.', localWasmError);
    vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
  }

  const modelCandidates = [
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  ];

  const commonOptions = { runningMode: 'VIDEO', numHands: 2 };

  async function tryCreateLandmarker(delegate) {
    let lastError = null;
    for (const modelAssetPath of modelCandidates) {
      try {
        return await HandLandmarker.createFromOptions(vision, {
          ...commonOptions,
          baseOptions: { modelAssetPath, delegate },
        });
      } catch (err) {
        lastError = err;
        console.warn(`Hand model load failed (${delegate}) for ${modelAssetPath}`, err);
      }
    }
    throw lastError ?? new Error(`Unknown ${delegate} initialization error`);
  }

  try {
    handLandmarker = await tryCreateLandmarker('GPU');
    setStatus('Hand model ready (GPU)');
  } catch (gpuError) {
    console.warn('GPU delegate failed, retrying with CPU delegate.', gpuError);
    try {
      handLandmarker = await tryCreateLandmarker('CPU');
      setStatus('Hand model ready (CPU)');
    } catch (cpuError) {
      throw new Error(`Hand model init failed. GPU: ${describeError(gpuError)} | CPU: ${describeError(cpuError)}`);
    }
  }
}

async function setupWebcam() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia is unavailable. Use a modern browser on localhost/HTTPS and allow camera access.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  video.srcObject = stream;
  await video.play();
}

function detectHands() {
  if (!handLandmarker || video.readyState < 2) {
    requestAnimationFrame(detectHands);
    return;
  }

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    const result = handLandmarker.detectForVideo(video, performance.now());
    detectedHands = result.landmarks ?? [];

    const primaryHand = detectedHands[0] ?? null;
    const secondaryHand = detectedHands[1] ?? null;

    ensureModeObjects();

    if (!primaryHand) {
      setModeVisibility(false);
      dropGrabbedItem();
      grabState.pinchActive = false;
      flowerControl.openPalmHeld = false;
      skeletonControl.danceActive = false;
      setStatus(`Show your hand to start ${activeMode} mode`);
    } else {
      setModeVisibility(true);
      if (activeMode === 'skeleton') {
        setStatus(skeletonControl.danceActive
          ? 'Skeleton mode: open palm detected, dancing'
          : 'Skeleton mode: show open palm to dance');
      } else if (secondaryHand) {
        setStatus(activeMode === 'galaxy'
          ? 'Galaxy mode: hand 1 galaxy, hand 2 planets'
          : 'Flower mode: hand 1 flower, hand 2 butterflies');
      } else {
        setStatus(activeMode === 'galaxy'
          ? 'Show second hand to control planets'
          : 'Show second hand to control butterflies');
      }
    }

    drawLandmarks(detectedHands);
    updatePrimaryFromHand(primaryHand);
    updateCompanionFromHand(secondaryHand);
  }

  requestAnimationFrame(detectHands);
}

function animate() {
  requestAnimationFrame(animate);

  const t = performance.now() * 0.001;
  animateGalaxy(t);
  animatePlanets();
  animateFlower(t);
  animateButterflies(t);
  animateSkeleton(t);

  renderer.render(scene, camera);
}

async function init() {
  try {
    applyCameraMirror(MIRROR_CAMERA);
    resizeLayers();
    setActiveModeButton();

    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    setStatus('Loading MediaPipe model...');
    await setupHandLandmarker();

    setStatus('Opening camera...');
    await setupWebcam();

    ensureModeObjects();
    setStatus('Show your hand to start galaxy mode');
    detectHands();
    animate();
  } catch (err) {
    console.error(err);
    if (err?.name === 'NotAllowedError') {
      setStatus('Camera blocked. Allow camera access in your browser settings.');
      return;
    }
    if (err?.name === 'NotFoundError') {
      setStatus('No camera found. Connect a webcam and reload.');
      return;
    }
    if (err?.name === 'NotReadableError') {
      setStatus('Camera is busy in another app. Close that app and reload.');
      return;
    }
    if (!window.isSecureContext) {
      setStatus('Camera requires secure context. Use localhost or HTTPS.');
      return;
    }
    setStatus(`Startup failed: ${describeError(err)}`);
  }
}

window.addEventListener('error', (event) => {
  if (event.error) setStatus(`Runtime error: ${describeError(event.error)}`);
});

window.addEventListener('unhandledrejection', (event) => {
  setStatus(`Unhandled promise rejection: ${describeError(event.reason)}`);
});

window.addEventListener('resize', resizeLayers);
init();
