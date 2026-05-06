// main.js – Relativistic starfield (original star shader), all system‑view fixes,
//            mobile‑friendly: touch camera, pinch‑zoom, on‑screen buttons.
//            Updated planet selection, travel, surveying, star lighting.
import * as THREE from 'three';
import { KTX2Loader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/KTX2Loader.js';
import {
  shipGroup,
  blueCore, innerBlueCore,
  redLights,
  redThrusterCones,
  coreLight,
  outerPlume, innerPlume,
  updateEngineTexture, updateInnerEngineTexture,
  createGeometricShip
} from './ship.js';
import {
  generateStarSystem,
} from './planetGenerator.js';
import {
  enterSystemView as sysEnter,
  leaveSystemView as sysLeave,
  updateSystemOrbits,
  onSystemMouseMove,
  getSystemTargetId,
  setSystemTargetId,
  selectSystemObject,
  deselectSystemObject,
  getSelectedSystemObject,
  updateSystemObjectList,
  systemClickableObjects,
} from './systemView.js';

// ---------- CONSTANTS ----------
const C = 1.0;
const PROPER_ACCEL = 1.03;
const SECONDS_PER_YEAR = 365.25 * 86400;
const YEAR_MS = SECONDS_PER_YEAR * 1000;
const LY_PER_PC = 3.26156;
const START_DATE = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
const TIME_SCALE_AWAKE = 1;
const TIME_SCALE_HIBERNATE = 10000;
const VISUAL_SCALE = 10.0;

const DEFAULT_CAM_DIST_INTER = 15;
const DEFAULT_CAM_DIST_SYSTEM = 12;

// ---------- GLOBAL STATE ----------
let starCatalog = [];
let cameraDistance = DEFAULT_CAM_DIST_INTER;
let hoveredStarId = -1;
let lastClick = 0;
let pendingStarId = -1;

let velocity = new THREE.Vector3();
let earthTimeMs = 0;
let shipTimeMs = 0;
let bioAgeMs = 0;
let resources = 100;

let thrustActive = false;
let reverseThrustActive = false;
let autoPilotActive = false;
let autoPilotPhase = 'idle';
let autoPilotHalfDist = 0;
let plottedStarId = null;
let targetStarId = 0;
let visitedStars = [];
let hibernating = false;
let timeWarp = 1;

let planetData = {};
let targetForward = null;
let shipIsSlewing = false;

let cockpitMode = false;
let cockpitInSystem = false;
let cockpitLookYaw = 0;
let cockpitLookPitch = 0;
let cockpitZoom = 1;
const defaultCockpitFov = 60;

let viewYaw = 0.2, viewPitch = -0.06;
let targetYaw = 0.2, targetPitch = -0.06;
let omega = new THREE.Vector3();
let keyState = {};
let dragging = false;
let potentialDrag = false;
let dragStartX = 0, dragStartY = 0;
const DRAG_THRESHOLD = 5;
let mouse = { x: 0, y: 0 };

const PLAYER_TORQUE = 8.0;
const MANUAL_DAMPING = 4.0;
const MANUAL_MAX_ANG_SPEED = 2.5;
const TARGET_SLEW_SPEED = 5.0;
const TARGET_DEAD_ANGLE = 0.0002;

// ---------- SYSTEM VIEW STATE ----------
let inSystemView = false;
let systemCamera = {
  yaw: 0.2,
  pitch: -0.6,
  distance: DEFAULT_CAM_DIST_SYSTEM,
};
let systemCameraTarget = new THREE.Vector3();
let autoEnterSystem = true;
let selectedSystemObject = null;
let systemStarGlobalPos = null;

// ---------- SPECTRAL MODE ----------
let spectralMode = 'hyperspectral';

// ---------- TOUCH HANDLING ----------
const activePointers = new Map();
let pinchDistanceStart = 0;

// ---------- HELPERS ----------
function formatDate(ms) {
  const d = new Date(START_DATE.getTime() + ms);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function spectralTypeToColor(s) {
  if (!s) return new THREE.Color(1, 0.9, 0.6);
  switch (s.trim()[0].toUpperCase()) {
    case 'O': return new THREE.Color(0.55, 0.65, 1);
    case 'B': return new THREE.Color(0.70, 0.80, 1);
    case 'A': return new THREE.Color(0.95, 0.95, 1);
    case 'F': return new THREE.Color(1, 1, 0.9);
    case 'G': return new THREE.Color(1, 0.92, 0.7);
    case 'K': return new THREE.Color(1, 0.75, 0.45);
    case 'M': return new THREE.Color(1, 0.55, 0.35);
    default: return new THREE.Color(1, 0.9, 0.6);
  }
}

function loadStarCatalog() {
  if (typeof REAL_STARS === 'undefined') return [];
  const catalog = [];
  for (let i = 0; i < REAL_STARS.length; i++) {
    const s = REAL_STARS[i];
    const ra = s[2] * 15 * Math.PI / 180,
          dec = s[3] * Math.PI / 180,
          d = s[4];
    const x = d * Math.cos(dec) * Math.cos(ra),
          z = d * Math.cos(dec) * Math.sin(ra),
          y = d * Math.sin(dec);
    const distPc = d / LY_PER_PC,
          absMag = d > 0 ? s[5] - 5 * (Math.log10(distPc) - 1) : 4.8;
    catalog.push({
      id: i,
      name: s[1] || `HIP ${s[0]}`,
      hip: s[0],
      raRad: ra,
      decRad: dec,
      pos: new THREE.Vector3(x, y, z),
      distLy: d,
      mag: s[5],
      spect: s[6],
      absMag,
      spectralRgb: [spectralTypeToColor(s[6]).r, spectralTypeToColor(s[6]).g, spectralTypeToColor(s[6]).b],
      discovered: false,
      visitTimeMs: 0
    });
  }

  let solIdx = catalog.findIndex(s => s.name === 'Sol' || s.name === 'Sun' || s.distLy === 0);
  if (solIdx > 0) {
    const sol = catalog.splice(solIdx, 1)[0];
    catalog.unshift(sol);
  } else if (solIdx === -1) {
    catalog.unshift({
      id: 0, name: 'Sol', hip: '', raRad: 0, decRad: 0,
      pos: new THREE.Vector3(0, 0, 0), distLy: 0, mag: -26.74, spect: 'G2V',
      absMag: 4.8, spectralRgb: [1, 0.92, 0.7], discovered: true, visitTimeMs: 0
    });
  }
  catalog.forEach((s, idx) => s.id = idx);
  catalog[0].discovered = true;
  return catalog;
}

// ---------- SPECTRAL COLOUR FUNCTION (richer reds) ----------
function spectralColorArray(shift) {
  const t = Math.min(Math.max(shift, 0.35), 3.5);
  if (t <= 1.0) {
    const f = (1.0 - t) / 0.65;
    const green = [0, 1, 0], cyan = [0, 1, 1], blue = [0, 0, 1], violet = [0.5, 0, 1];
    if (f < 0.33) return lerpColor(green, cyan, f * 3.03);
    else if (f < 0.66) return lerpColor(cyan, blue, (f - 0.33) * 3.03);
    else return lerpColor(blue, violet, (f - 0.66) * 3.0);
  } else {
    const f = (t - 1.0) / 2.5;
    const green = [0, 1, 0], yellow = [1, 1, 0], orange = [1, 0.5, 0], red = [1, 0, 0], deepRed = [0.7, 0, 0];
    if (f < 0.25) return lerpColor(green, yellow, f * 4.0);
    else if (f < 0.5) return lerpColor(yellow, orange, (f - 0.25) * 4.0);
    else if (f < 0.75) return lerpColor(orange, red, (f - 0.5) * 4.0);
    else return lerpColor(red, deepRed, (f - 0.75) * 4.0);
  }
}
function lerpColor(a, b, t) { return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }

// ---------- RELATIVISTIC PHYSICS ----------
function applyThrustAndUpdateVelocity(dtSec) {
  if (!thrustActive && !reverseThrustActive && !autoPilotActive) return;

  let thrustDir = new THREE.Vector3();
  if (autoPilotActive) {
    if (autoPilotPhase === 'accel')
      thrustDir.copy(starCatalog[plottedStarId].pos.clone().sub(shipGroup.position).normalize());
    else
      thrustDir.copy(shipGroup.position.clone().sub(starCatalog[plottedStarId].pos).normalize());
  } else {
    const shipForward = new THREE.Vector3(0, 1, 0).applyQuaternion(shipGroup.quaternion).normalize();
    if (thrustActive) thrustDir.copy(shipForward);
    else if (reverseThrustActive) thrustDir.copy(shipForward.clone().multiplyScalar(-1));
  }
  if (thrustDir.length() < 0.001) return;

  const dtYears = dtSec / SECONDS_PER_YEAR;
  const v = velocity.length();
  const gamma = (v < 0.0001) ? 1 : 1 / Math.sqrt(1 - v * v / (C * C));
  const dtProperYears = dtYears / gamma;
  const a_prop = PROPER_ACCEL * dtProperYears;

  if (v < 0.0001) {
    velocity.add(thrustDir.clone().multiplyScalar(a_prop));
  } else {
    const vHat = velocity.clone().normalize();
    const a_par = thrustDir.dot(vHat) * a_prop;
    const a_perp = thrustDir.clone().sub(vHat.clone().multiplyScalar(thrustDir.dot(vHat))).multiplyScalar(a_prop);
    velocity.add(vHat.clone().multiplyScalar(a_par / (gamma * gamma * gamma)));
    velocity.add(a_perp.multiplyScalar(1 / gamma));
  }
  if (velocity.length() > 0.9999) velocity.setLength(0.9999);
}

function getCurrentAccelG() { return (thrustActive || reverseThrustActive || autoPilotActive) ? 1.03 : 0; }

function updateWorldTimes(rawDt) {
  const scale = hibernating ? TIME_SCALE_HIBERNATE : TIME_SCALE_AWAKE;
  const dtYears = (rawDt * scale * timeWarp) / SECONDS_PER_YEAR;
  const v = velocity.length();
  const gamma = (v < 0.0001) ? 1 : 1 / Math.sqrt(1 - v * v);
  const dEarth = dtYears,
        dShip = dEarth / gamma;
  shipTimeMs += dShip * YEAR_MS;
  earthTimeMs += dEarth * YEAR_MS;
  bioAgeMs += dShip * YEAR_MS * (hibernating ? 0.1 : 1);
}

// ---------- ORIENTATION CONTROL ----------
function updateRotation(dt) {
  if (cockpitInSystem) return;

  const manualActive =
    keyState['ArrowUp'] || keyState['ArrowDown'] || keyState['ArrowLeft'] || keyState['ArrowRight'] ||
    keyState['w'] || keyState['s'] || keyState['a'] || keyState['d'];

  shipIsSlewing = false;

  if (manualActive) {
    targetForward = null;
    const torque = new THREE.Vector3();
    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(shipGroup.quaternion);
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(shipGroup.quaternion);
    if (keyState['ArrowUp'] || keyState['w']) torque.addScaledVector(localX, PLAYER_TORQUE);
    if (keyState['ArrowDown'] || keyState['s']) torque.addScaledVector(localX, -PLAYER_TORQUE);
    if (keyState['ArrowLeft'] || keyState['a']) torque.addScaledVector(localY, -PLAYER_TORQUE);
    if (keyState['ArrowRight'] || keyState['d']) torque.addScaledVector(localY, PLAYER_TORQUE);

    torque.addScaledVector(omega, -MANUAL_DAMPING);
    omega.add(torque.multiplyScalar(dt));
    if (omega.length() > MANUAL_MAX_ANG_SPEED) omega.normalize().multiplyScalar(MANUAL_MAX_ANG_SPEED);

    if (omega.length() > 0.001) {
      const angle = omega.length() * dt;
      const axis = omega.clone().normalize();
      shipGroup.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    }
    return;
  }

  if (targetForward && targetForward.length() > 0.001) {
    const currentForward = new THREE.Vector3(0, 1, 0).applyQuaternion(shipGroup.quaternion);
    const angle = currentForward.angleTo(targetForward);
    if (angle < TARGET_DEAD_ANGLE) {
      omega.set(0, 0, 0);
      const cross = new THREE.Vector3().crossVectors(currentForward, targetForward).normalize();
      const snapQuat = new THREE.Quaternion().setFromAxisAngle(cross, angle);
      shipGroup.quaternion.copy(shipGroup.quaternion.clone().multiply(snapQuat));
      return;
    }

    shipIsSlewing = true;
    const axis = new THREE.Vector3().crossVectors(currentForward, targetForward).normalize();
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const maxAngle = TARGET_SLEW_SPEED * dt;
    const frac = Math.min(1.0, maxAngle / angle);
    shipGroup.quaternion.copy(
      shipGroup.quaternion.clone().slerp(shipGroup.quaternion.clone().multiply(targetQuat), frac)
    );
    omega.set(0, 0, 0);
  } else {
    omega.multiplyScalar(Math.exp(-MANUAL_DAMPING * dt));
    if (omega.length() < 0.001) omega.set(0, 0, 0);
    else {
      const angle = omega.length() * dt;
      const axis = omega.clone().normalize();
      shipGroup.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    }
  }
}

// ---------- RED THRUSTER FLAMES ----------
function updateRedThrusterFlames() {
  const manualActive =
    keyState['ArrowUp'] || keyState['ArrowDown'] || keyState['ArrowLeft'] || keyState['ArrowRight'] ||
    keyState['w'] || keyState['s'] || keyState['a'] || keyState['d'];

  let displayTorque = new THREE.Vector3();

  if (manualActive || omega.length() > 0.01) {
    if (manualActive) {
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(shipGroup.quaternion);
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(shipGroup.quaternion);
      if (keyState['ArrowUp'] || keyState['w']) displayTorque.addScaledVector(localX, PLAYER_TORQUE);
      if (keyState['ArrowDown'] || keyState['s']) displayTorque.addScaledVector(localX, -PLAYER_TORQUE);
      if (keyState['ArrowLeft'] || keyState['a']) displayTorque.addScaledVector(localY, -PLAYER_TORQUE);
      if (keyState['ArrowRight'] || keyState['d']) displayTorque.addScaledVector(localY, PLAYER_TORQUE);
    } else {
      displayTorque.copy(omega.clone().multiplyScalar(-2.0));
    }
  } else if (shipIsSlewing) {
    const currentForward = new THREE.Vector3(0, 1, 0).applyQuaternion(shipGroup.quaternion);
    const angle = currentForward.angleTo(targetForward);
    if (angle > 0.0005) {
      const axis = new THREE.Vector3().crossVectors(currentForward, targetForward).normalize();
      displayTorque.copy(axis.clone().multiplyScalar(Math.min(TARGET_SLEW_SPEED, angle * 5.0) * 2.0));
    }
  }

  if (displayTorque.length() < 0.0005) {
    redThrusterCones.forEach(c => (c.visible = false));
    return;
  }

  const invQuat = shipGroup.quaternion.clone().invert();
  const torqueLocal = displayTorque.clone().applyQuaternion(invQuat);

  redLights.forEach((sphere, i) => {
    const r = sphere.position.clone();
    const f = new THREE.Vector3().crossVectors(torqueLocal, r).normalize();
    const mag = new THREE.Vector3().crossVectors(r, f).dot(torqueLocal);
    if (mag < 0.001) { redThrusterCones[i].visible = false; return; }
    const cone = redThrusterCones[i];
    cone.visible = true;
    cone.position.copy(r.clone().add(f.clone().multiplyScalar(0.03375)));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f);
    cone.scale.y = 1 + torqueLocal.length() * 2;
    cone.material.opacity = 0.3 + torqueLocal.length() * 0.6;
  });
}

// ---------- THREE.JS SETUP ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000205);
scene.fog = new THREE.FogExp2(0x000205, 0.00002);
const ambient = new THREE.AmbientLight(0x1a2a3a);
ambient.intensity = 0.3;
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// ---------- GALAXY BACKGROUND ----------
const ktx2Loader = new KTX2Loader()
  .setTranscoderPath('https://unpkg.com/three@0.128.0/examples/js/libs/basis/')
  .detectSupport(renderer);

const equatorialToGalactic = new THREE.Matrix3();
equatorialToGalactic.set(
  -0.0548755604162154,  0.4941094278755837, -0.8676661490190047,
  -0.8734370902348850, -0.4448296299600112, -0.1980763734312015,
  -0.4838350155487132,  0.7469822444972189,  0.4559837761750669
);
const eqToGal = new THREE.Matrix3();
eqToGal.set(
  equatorialToGalactic.elements[0], equatorialToGalactic.elements[3], equatorialToGalactic.elements[6],
  equatorialToGalactic.elements[1], equatorialToGalactic.elements[4], equatorialToGalactic.elements[7],
  equatorialToGalactic.elements[2], equatorialToGalactic.elements[5], equatorialToGalactic.elements[8]
);

let backgroundSphere = null;
const bgUniforms = {
  tEquirect: { value: null },
  velocity: { value: new THREE.Vector3() },
  brightness: { value: 0.55 },
  equatorialToGalactic: { value: eqToGal },
  uVisibleOnly: { value: false }
};

const bgVertexShader = `
  varying vec3 vWorldDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(worldPos.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bgFragmentShader = `
  varying vec3 vWorldDir;
  uniform sampler2D tEquirect;
  uniform vec3 velocity;
  uniform float brightness;
  uniform mat3 equatorialToGalactic;
  uniform bool uVisibleOnly;

  vec3 wavelengthShiftToColor(float shift) {
    if (shift <= 1.0) {
      float t = (1.0 - shift) / 0.65;
      t = clamp(t, 0.0, 1.0);
      vec3 green = vec3(0.0, 1.0, 0.0);
      vec3 cyan  = vec3(0.0, 1.0, 1.0);
      vec3 blue  = vec3(0.0, 0.0, 1.0);
      vec3 violet= vec3(0.5, 0.0, 1.0);
      if (t < 0.33) return mix(green, cyan, 3.03 * t);
      else if (t < 0.66) return mix(cyan, blue, 3.03 * (t - 0.33));
      else return mix(blue, violet, 3.0 * (t - 0.66));
    } else {
      float t = (shift - 1.0) / 2.0;
      t = clamp(t, 0.0, 1.0);
      vec3 green  = vec3(0.0, 1.0, 0.0);
      vec3 yellow = vec3(1.0, 1.0, 0.0);
      vec3 orange = vec3(1.0, 0.5, 0.0);
      vec3 red    = vec3(1.0, 0.0, 0.0);
      if (t < 0.33) return mix(green, yellow, 3.03 * t);
      else if (t < 0.66) return mix(yellow, orange, 3.03 * (t - 0.33));
      else return mix(orange, red, 3.0 * (t - 0.66));
    }
  }

  void main() {
    vec3 nObs = normalize(vWorldDir);
    float beta = length(velocity);
    if (beta < 0.0001) {
      vec3 nGal = equatorialToGalactic * nObs;
      float u = 0.5 + atan(nGal.z, nGal.x) / (2.0 * 3.14159265);
      float v = 0.5 - asin(nGal.y) / 3.14159265;
      vec4 texColor = texture2D(tEquirect, vec2(u, v));
      gl_FragColor = vec4(texColor.rgb * brightness, 1.0);
      return;
    }

    vec3 vDir = normalize(velocity);
    float gamma = 1.0 / sqrt(1.0 - beta * beta);
    float cosThetaObs = dot(nObs, vDir);

    float D = 1.0 / (gamma * (1.0 - beta * cosThetaObs));
    float wlenShift = 1.0 / D;

    float coeff = ((gamma - 1.0) * cosThetaObs - gamma * beta);
    vec3 nRest = (nObs + coeff * vDir) / (gamma * (1.0 - beta * cosThetaObs));
    nRest = normalize(nRest);

    vec3 nGal = equatorialToGalactic * nRest;
    float u = 0.5 + atan(nGal.z, nGal.x) / (2.0 * 3.14159265);
    float v = 0.5 - asin(nGal.y) / 3.14159265;
    vec4 texColor = texture2D(tEquirect, vec2(u, v));

    float beam = pow(D, 2.8);
    beam = clamp(beam, 0.15, 12.0);

    if (uVisibleOnly) {
      gl_FragColor = vec4(texColor.rgb * brightness * beam, 1.0);
    } else {
      vec3 spectralColor = wavelengthShiftToColor(wlenShift);
      float colorMix = clamp(abs(wlenShift - 1.0) * 1.5, 0.0, 1.0);
      vec3 blendedColor = mix(texColor.rgb, texColor.rgb * spectralColor, colorMix * 0.7);
      blendedColor *= beam;
      float visibility = exp(-pow(log(wlenShift) / log(2.0), 2.0) * 0.45);
      visibility = clamp(visibility, 0.0, 1.0);
      gl_FragColor = vec4(blendedColor * brightness, visibility);
    }
  }
`;

ktx2Loader.load('gaia_milkyway_16k.ktx2', (texture) => {
  console.log('Milky Way background loaded');
  texture.mapping = THREE.EquirectangularRefractionMapping;
  texture.anisotropy = 1;
  bgUniforms.tEquirect.value = texture;

  const sphereGeo = new THREE.SphereGeometry(20000, 64, 32);
  const sphereMat = new THREE.ShaderMaterial({
    uniforms: bgUniforms,
    vertexShader: bgVertexShader,
    fragmentShader: bgFragmentShader,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    fog: false,
    transparent: true,
  });
  backgroundSphere = new THREE.Mesh(sphereGeo, sphereMat);
  backgroundSphere.name = 'galaxyBackground';
  backgroundSphere.renderOrder = -1;
  scene.add(backgroundSphere);
}, undefined, (err) => {
  console.warn('Background load failed:', err);
});

const camera = new THREE.PerspectiveCamera(defaultCockpitFov, window.innerWidth / window.innerHeight, 0.1, 30000);

// ---------- STAR FIELD (original shader) ----------
let starPoints, starGeom;
const originalStarPositions = [],
      starSpectralColors = [];

const starVertexShader = `
  attribute vec3 color;
  attribute float brightness;
  attribute float visibility;
  varying vec3 vColor;
  varying float vVisibility;
  void main() {
    vColor = color;
    vVisibility = visibility;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float sizeScale = 6.0 + brightness * 9.0;
    gl_PointSize = sizeScale * ( 280.0 / ( - mvPosition.z ) );
    gl_PointSize = clamp(gl_PointSize, 3.0, 32.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const starFragmentShader = `
  varying vec3 vColor;
  varying float vVisibility;
  void main() {
    vec2 coord = gl_PointCoord;
    float dist = length(coord - vec2(0.5)) * 2.0;
    if (dist > 1.0) discard;
    float glow = pow(1.0 - dist, 1.2);
    float core = pow(1.0 - dist, 4.0) * 0.9;
    float alpha = glow * 0.95 + core * 0.5;
    vec3 finalColor = vColor * (0.5 + glow * 0.5);
    gl_FragColor = vec4(finalColor, alpha * vVisibility);
  }
`;

function createGlowStarField(stars) {
  if (starPoints) scene.remove(starPoints);
  originalStarPositions.length = 0;
  starSpectralColors.length = 0;
  const positions = [],
        colors = [],
        brightnesses = [],
        visibilities = [];
  stars.forEach(star => {
    const p = star.pos;
    originalStarPositions.push(p.clone());
    positions.push(p.x * VISUAL_SCALE, p.y * VISUAL_SCALE, p.z * VISUAL_SCALE);
    const spec = star.spectralRgb;
    starSpectralColors.push([spec[0], spec[1], spec[2]]);
    colors.push(spec[0], spec[1], spec[2]);
    brightnesses.push(0.5);
    visibilities.push(1.0);
  });
  starGeom = new THREE.BufferGeometry();
  starGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  starGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  starGeom.setAttribute('brightness', new THREE.BufferAttribute(new Float32Array(brightnesses), 1));
  starGeom.setAttribute('visibility', new THREE.BufferAttribute(new Float32Array(visibilities), 1));
  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  });
  starPoints = new THREE.Points(starGeom, shaderMaterial);
  scene.add(starPoints);
}

function aberrateRestToObs(nRest, betaVec) {
  const beta = betaVec.length();
  if (beta < 1e-6) return nRest.clone();
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const betaHat = betaVec.clone().normalize();
  const cosTheta = nRest.dot(betaHat);
  const factor = ((gamma - 1) * cosTheta + gamma * beta);
  const numerator = nRest.clone().add(betaHat.clone().multiplyScalar(factor * beta));
  const denom = gamma * (1 + beta * cosTheta);
  return numerator.divideScalar(denom).normalize();
}

function updateStarField() {
  if (!starGeom) return;
  const observer = shipGroup.position;
  const beta = velocity.length() / C;
  const vVec = velocity.clone();
  const vDir = vVec.length() > 0 ? vVec.clone().normalize() : new THREE.Vector3(0,0,1);
  const gamma = beta > 0 ? 1 / Math.sqrt(1 - beta*beta) : 1;

  const posArr = starGeom.attributes.position.array;
  const colArr = starGeom.attributes.color.array;
  const brightArr = starGeom.attributes.brightness.array;
  const visArr = starGeom.attributes.visibility.array;

  const MIN_APP_MAG = -30, MAX_APP_MAG = 50;

  for (let i = 0; i < starCatalog.length; i++) {
    const star = starCatalog[i];
    const orig = originalStarPositions[i];
    const starRestDir = new THREE.Vector3().subVectors(orig, observer).normalize();
    const dist = observer.distanceTo(orig);

    const apparentDir = aberrateRestToObs(starRestDir, vVec);

    const apparentPos = observer.clone()
      .add(apparentDir.clone().multiplyScalar(dist))
      .multiplyScalar(VISUAL_SCALE);
    posArr[i * 3] = apparentPos.x;
    posArr[i * 3 + 1] = apparentPos.y;
    posArr[i * 3 + 2] = apparentPos.z;

    const cosObs = apparentDir.dot(vDir);
    const D = 1.0 / (gamma * (1.0 - beta * cosObs));
    const wlenShift = 1.0 / D;

    const beaming = Math.min(Math.pow(D, 3.0), 25.0);

    const distPc = dist / LY_PER_PC;
    const appMag = dist > 0.001 ? star.absMag + 5 * (Math.log10(distPc) - 1) : star.absMag;
    let magBrightness = 1.0 - Math.max(0, Math.min(1, (appMag - MIN_APP_MAG) / (MAX_APP_MAG - MIN_APP_MAG)));
    magBrightness = Math.pow(magBrightness, 0.8) * 1.2 * 0.95;

    const boostedBrightness = Math.min(magBrightness * beaming, 2.0);
    brightArr[i] = Math.min(boostedBrightness, 1.0);

    const baseR = starSpectralColors[i][0],
          baseG = starSpectralColors[i][1],
          baseB = starSpectralColors[i][2];
    const spectral = spectralColorArray(wlenShift);
    const blendFactor = Math.min(1.0, Math.abs(wlenShift - 1.0) * 1.8);
    const r = spectral[0] * blendFactor + baseR * (1 - blendFactor);
    const g = spectral[1] * blendFactor + baseG * (1 - blendFactor);
    const b = spectral[2] * blendFactor + baseB * (1 - blendFactor);

    const colorBoost = 0.9 + Math.min(beaming, 8.0) * 0.25;
    colArr[i * 3]     = r * (0.6 + boostedBrightness * 0.6) * colorBoost;
    colArr[i * 3 + 1] = g * (0.5 + boostedBrightness * 0.7) * colorBoost;
    colArr[i * 3 + 2] = b * (0.5 + boostedBrightness * 0.7) * colorBoost;

    let visibility;
    if (wlenShift < 1.0) {
      visibility = Math.exp(-Math.pow((1.0 - wlenShift) * 5.0, 2.0));
    } else {
      visibility = Math.exp(-Math.pow((wlenShift - 1.0) * 1.2, 2.0) * 0.4);
    }
    visibility = Math.max(0, Math.min(1, visibility));

    if (spectralMode === 'visible') {
      const visWindowLow = 0.7, visWindowHigh = 1.4;
      if (wlenShift < visWindowLow || wlenShift > visWindowHigh) {
        visibility = 0;
      }
    }

    visArr[i] = visibility;
  }

  starGeom.attributes.position.needsUpdate = true;
  starGeom.attributes.color.needsUpdate = true;
  starGeom.attributes.brightness.needsUpdate = true;
  starGeom.attributes.visibility.needsUpdate = true;
  starGeom.computeBoundingSphere();
}

// ---------- SHIP & TRAILS ----------
createGeometricShip();
scene.add(shipGroup);
shipGroup.renderOrder = 1;
shipGroup.traverse(child => {
  child.renderOrder = 1;
  if (child.material) child.material.fog = false;
});
if (coreLight) coreLight.intensity = 0.5;

const persistentTrail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff3333 }));
const courseLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x44aaff, dashSize: 0.5, gapSize: 0.3 }));
const hoverLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
scene.add(persistentTrail, courseLine, hoverLine);
hoverLine.visible = false;
courseLine.visible = false;

function updateTrails() {
  const shipPos = shipGroup.position.clone();
  const scaledShipPos = shipPos.clone().multiplyScalar(VISUAL_SCALE);
  const pathPoints = [...visitedStars].map(p => p.clone().multiplyScalar(VISUAL_SCALE));
  if (velocity.length() > 0.0001) pathPoints.push(scaledShipPos.clone());
  const posArr = pathPoints.flatMap(p => [p.x, p.y, p.z]);
  persistentTrail.geometry.dispose();
  persistentTrail.geometry = new THREE.BufferGeometry();
  persistentTrail.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
  persistentTrail.visible = pathPoints.length > 1;

  if (targetStarId !== null && starCatalog[targetStarId]) {
    const dest = starCatalog[targetStarId].pos.clone().multiplyScalar(VISUAL_SCALE);
    const lineArr = [scaledShipPos.x, scaledShipPos.y, scaledShipPos.z, dest.x, dest.y, dest.z];
    courseLine.geometry.dispose();
    courseLine.geometry = new THREE.BufferGeometry();
    courseLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineArr), 3));
    courseLine.computeLineDistances();
    courseLine.visible = true;
  } else {
    courseLine.visible = false;
  }

  if (hoveredStarId >= 0 && hoveredStarId !== targetStarId && starCatalog[hoveredStarId]) {
    const starPos = starCatalog[hoveredStarId].pos.clone().multiplyScalar(VISUAL_SCALE);
    const hArr = [scaledShipPos.x, scaledShipPos.y, scaledShipPos.z, starPos.x, starPos.y, starPos.z];
    hoverLine.geometry.dispose();
    hoverLine.geometry = new THREE.BufferGeometry();
    hoverLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hArr), 3));
    hoverLine.visible = true;
  } else {
    hoverLine.visible = false;
  }

  if (inSystemView) {
    persistentTrail.visible = false;
    courseLine.visible = false;
    hoverLine.visible = false;
  }
}

// ---------- SYSTEM VIEW INTEGRATION ----------
function enterSystemViewLocal(starId) {
  const result = sysEnter(starCatalog, targetStarId, shipGroup, velocity, planetData, VISUAL_SCALE, generateStarSystem);
  if (result) {
    scene.add(result.systemGroup);
    systemCameraTarget.copy(result.systemCameraPos);
    systemStarGlobalPos = result.systemCameraPos.clone();
    systemCamera.yaw = 0.2;
    systemCamera.pitch = -0.3;
    systemCamera.distance = DEFAULT_CAM_DIST_SYSTEM;
    inSystemView = true;
    cockpitInSystem = cockpitMode;
    selectedSystemObject = null;
    autoPilotActive = false;
    plottedStarId = null;
    document.getElementById('leaveSystemBtn').style.display = 'inline-block';
    updateSystemObjectList(planetData[starId], document.getElementById('planetDisplay'));
    shipGroup.visible = cockpitInSystem;
    hidePlanetButtons();
  }
}

function leaveSystemViewLocal() {
  if (selectedSystemObject) deselectSystemObject(selectedSystemObject);
  selectedSystemObject = null;
  cockpitInSystem = false;
  sysLeave(scene, shipGroup);
  inSystemView = false;
  systemStarGlobalPos = null;
  document.getElementById('leaveSystemBtn').style.display = 'none';
  shipGroup.visible = !cockpitMode;
  updateEtaPanel();
  hidePlanetButtons();
}

function hidePlanetButtons() {
  document.getElementById('planetTravelBtn').style.display = 'none';
  document.getElementById('surveyPlanetBtn').style.display = 'none';
  document.getElementById('selectedObjectInfo').style.display = 'none';
}

function showPlanetButtons() {
  document.getElementById('planetTravelBtn').style.display = 'inline-block';
  document.getElementById('surveyPlanetBtn').style.display = 'inline-block';
}

// ---------- PLANET INTERACTION ----------
function travelToSelectedPlanet() {
  if (!selectedSystemObject || selectedSystemObject.userData.type !== 'planet' || !systemStarGlobalPos) return;
  const planetLocalPos = selectedSystemObject.position.clone();
  const worldPos = systemStarGlobalPos.clone().add(planetLocalPos);
  const dir = planetLocalPos.clone().normalize();
  shipGroup.position.copy(worldPos.add(dir.clone().multiplyScalar(1.0)));
  velocity.set(0, 0, 0);
  updateStatusUI();
}

function surveySelectedPlanet() {
  if (!selectedSystemObject || !selectedSystemObject.userData.planetData) return;
  const planet = selectedSystemObject.userData.planetData;
  if (planet.surveyed) { alert('Already surveyed.'); return; }
  if (resources < 5) { alert('Not enough metal.'); return; }
  resources -= 5;
  planet.surveyed = true;
  planet.hasLife = Math.random() < (planet.lifeProbability / 100);
  planet.isHabitable = Math.random() < (planet.humanHabitability / 100);
  updateSelectedObjectInfo();
  updateStatusUI();
  alert(`Survey complete. Life: ${planet.hasLife ? 'Yes' : 'No'}, Habitable: ${planet.isHabitable ? 'Yes' : 'No'}`);
}

function updateSelectedObjectInfo() {
  const infoDiv = document.getElementById('selectedObjectInfo');
  if (!selectedSystemObject) {
    infoDiv.style.display = 'none';
    hidePlanetButtons();
    return;
  }
  const ud = selectedSystemObject.userData;
  if (ud.type === 'planet' && ud.planetData) {
    const p = ud.planetData;
    let html = `<strong>${p.name}</strong><br>`;
    html += `Type: ${p.type}<br>`;
    if (p.surveyed) {
      html += `Life: ${p.hasLife ? 'Yes' : 'No'} | Habitable: ${p.isHabitable ? 'Yes' : 'No'}<br>`;
    } else {
      html += `Life prob: ${p.lifeProbability}% | Hab. prob: ${p.humanHabitability}%<br>`;
      html += `<span style="color:#aaa;">(survey to confirm)</span>`;
    }
    infoDiv.innerHTML = html;
    infoDiv.style.display = 'block';
    showPlanetButtons();
  } else if (ud.type === 'asteroid') {
    let html = `<strong>${ud.name}</strong><br>`;
    html += `Asteroid<br>Est. metal: ${ud.metalTons} tons`;
    infoDiv.innerHTML = html;
    infoDiv.style.display = 'block';
    hidePlanetButtons();
  } else {
    infoDiv.style.display = 'none';
    hidePlanetButtons();
  }
}

// ---------- CAMERA ----------
function updateExternalCamera() {
  const obs = (inSystemView && !cockpitInSystem) ? systemCameraTarget : shipGroup.position.clone().multiplyScalar(VISUAL_SCALE);
  const dist = (inSystemView && !cockpitInSystem) ? systemCamera.distance : cameraDistance;
  const yaw = (inSystemView && !cockpitInSystem) ? systemCamera.yaw : viewYaw;
  const pitch = (inSystemView && !cockpitInSystem) ? systemCamera.pitch : viewPitch;

  const offset = new THREE.Vector3(
    Math.cos(pitch) * Math.cos(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.sin(yaw)
  ).multiplyScalar(dist);
  camera.position.copy(obs.clone().add(offset));
  camera.lookAt(obs);
}

function updateCockpitCamera() {
  const eyePos = shipGroup.position.clone().multiplyScalar(VISUAL_SCALE);
  camera.position.copy(eyePos);
  const shipForward = new THREE.Vector3(0, 1, 0).applyQuaternion(shipGroup.quaternion).normalize();
  camera.lookAt(eyePos.clone().add(shipForward));
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cockpitLookYaw);
  const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), cockpitLookPitch);
  camera.quaternion.multiplyQuaternions(camera.quaternion, yawQ);
  camera.quaternion.multiply(pitchQ);
  const targetFov = defaultCockpitFov / cockpitZoom;
  camera.fov += (targetFov - camera.fov) * 0.1;
  camera.updateProjectionMatrix();
}

function updateCamera() {
  if (cockpitMode || cockpitInSystem) {
    updateCockpitCamera();
  } else {
    updateExternalCamera();
  }
  if (backgroundSphere) {
    backgroundSphere.position.copy(shipGroup.position.clone().multiplyScalar(VISUAL_SCALE));
    bgUniforms.velocity.value.copy(velocity);
  }
}

// ---------- UI ----------
function updateStatusUI() {
  document.getElementById('shipTime').innerText = formatDate(shipTimeMs);
  document.getElementById('earthTime').innerText = formatDate(earthTimeMs);
  document.getElementById('bioAge').innerText = (bioAgeMs / YEAR_MS).toFixed(2);
  document.getElementById('metalCount').innerText = Math.floor(resources);
  document.getElementById('speedDisplay').innerText =
    (velocity.length() / C).toFixed(6) + 'c | Accel: ' + getCurrentAccelG().toFixed(2) + 'g';
  document.getElementById('currentStarName').innerText = starCatalog[targetStarId]?.name || 'Sol';
  document.getElementById('cruiseMode').innerText = hibernating ? 'STASIS' : 'AWAKE';
  document.getElementById('timeWarpDisplay').innerText = timeWarp + '×';
  document.getElementById('viewModeDisplay').innerText = (cockpitMode || cockpitInSystem) ? 'COCKPIT' : 'EXTERNAL';
}

function updateEtaPanel() {
  const tid = parseInt(document.getElementById('targetSelect').value);
  const t = starCatalog[tid];
  if (t) {
    const d = shipGroup.position.distanceTo(t.pos);
    document.getElementById('etaPreview').innerHTML =
      `<div><strong>${t.name}</strong> ${d.toFixed(1)} ly</div><div>Manual flight</div>`;
  }
}

function buildTargetDropdown() {
  const sel = document.getElementById('targetSelect');
  sel.innerHTML = '';
  starCatalog.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.distLy.toFixed(1)} ly)`;
    sel.appendChild(opt);
  });
  sel.value = targetStarId;
  sel.onchange = () => {
    targetStarId = parseInt(sel.value);
    if (starCatalog[targetStarId])
      targetForward = starCatalog[targetStarId].pos.clone().sub(shipGroup.position).normalize();
    updateEtaPanel();
  };
}

function engageAutoPilot(starId) {
  if (!starCatalog[starId]) return;
  const d = shipGroup.position.distanceTo(starCatalog[starId].pos);
  if (d < 0.001) return;
  plottedStarId = starId;
  autoPilotActive = true;
  autoPilotPhase = 'accel';
  autoPilotHalfDist = d / 2;
  thrustActive = false;
  reverseThrustActive = false;
}

function stopShip() {
  autoPilotActive = false;
  plottedStarId = null;
  thrustActive = false;
  reverseThrustActive = false;
  velocity.set(0, 0, 0);
  updateEtaPanel();
}

// ---------- PLANETARY SYSTEM ----------
function displayPlanets(starId) {
  const planets = planetData[starId];
  const container = document.getElementById('planetDisplay');
  if (!planets || planets.length === 0) {
    container.innerHTML = '<div>No data</div>';
    return;
  }
  let html = '';
  planets.forEach(p => {
    html += `<div style="margin-bottom:4px;border-bottom:1px dotted #ffb00044;">
      <strong>${p.name}</strong> (${p.type})<br>
      <span style="font-size:8px;">Dist: ${p.distanceAU.toFixed(2)} AU | Temp: ${p.temperatureLow}‑${p.temperatureHigh}°C</span><br>
      <span style="font-size:8px;">Water: ${p.water ? 'Yes' : 'No'} | Atmo: ${p.atmosphereComposition} | Grav: ${p.surfaceGravity.toFixed(2)}g</span><br>
      <span style="font-size:8px;">Life: ${(p.lifeProbability * 100).toFixed(0)}% | Hab: ${(p.humanHabitability * 100).toFixed(0)}%</span>
      ${p.moons.length ? `<br><span style="font-size:8px;">Moons: ${p.moons.length}</span>` : ''}
    </div>`;
  });
  container.innerHTML = html;
}

function surveySystem(starId) {
  if (!starCatalog[starId]) return;
  if (resources < 10) { alert('Not enough metal!'); return; }
  if (planetData[starId]) { alert('System already surveyed.'); return; }
  resources -= 10;
  planetData[starId] = generateStarSystem(starCatalog[starId]).planets;
  displayPlanets(starId);
  updateStatusUI();
}

// ---------- NEAREST STARS LIST ----------
function buildNearestList() {
  const container = document.getElementById('nearestList');
  container.innerHTML = '';
  const sorted = starCatalog
    .map((s, i) => [i, s])
    .sort((a, b) => a[1].distLy - b[1].distLy)
    .slice(1, 21);
  sorted.forEach(([id, star]) => {
    const div = document.createElement('div');
    div.textContent = `${star.name} (${star.distLy.toFixed(1)} ly)`;
    div.addEventListener('click', () => {
      targetStarId = id;
      document.getElementById('targetSelect').value = id;
      targetForward = star.pos.clone().sub(shipGroup.position).normalize();
      updateEtaPanel();
    });
    container.appendChild(div);
  });
}

// ---------- STAR SEARCH ----------
function searchStar() {
  const input = document.getElementById('starSearchInput');
  const term = input.value.trim().toLowerCase();
  if (!term) return;
  const found = starCatalog.find(s => s.name.toLowerCase() === term);
  if (found) {
    targetStarId = found.id;
    document.getElementById('targetSelect').value = found.id;
    targetForward = found.pos.clone().sub(shipGroup.position).normalize();
    updateEtaPanel();
    input.value = '';
  } else {
    alert('Star not found.');
  }
}

// ---------- CONTROLS (desktop + mobile) ----------
const tooltip = document.getElementById('tooltip');
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 2.0;
const mouseVec = new THREE.Vector2();

function onPointerMove(event) {
  if (inSystemView && !cockpitInSystem) {
    onSystemMouseMove(event, camera, tooltip);
    return;
  }
  mouseVec.x = (event.clientX / innerWidth) * 2 - 1;
  mouseVec.y = -(event.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseVec, camera);
  const intersects = raycaster.intersectObject(starPoints);
  if (intersects.length) {
    let chosenIdx = -1;
    for (const hit of intersects) {
      const star = starCatalog[hit.index];
      const dist = shipGroup.position.distanceTo(star.pos);
      if (dist >= 0.1) { chosenIdx = hit.index; break; }
    }
    if (chosenIdx === -1) { hoveredStarId = -1; tooltip.style.display = 'none'; return; }
    const star = starCatalog[chosenIdx];
    if (chosenIdx !== hoveredStarId) {
      hoveredStarId = chosenIdx;
      tooltip.style.display = 'block';
      tooltip.innerHTML = `<strong>${star.name}</strong><br>${star.distLy.toFixed(1)} ly<br>${star.spect || 'G2V'}`;
    }
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY - 25) + 'px';
  } else {
    hoveredStarId = -1;
    tooltip.style.display = 'none';
  }
}

function onPointerDown(e) {
  const now = performance.now();

  // In system view, select object (if not in cockpit)
  if (inSystemView && !cockpitInSystem) {
    mouseVec.x = (e.clientX / innerWidth) * 2 - 1;
    mouseVec.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouseVec, camera);
    const intersects = raycaster.intersectObjects(systemClickableObjects, true);
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      if (selectedSystemObject) deselectSystemObject(selectedSystemObject);
      selectedSystemObject = obj;
      selectSystemObject(obj);
      document.getElementById('currentStarName').innerText = obj.userData.name || 'Object';
      updateSelectedObjectInfo();
    }
    return;
  }

  // Interstellar star selection – direct raycast on click
  if (!inSystemView) {
    mouseVec.x = (e.clientX / innerWidth) * 2 - 1;
    mouseVec.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouseVec, camera);
    const intersects = raycaster.intersectObject(starPoints);
    let clickStarId = -1;
    if (intersects.length) {
      for (const hit of intersects) {
        const star = starCatalog[hit.index];
        const dist = shipGroup.position.distanceTo(star.pos);
        if (dist >= 0.1) { clickStarId = hit.index; break; }
      }
    }

    if (pendingStarId >= 0 && (now - lastClick < 300) && (clickStarId === pendingStarId || clickStarId === -1)) {
      targetStarId = pendingStarId;
      document.getElementById('targetSelect').value = targetStarId;
      targetForward = starCatalog[targetStarId].pos.clone().sub(shipGroup.position).normalize();
      updateEtaPanel();
      pendingStarId = -1;
      lastClick = now;
      return;
    }

    if (clickStarId >= 0) {
      pendingStarId = clickStarId;
      lastClick = now;
    } else {
      pendingStarId = -1;
      lastClick = 0;
    }
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}

function isTyping() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

function toggleSpectralMode() {
  spectralMode = spectralMode === 'hyperspectral' ? 'visible' : 'hyperspectral';
  document.getElementById('spectralModeBtn').innerText = spectralMode === 'hyperspectral' ? 'HYPERSPECTRAL' : 'VISIBLE ONLY';
}

function resetCameraToShip() {
  if (inSystemView && !cockpitInSystem) {
    systemCamera.yaw = 0.2;
    systemCamera.pitch = -0.3;
    systemCamera.distance = DEFAULT_CAM_DIST_SYSTEM;
  } else if (!cockpitMode && !cockpitInSystem) {
    viewYaw = 0.2;
    targetYaw = 0.2;
    viewPitch = -0.06;
    targetPitch = -0.06;
    cameraDistance = DEFAULT_CAM_DIST_INTER;
  }
}

function toggleCockpitView() {
  if (inSystemView) {
    cockpitInSystem = !cockpitInSystem;
    shipGroup.visible = cockpitInSystem;
    if (cockpitInSystem) { cockpitLookYaw = 0; cockpitLookPitch = 0; cockpitZoom = 1; }
  } else {
    cockpitMode = !cockpitMode;
    shipGroup.visible = !cockpitMode;
    if (cockpitMode) { cockpitLookYaw = 0; cockpitLookPitch = 0; cockpitZoom = 1; }
  }
  updateStatusUI();
}

function togglePlanetaryView() {
  if (inSystemView) {
    leaveSystemViewLocal();
  } else if (targetStarId !== undefined && starCatalog[targetStarId]) {
    enterSystemViewLocal(targetStarId);
  }
}

function initControls() {
  // Keyboard (desktop)
  window.addEventListener('keydown', e => {
    if (isTyping()) return;
    const warpMap = {
      '1':1,'2':10,'3':100,'4':1000,'5':10000,
      '6':100000,'7':1000000,'8':1e7,'9':1e8,'0':1e9
    };
    if (warpMap[e.key]) { timeWarp = warpMap[e.key]; e.preventDefault(); return; }

    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(e.key)) {
      e.preventDefault(); keyState[e.key] = true;
      if (autoPilotActive) { autoPilotActive = false; plottedStarId = null; }
    }
    if (e.key === ' ') { e.preventDefault(); thrustActive = true; if (autoPilotActive) { autoPilotActive = false; plottedStarId = null; } }
    if (e.key === 'Shift') { e.preventDefault(); reverseThrustActive = true; if (autoPilotActive) { autoPilotActive = false; plottedStarId = null; } }
    if (e.key === 'a' && !e.ctrlKey && !e.metaKey) {
      if (autoPilotActive) { autoPilotActive = false; plottedStarId = null; }
      else if (targetStarId && starCatalog[targetStarId]) engageAutoPilot(targetStarId);
    }
    if (e.key === 'b') hibernating = !hibernating;
    if (e.key === 'f') toggleFullscreen();
    if (e.key === 'h') toggleUI();
    if (e.key === 'c') { resetCameraToShip(); e.preventDefault(); }
    if (e.key === 'v') { toggleCockpitView(); e.preventDefault(); }
    if (e.key === 'p') { togglePlanetaryView(); e.preventDefault(); }
  });

  window.addEventListener('keyup', e => {
    if (isTyping()) return;
    if (e.key === ' ') thrustActive = false;
    if (e.key === 'Shift') reverseThrustActive = false;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(e.key))
      delete keyState[e.key];
  });

  // Pointer / touch events
  renderer.domElement.addEventListener('pointerdown', e => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, prevX: e.clientX, prevY: e.clientY });
    if (activePointers.size === 1) {
      potentialDrag = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      mouse.x = e.clientX; mouse.y = e.clientY;
      onPointerDown(e);
    } else if (activePointers.size === 2) {
      potentialDrag = false;
      const pts = [...activePointers.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchDistanceStart = Math.sqrt(dx*dx + dy*dy);
    }
  });

  renderer.domElement.addEventListener('pointermove', e => {
    e.preventDefault();
    const ptr = activePointers.get(e.pointerId);
    if (!ptr) return;
    ptr.prevX = ptr.x; ptr.prevY = ptr.y;
    ptr.x = e.clientX; ptr.y = e.clientY;

    if (activePointers.size === 1 && potentialDrag) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist >= DRAG_THRESHOLD) {
        dragging = true;
        potentialDrag = false;
      }
    }

    if (activePointers.size === 1 && dragging) {
      const dx = e.clientX - mouse.x;
      const dy = e.clientY - mouse.y;
      if (cockpitMode || cockpitInSystem) {
        cockpitLookYaw += dx * 0.004;
        cockpitLookPitch += dy * 0.004;
        cockpitLookYaw = Math.max(-Math.PI/2, Math.min(Math.PI/2, cockpitLookYaw));
        cockpitLookPitch = Math.max(-Math.PI/3, Math.min(Math.PI/3, cockpitLookPitch));
      } else if (inSystemView) {
        systemCamera.yaw += dx * 0.005;
        systemCamera.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, systemCamera.pitch - dy * 0.005));
      } else {
        targetYaw += dx * 0.008;
        targetPitch = Math.min(1.45, Math.max(-1.45, targetPitch - dy * 0.008));
      }
      mouse.x = e.clientX; mouse.y = e.clientY;
    }

    if (activePointers.size === 2) {
      const pts = [...activePointers.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const currentDist = Math.sqrt(dx*dx + dy*dy);
      if (pinchDistanceStart > 0) {
        const scale = currentDist / pinchDistanceStart;
        if (inSystemView && !cockpitInSystem) {
          systemCamera.distance /= scale;
          systemCamera.distance = Math.max(0.8, Math.min(80, systemCamera.distance));
        } else if (cockpitMode || cockpitInSystem) {
          cockpitZoom *= scale;
          cockpitZoom = Math.max(1, Math.min(20, cockpitZoom));
        } else {
          cameraDistance /= scale;
          cameraDistance = Math.max(2, Math.min(200, cameraDistance));
        }
      }
      pinchDistanceStart = currentDist;
    }

    onPointerMove(e);
  });

  window.addEventListener('pointerup', e => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      dragging = false;
      potentialDrag = false;
      pinchDistanceStart = 0;
    }
  });

  // Wheel zoom (desktop)
  window.addEventListener('wheel', e => {
    e.preventDefault();
    if (inSystemView && !cockpitInSystem) {
      systemCamera.distance *= 1 - Math.sign(e.deltaY) * 0.1;
      systemCamera.distance = Math.max(0.8, Math.min(80, systemCamera.distance));
    } else if (cockpitMode || cockpitInSystem) {
      cockpitZoom *= 1 - Math.sign(e.deltaY) * 0.1;
      cockpitZoom = Math.max(1, Math.min(20, cockpitZoom));
    } else {
      cameraDistance *= 1 - Math.sign(e.deltaY) * 0.05;
      cameraDistance = Math.max(2, Math.min(200, cameraDistance));
    }
  }, { passive: false });

  // Mobile control buttons
  document.getElementById('mcThrust')?.addEventListener('pointerdown', () => { thrustActive = true; if (autoPilotActive) { autoPilotActive = false; plottedStarId = null; } });
  document.getElementById('mcThrust')?.addEventListener('pointerup', () => { thrustActive = false; });
  document.getElementById('mcReverse')?.addEventListener('pointerdown', () => { reverseThrustActive = true; if (autoPilotActive) { autoPilotActive = false; plottedStarId = null; } });
  document.getElementById('mcReverse')?.addEventListener('pointerup', () => { reverseThrustActive = false; });
  document.getElementById('mcAutopilot')?.addEventListener('click', () => {
    if (autoPilotActive) { autoPilotActive = false; plottedStarId = null; }
    else if (targetStarId !== null && starCatalog[targetStarId]) engageAutoPilot(targetStarId);
  });
  document.getElementById('mcStasis')?.addEventListener('click', () => { hibernating = !hibernating; });
  document.getElementById('mcStop')?.addEventListener('click', stopShip);
  document.getElementById('mcCockpit')?.addEventListener('click', toggleCockpitView);
  document.getElementById('mcPlanet')?.addEventListener('click', togglePlanetaryView);
  document.getElementById('mcRecenter')?.addEventListener('click', resetCameraToShip);
  document.getElementById('mcSpectral')?.addEventListener('click', toggleSpectralMode);

  // D-pad
  const dPadMap = {
    mcYawLeft:   { key: 'a', playerKey: 'a' },
    mcYawRight:  { key: 'd', playerKey: 'd' },
    mcPitchUp:   { key: 'w', playerKey: 'w' },
    mcPitchDown: { key: 's', playerKey: 's' }
  };
  Object.entries(dPadMap).forEach(([id, mapping]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('pointerdown', () => {
      keyState[mapping.key] = true;
      keyState[mapping.playerKey] = true;
      if (autoPilotActive) { autoPilotActive = false; plottedStarId = null; }
    });
    btn.addEventListener('pointerup', () => { delete keyState[mapping.key]; delete keyState[mapping.playerKey]; });
    btn.addEventListener('pointerleave', () => { delete keyState[mapping.key]; delete keyState[mapping.playerKey]; });
  });

  document.getElementById('fullscreenBtn')?.addEventListener('click', toggleFullscreen);
  document.getElementById('starSearchBtn').addEventListener('click', searchStar);
  document.getElementById('starSearchInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchStar(); });
  document.getElementById('surveyBtn').addEventListener('click', () => surveySystem(targetStarId));
  document.getElementById('leaveSystemBtn')?.addEventListener('click', leaveSystemViewLocal);
  document.getElementById('spectralModeBtn')?.addEventListener('click', toggleSpectralMode);
  document.getElementById('stopBtn')?.addEventListener('click', stopShip);
  
  // Planet interaction buttons
  document.getElementById('planetTravelBtn').addEventListener('click', travelToSelectedPlanet);
  document.getElementById('surveyPlanetBtn').addEventListener('click', surveySelectedPlanet);
}

// ---------- UI TOGGLE ----------
let uiVisible = true;
function toggleUI() {
  uiVisible = !uiVisible;
  document.getElementById('info').classList.toggle('hidden-ui', !uiVisible);
  document.getElementById('status').classList.toggle('hidden-ui', !uiVisible);
  document.getElementById('ui').classList.toggle('hidden-ui', !uiVisible);
}
document.querySelectorAll('.ui-collapsible').forEach(el => el.addEventListener('click', () => el.classList.toggle('collapsed')));

// ---------- PERSISTENCE ----------
function saveGame() {
  localStorage.setItem('deepSpaceRanger', JSON.stringify({
    shipTimeMs, earthTimeMs, bioAgeMs,
    currentStarId: targetStarId,
    resources,
    hibernating,
    visitedStars: visitedStars.map(v => [v.x, v.y, v.z]),
    planetData
  }));
  alert('Saved');
}
function loadGame() {
  const raw = localStorage.getItem('deepSpaceRanger');
  if (raw) {
    const d = JSON.parse(raw);
    shipTimeMs = d.shipTimeMs || 0;
    earthTimeMs = d.earthTimeMs || 0;
    bioAgeMs = d.bioAgeMs || 0;
    targetStarId = d.currentStarId || 0;
    resources = d.resources ?? 100;
    hibernating = d.hibernating || false;
    if (d.visitedStars) visitedStars = d.visitedStars.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    else visitedStars = [starCatalog[0].pos.clone()];
    planetData = d.planetData || {};
    if (planetData[targetStarId] && Array.isArray(planetData[targetStarId])) displayPlanets(targetStarId);
  }
  alert('Loaded');
}
function resetGame() {
  shipTimeMs = earthTimeMs = bioAgeMs = 0;
  velocity.set(0, 0, 0);
  targetStarId = 0;
  resources = 100;
  autoPilotActive = false;
  hibernating = false;
  visitedStars = [starCatalog[0].pos.clone()];
  shipGroup.position.copy(starCatalog[0].pos);
  targetForward = null;
  timeWarp = 1;
  planetData = {};
  document.getElementById('planetDisplay').innerHTML = '';
  if (inSystemView) leaveSystemViewLocal();
  alert('Reset');
}

document.getElementById('plotCourseBtn').onclick = () => {
  const id = parseInt(document.getElementById('targetSelect').value);
  targetStarId = id;
  if (starCatalog[targetStarId]) targetForward = starCatalog[targetStarId].pos.clone().sub(shipGroup.position).normalize();
  engageAutoPilot(targetStarId);
};
document.getElementById('saveGameBtn').onclick = saveGame;
document.getElementById('loadGameBtn').onclick = loadGame;
document.getElementById('resetBtn').onclick = resetGame;
document.getElementById('travelMode').onchange = updateEtaPanel;
document.getElementById('stopBtn')?.addEventListener('click', stopShip);

// ---------- ENGINE LIGHTS ----------
function updateShipLights(dt, totalTime) {
  const beta = velocity.length() / C,
        isEngineOn = thrustActive || reverseThrustActive || autoPilotActive,
        speedFactor = isEngineOn ? Math.min(1.2, beta * 1.8) : 0;
  updateEngineTexture(beta, totalTime);
  updateInnerEngineTexture(totalTime);
  if (blueCore) blueCore.material.emissiveIntensity = 0.3 + speedFactor * 2.2;
  if (innerBlueCore) innerBlueCore.material.emissiveIntensity = 0.9 + speedFactor * 2.0;
  if (coreLight) coreLight.intensity = Math.max(0.5, 0.5 + speedFactor * 2.5);
  if (outerPlume && innerPlume) {
    if (isEngineOn) {
      outerPlume.visible = innerPlume.visible = true;
      outerPlume.scale.y = innerPlume.scale.y = 1.0 + speedFactor * 0.6;
      outerPlume.material.opacity = 0.4 + speedFactor * 0.3;
      innerPlume.material.opacity = 0.6 + speedFactor * 0.3;
    } else {
      outerPlume.visible = innerPlume.visible = false;
    }
  }
  redLights.forEach(l => l.material.emissiveIntensity = isEngineOn ? 0.4 : 0.1);
}

// ---------- INIT & ANIMATION ----------
starCatalog = loadStarCatalog();
document.getElementById('starCount').innerText = starCatalog.length;
createGlowStarField(starCatalog);
buildTargetDropdown();
buildNearestList();
visitedStars = [starCatalog[0].pos.clone()];
shipGroup.position.copy(starCatalog[0].pos);
initControls();

let previousTime = performance.now(),
    globalClock = 0;

function animate() {
  try {
    const now = performance.now();
    let rawDt = (now - previousTime) / 1000;
    if (rawDt <= 0) rawDt = 0.0001;
    rawDt = Math.min(0.1, rawDt);
    previousTime = now;

    const physicsDt = rawDt * timeWarp;
    globalClock += physicsDt;

    const settle = 1 - Math.exp(-rawDt * 10);
    viewYaw += (targetYaw - viewYaw) * settle;
    viewPitch += (targetPitch - viewPitch) * settle;

    if (autoPilotActive && plottedStarId !== null) {
      const starPos = starCatalog[plottedStarId].pos;
      const shipPos = shipGroup.position;
      const distToGo = shipPos.distanceTo(starPos);
      const stepDist = velocity.length() * physicsDt / SECONDS_PER_YEAR;

      if (distToGo < 0.001 || (stepDist > 0 && distToGo < stepDist * 2)) {
        shipGroup.position.copy(starPos);
        velocity.set(0, 0, 0);
        autoPilotActive = false;
        plottedStarId = null;
        visitedStars.push(shipGroup.position.clone());
        targetForward = null;
        thrustActive = false;
        reverseThrustActive = false;
        if (autoEnterSystem && starCatalog[targetStarId]) {
          enterSystemViewLocal(targetStarId);
        }
      } else {
        if (distToGo <= autoPilotHalfDist && autoPilotPhase === 'accel') autoPilotPhase = 'decel';
        targetForward = autoPilotPhase === 'accel'
          ? starPos.clone().sub(shipPos).normalize()
          : shipPos.clone().sub(starPos).normalize();
        thrustActive = false;
        reverseThrustActive = false;
      }
    }

    updateRotation(rawDt);
    applyThrustAndUpdateVelocity(physicsDt);
    shipGroup.position.add(velocity.clone().multiplyScalar(physicsDt / SECONDS_PER_YEAR));
    updateWorldTimes(rawDt);

    if (inSystemView) {
      const years = shipTimeMs / YEAR_MS;
      updateSystemOrbits(years);
    }

    bgUniforms.uVisibleOnly.value = (spectralMode === 'visible');

    updateRedThrusterFlames();
    updateShipLights(physicsDt, globalClock);
    updateStarField();
    updateTrails();

    updateCamera();
    updateStatusUI();
    updateEtaPanel();
    renderer.render(scene, camera);
  } catch (e) { console.error('Animation error:', e); }
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});