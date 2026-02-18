import './style.css';
import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const video = document.getElementById('webcam');
const overlayCanvas = document.getElementById('output_canvas');
const statusEl = document.getElementById('status');
const overlayCtx = overlayCanvas.getContext('2d');
const MIRROR_CAMERA = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.z = 18;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.dataset.three = 'scene';
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const rim = new THREE.DirectionalLight(0x7ea1ff, 1.2);
rim.position.set(6, 8, 8);
scene.add(rim);

let handLandmarker;
let lastVideoTime = -1;
let detectedHands = [];
let galaxy = null;
let solarSystem = null;
const raycaster = new THREE.Raycaster();
const grabState = {
  planet: null,
  pinchActive: false,
  grabPlaneZ: 0,
};

const controlState = {
  targetScale: 1,
  currentScale: 1,
  spinBoost: 0,
  depthSpeed: 0.03,
  colorShiftActive: false,
  colorHue: 0.62,
};

const planetControlState = {
  orbitSpeed: 0.01,
  tiltX: 0,
  tiltY: 0,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function describeError(err) {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
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
  points.userData = {
    basePositions,
    radii,
    twists,
  };
  scene.add(points);
  return points;
}

function createSolarSystem() {
  const group = new THREE.Group();
  group.position.set(0, -2, -3);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 24),
    new THREE.MeshStandardMaterial({
      color: 0xffcc5c,
      emissive: 0xffa500,
      emissiveIntensity: 0.6,
    }),
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

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) {
      obj.geometry.dispose();
    }
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
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

function updateGalaxyFromPrimaryHand(landmarks) {
  if (!galaxy || !landmarks) return;

  const wrist = landmarks[0];
  if (wrist) {
    const x = (1 - wrist.x - 0.5) * 2;
    const y = (wrist.y - 0.5) * 2;
    galaxy.rotation.y = x * 0.9;
    galaxy.rotation.x = y * 0.5;
  }

  controlState.targetScale = isPinch(landmarks) ? 1.7 : 1;
  controlState.spinBoost = isFist(landmarks) ? 0.06 : 0.012;

  const palmOpen = landmarks[9] && landmarks[0]
    ? Math.hypot(
        landmarks[9].x - landmarks[0].x,
        landmarks[9].y - landmarks[0].y,
        landmarks[9].z - landmarks[0].z,
      )
    : 0.12;

  controlState.depthSpeed = THREE.MathUtils.clamp(0.015 + palmOpen * 0.35, 0.015, 0.1);
  controlState.colorShiftActive = isOpenPalm(landmarks);
}

function getPinchNdc(landmarks) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  if (!thumb || !index) return null;
  const pinchX = (thumb.x + index.x) * 0.5;
  const pinchY = (thumb.y + index.y) * 0.5;

  const mirroredX = 1 - pinchX;
  return {
    x: mirroredX * 2 - 1,
    y: -(pinchY * 2 - 1),
  };
}

function worldPointFromNdcOnZPlane(ndcX, ndcY, planeZ) {
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
  const hit = new THREE.Vector3();
  const ok = raycaster.ray.intersectPlane(plane, hit);
  return ok ? hit : null;
}

function tryGrabPlanet(landmarks) {
  if (!solarSystem || grabState.planet) return;
  const ndc = getPinchNdc(landmarks);
  if (!ndc) return;

  const planetMeshes = (solarSystem.userData.planets ?? []).map((p) => p.mesh);
  raycaster.setFromCamera({ x: ndc.x, y: ndc.y }, camera);
  const hits = raycaster.intersectObjects(planetMeshes, false);
  if (hits.length === 0) return;

  const selectedMesh = hits[0].object;
  const selectedPlanet = (solarSystem.userData.planets ?? []).find((p) => p.mesh === selectedMesh);
  if (!selectedPlanet) return;

  const worldPos = new THREE.Vector3();
  selectedMesh.getWorldPosition(worldPos);
  selectedPlanet.isGrabbed = true;
  grabState.planet = selectedPlanet;
  grabState.grabPlaneZ = worldPos.z;
}

function updateGrabbedPlanet(landmarks) {
  if (!grabState.planet) return;
  const ndc = getPinchNdc(landmarks);
  if (!ndc) return;

  const worldPoint = worldPointFromNdcOnZPlane(ndc.x, ndc.y, grabState.grabPlaneZ);
  if (!worldPoint) return;

  const localPoint = grabState.planet.orbitPivot.worldToLocal(worldPoint.clone());
  grabState.planet.mesh.position.copy(localPoint);
}

function dropPlanet() {
  if (!grabState.planet) return;
  grabState.planet.isGrabbed = false;
  grabState.planet = null;
}

function updatePlanetsFromSecondaryHand(landmarks) {
  if (!solarSystem) return;

  if (!landmarks) {
    grabState.pinchActive = false;
    dropPlanet();
    return;
  }

  const wrist = landmarks[0];
  if (wrist) {
    const x = (1 - wrist.x - 0.5) * 2;
    const y = (wrist.y - 0.5) * 2;
    planetControlState.tiltY = x * 0.8;
    planetControlState.tiltX = y * 0.45;
  }

  planetControlState.orbitSpeed = isFist(landmarks) ? 0.04 : 0.01;

  const pinchActiveNow = isPinch(landmarks);
  if (pinchActiveNow && !grabState.pinchActive) {
    tryGrabPlanet(landmarks);
  }
  if (pinchActiveNow) {
    updateGrabbedPlanet(landmarks);
  }
  if (!pinchActiveNow && grabState.pinchActive) {
    dropPlanet();
  }
  grabState.pinchActive = pinchActiveNow;
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
    vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm',
    );
  }

  const modelCandidates = [
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  ];

  const commonOptions = {
    runningMode: 'VIDEO',
    numHands: 2,
  };

  async function tryCreateLandmarker(delegate) {
    let lastError = null;
    for (const modelAssetPath of modelCandidates) {
      try {
        return await HandLandmarker.createFromOptions(vision, {
          ...commonOptions,
          baseOptions: {
            modelAssetPath,
            delegate,
          },
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
      throw new Error(
        `Hand model init failed. GPU: ${describeError(gpuError)} | CPU: ${describeError(cpuError)}`,
      );
    }
  }
}

async function setupWebcam() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'getUserMedia is unavailable. Use a modern browser on localhost/HTTPS and allow camera access.',
    );
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

    if (primaryHand && !galaxy) {
      galaxy = createGalaxy();
      solarSystem = createSolarSystem();
      setStatus('Hand detected: galaxy + planets online');
    }

    if (primaryHand && galaxy) {
      galaxy.visible = true;
    }

    if (!primaryHand && galaxy) {
      galaxy.visible = false;
    }

    if (!primaryHand && solarSystem) {
      scene.remove(solarSystem);
      disposeObject3D(solarSystem);
      solarSystem = null;
      dropPlanet();
      grabState.pinchActive = false;
      setStatus('Show your hand to spawn galaxy and planets');
    }

    if (primaryHand && secondaryHand) {
      setStatus('Two hands active: hand 1 galaxy, hand 2 pinch-drag planets');
    } else if (primaryHand) {
      setStatus('Show second hand to pinch and move planets');
    }

    drawLandmarks(detectedHands);
    updateGalaxyFromPrimaryHand(primaryHand);
    updatePlanetsFromSecondaryHand(secondaryHand);
  }

  requestAnimationFrame(detectHands);
}

function animate() {
  requestAnimationFrame(animate);

  if (galaxy?.visible) {
    controlState.currentScale += (controlState.targetScale - controlState.currentScale) * 0.14;
    const t = performance.now() * 0.001;
    const pulse = 1 + Math.sin(t * 2.2) * 0.045;
    galaxy.scale.setScalar(controlState.currentScale * pulse);

    galaxy.rotation.z += controlState.spinBoost * 0.9;

    const pos = galaxy.geometry.attributes.position.array;
    const { basePositions, radii, twists } = galaxy.userData;
    const swirlSpeed = THREE.MathUtils.mapLinear(controlState.depthSpeed, 0.015, 0.1, 0.5, 2);
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

    if (controlState.colorShiftActive) {
      controlState.colorHue = (controlState.colorHue + 0.003) % 1;
      galaxy.material.color.setHSL(controlState.colorHue, 0.85, 0.7);
    } else {
      galaxy.material.color.lerp(new THREE.Color(0xffffff), 0.08);
    }
  }

  if (solarSystem) {
    solarSystem.rotation.x += (planetControlState.tiltX - solarSystem.rotation.x) * 0.1;
    solarSystem.rotation.y += (planetControlState.tiltY - solarSystem.rotation.y) * 0.1;

    const planets = solarSystem.userData.planets ?? [];
    for (const planet of planets) {
      if (planet.isGrabbed) continue;
      planet.angle += planet.speed * planetControlState.orbitSpeed;
      planet.orbitPivot.rotation.y = planet.angle;
    }
  }

  renderer.render(scene, camera);
}

async function init() {
  try {
    applyCameraMirror(MIRROR_CAMERA);
    resizeLayers();
    setStatus('Loading MediaPipe model...');
    await setupHandLandmarker();

    setStatus('Opening camera...');
    await setupWebcam();

    setStatus('Show your hand to spawn galaxy and planets');
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
  if (event.error) {
    setStatus(`Runtime error: ${describeError(event.error)}`);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  setStatus(`Unhandled promise rejection: ${describeError(event.reason)}`);
});

window.addEventListener('resize', resizeLayers);
init();
