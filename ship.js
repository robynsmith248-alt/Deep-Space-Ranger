// ship.js – Visible hull (emissive dark slate), ship scale 0.5
import * as THREE from 'three';

// ---------- DYNAMIC TEXTURES ----------
let engineGlowTexture = null;
let innerEngineTexture = null;

function updateEngineTexture(beta, timeSeconds) {
  if (!engineGlowTexture) return;
  const canvas = engineGlowTexture.image;
  const ctx = canvas.getContext('2d');
  const size = 128;
  canvas.width = size; canvas.height = size;
  const engineOn = (beta > 0.02);
  const freq = engineOn ? 22 : 5;
  const pulse = (Math.sin(timeSeconds * freq) * 0.5 + 0.5);
  const t = engineOn ? pulse : 0.3;
  const r = 0.2 + t * 0.8, g = 0.3 + t * 0.7, b = 0.8 + t * 0.2;
  const centerColor = `rgb(${Math.floor(r*255)}, ${Math.floor(g*255)}, ${Math.floor(b*255)})`;
  const outerColor = `rgb(20, 50, 180)`;
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0, centerColor);
  grad.addColorStop(0.3, `rgb(40, 100, 240)`);
  grad.addColorStop(0.7, outerColor);
  grad.addColorStop(1, `rgb(10, 20, 100)`);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  if (engineOn && beta > 0.3) {
    ctx.beginPath();
    ctx.arc(size/2, size/2, size*0.15, 0, 2*Math.PI);
    ctx.fillStyle = `rgba(255, 240, 200, ${0.5+Math.sin(timeSeconds*45)*0.3})`;
    ctx.fill();
  }
  engineGlowTexture.needsUpdate = true;
}

function updateInnerEngineTexture(timeSeconds) {
  if (!innerEngineTexture) return;
  const canvas = innerEngineTexture.image;
  const ctx = canvas.getContext('2d');
  const size = 128;
  canvas.width = size; canvas.height = size;
  const speed = 20;
  const pulse = Math.sin(timeSeconds * speed) * 0.5 + 0.5;
  const midR = Math.floor(100 + 80 * Math.sin(timeSeconds * 18));
  const midG = Math.floor(150 + 80 * Math.cos(timeSeconds * 22));
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0, `rgb(255,255,255)`);
  grad.addColorStop(0.4 * pulse, `rgb(${midR},${midG},255)`);
  grad.addColorStop(0.8 * pulse, `rgb(30,80,220)`);
  grad.addColorStop(1, `rgb(20,50,180)`);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size/2, size/2, size*0.1, 0, 2*Math.PI);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.6+0.4*Math.sin(timeSeconds*30)})`;
  ctx.fill();
  innerEngineTexture.needsUpdate = true;
}

// Alpha gradient for plasma plume
function createPlumeAlphaTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 256, 0, 0);
  gradient.addColorStop(0, 'white');
  gradient.addColorStop(1, 'black');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(canvas);
}

// ---------- SHIP GEOMETRY ----------
const shipGroup = new THREE.Group();
let blueCore = null;
let innerBlueCore = null;
const redLights = [];
const redThrusterCones = [];
let coreLight = null;
let outerPlume = null;
let innerPlume = null;

function createGeometricShip() {
  const a = 2.0, sqrt3 = Math.sqrt(3), sqrt23 = Math.sqrt(2/3);
  const h_comp = (sqrt23 * a) / 32;
  const centroidX = a / 2, centroidZ = a * sqrt3 / 6;

  const v0 = new THREE.Vector3(0, 0, 0).sub(new THREE.Vector3(centroidX, 0, centroidZ));
  const v1 = new THREE.Vector3(a, 0, 0).sub(new THREE.Vector3(centroidX, 0, centroidZ));
  const v2 = new THREE.Vector3(a / 2, 0, a * sqrt3 / 2).sub(new THREE.Vector3(centroidX, 0, centroidZ));
  const top = new THREE.Vector3(a / 2, h_comp, a * sqrt3 / 6).sub(new THREE.Vector3(centroidX, 0, centroidZ));
  const bot = new THREE.Vector3(a / 2, -h_comp, a * sqrt3 / 6).sub(new THREE.Vector3(centroidX, 0, centroidZ));

  const positions = [v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, top.x, top.y, top.z, bot.x, bot.y, bot.z];
  const indices = [0, 1, 3, 1, 2, 3, 2, 0, 3, 0, 4, 1, 1, 4, 2, 2, 4, 0];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const hull = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({
    color: 0x1a1e2a,
    roughness: 0.25,
    metalness: 0.7,
    emissive: 0x000510,
    emissiveIntensity: 0.3,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
    reflectivity: 0.8
  }));
  shipGroup.add(hull);

  const outerCoreRadius = 0.28 * 0.9 * 0.8;
  const coreGeo = new THREE.SphereGeometry(outerCoreRadius, 48, 24, 0, Math.PI*2, Math.PI/2, Math.PI/2);
  const engineCanvas = document.createElement('canvas');
  engineCanvas.width = engineCanvas.height = 128;
  engineGlowTexture = new THREE.CanvasTexture(engineCanvas);
  const engineMaterial = new THREE.MeshStandardMaterial({
    map: engineGlowTexture,
    color: 0x88aaff, emissive: 0x2266aa, emissiveIntensity: 0.5,
    metalness: 0.1, roughness: 0.25, transparent: true, opacity: 0.35
  });
  blueCore = new THREE.Mesh(coreGeo, engineMaterial);
  blueCore.scale.set(1, 0.364, 1);
  blueCore.position.set(0, 0, 0);
  shipGroup.add(blueCore);

  const innerCoreRadius = outerCoreRadius * 0.8;
  const innerCoreGeo = new THREE.SphereGeometry(innerCoreRadius, 48, 24, 0, Math.PI*2, Math.PI/2, Math.PI/2);
  const innerCanvas = document.createElement('canvas');
  innerCanvas.width = innerCanvas.height = 128;
  innerEngineTexture = new THREE.CanvasTexture(innerCanvas);
  const innerEngineMaterial = new THREE.MeshStandardMaterial({
    map: innerEngineTexture,
    emissive: 0xffffff, emissiveIntensity: 1.4,
    roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  innerBlueCore = new THREE.Mesh(innerCoreGeo, innerEngineMaterial);
  innerBlueCore.scale.set(1, 0.364, 1);
  innerBlueCore.position.set(0, 0, 0);
  shipGroup.add(innerBlueCore);

  coreLight = new THREE.PointLight(0x4488ff, 0.8, 3.5);
  coreLight.position.set(0, -0.05, 0);
  shipGroup.add(coreLight);

  const alphaTexture = createPlumeAlphaTexture();
  function createPlumeCone(radius, height, color) {
    const geom = new THREE.ConeGeometry(radius, height, 16);
    geom.translate(0, height / 2, 0);
    const mat = new THREE.MeshBasicMaterial({
      color,
      alphaMap: alphaTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = Math.PI;
    mesh.visible = false;
    mesh.position.set(0, 0, 0);
    return mesh;
  }
  outerPlume = createPlumeCone(0.25, 0.7, 0x3366cc);
  innerPlume = createPlumeCone(0.12, 0.7, 0xaaccff);
  shipGroup.add(outerPlume);
  shipGroup.add(innerPlume);

  const coneLength = 0.12;
  const coneRadius = 0.04;
  const redMat = new THREE.MeshBasicMaterial({
    color: 0xff4422,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const corners = [v0, v1, v2];
  corners.forEach(v => {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.03375, 12, 8),
      new THREE.MeshStandardMaterial({
        color: 0xff2200, emissive: 0xff0000, emissiveIntensity: 0.8,
        roughness: 0.3, metalness: 0.1, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    sphere.position.copy(v);
    sphere.scale.set(1, 0.5, 1);
    shipGroup.add(sphere);
    redLights.push(sphere);

    const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 8);
    coneGeo.translate(0, coneLength / 2, 0);
    const cone = new THREE.Mesh(coneGeo, redMat);
    cone.visible = false;
    shipGroup.add(cone);
    redThrusterCones.push(cone);
  });

  shipGroup.scale.set(0.5, 0.5, 0.5);
}

export {
  shipGroup,
  blueCore,
  innerBlueCore,
  redLights,
  redThrusterCones,
  coreLight,
  outerPlume,
  innerPlume,
  engineGlowTexture,
  innerEngineTexture,
  updateEngineTexture,
  updateInnerEngineTexture,
  createGeometricShip
};