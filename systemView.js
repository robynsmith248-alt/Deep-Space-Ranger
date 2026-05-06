// systemView.js – Build, enter, leave, pick objects, highlight selection,
//                  larger scale, large irregular asteroids (now much smaller, orbital, rotating),
//                  proper star lighting, increased star/planet size difference.
import * as THREE from 'three';
import {
  generatePlanetTextureCanvas,
  generateAtmosphereCanvas,
  generateRingCanvas,
  createAsteroidMesh
} from './planetGenerator.js';

const SYSTEM_SCALE = 0.5;
export let systemClickableObjects = [];
let systemGroup = null;
let systemData = null;
let systemTargetId = null;
let selectedObject = null;
let originalEmissiveMap = new WeakMap();
let asteroidObjects = [];

export function computeOrbitPosition(orbit, tYears, parentMassSolar = 1.0) {
  if (!orbit) return new THREE.Vector3();
  const a = orbit.semiMajorAxisAU;
  const e = orbit.eccentricity;
  const i = orbit.inclination;
  const Omega = orbit.longAscNode;
  const w = orbit.argPeriapsis;
  const M0 = orbit.meanAnomaly0;
  const period = orbit.periodYears || Math.sqrt(a * a * a / parentMassSolar);
  const n = 2 * Math.PI / period;
  const M = M0 + n * tYears;
  let E = M;
  for (let j = 0; j < 10; j++) E = M + e * Math.sin(E);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const xOrb = a * (cosE - e);
  const yOrb = a * Math.sqrt(1 - e * e) * sinE;
  const x1 = xOrb * Math.cos(w) - yOrb * Math.sin(w);
  const y1 = xOrb * Math.sin(w) + yOrb * Math.cos(w);
  const x2 = x1 * Math.cos(Omega) - y1 * Math.sin(Omega) * Math.cos(i);
  const y2 = x1 * Math.sin(Omega) + y1 * Math.cos(Omega) * Math.cos(i);
  const z2 = y1 * Math.sin(i);
  return new THREE.Vector3(x2, z2, y2);
}

function createGlowTexture(colorArray) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${colorArray[0]*255},${colorArray[1]*255},${colorArray[2]*255},1)`);
  gradient.addColorStop(0.3, `rgba(${colorArray[0]*255},${colorArray[1]*255},${colorArray[2]*255},0.6)`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function buildSystem3D(sysData, starGlobalPos) {
  if (systemGroup) {
    systemGroup.traverse(obj => {
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose && m.dispose());
        else obj.material.dispose && obj.material.dispose();
      }
      if (obj.geometry) obj.geometry.dispose();
    });
    if (systemGroup.parent) systemGroup.parent.remove(systemGroup);
  }
  systemGroup = new THREE.Group();
  systemGroup.position.copy(starGlobalPos);
  systemClickableObjects = [];
  asteroidObjects = [];
  originalEmissiveMap = new WeakMap();

  const AU = SYSTEM_SCALE;

  sysData.stars.forEach((starData, idx) => {
    const radiusDisplay = idx === 0 ? 0.4 : 0.2 + Math.sqrt(starData.radiusSolar) * 0.1;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radiusDisplay, 32, 16),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(...starData.colorRGB),
        emissive: new THREE.Color(...starData.colorRGB),
        emissiveIntensity: 1.0
      })
    );
    const glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowTexture(starData.colorRGB),
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    glowSprite.scale.set(radiusDisplay * 8, radiusDisplay * 8, 1);
    sphere.add(glowSprite);
    sphere.userData = { type: 'star', name: starData.name, id: idx === 0 ? 'primary' : 'companion' };
    if (idx === 0) sphere.position.set(0, 0, 0);
    systemGroup.add(sphere);
    systemClickableObjects.push(sphere);

    const lightColor = new THREE.Color(...starData.colorRGB);
    const intensity = Math.min(2.0, starData.luminosity * 0.8);
    const pointLight = new THREE.PointLight(lightColor, intensity, 0, 1.5);
    pointLight.position.copy(sphere.position);
    systemGroup.add(pointLight);
  });

  sysData.planets.forEach((planet, pIdx) => {
    const planetRadius = Math.sqrt(planet.radiusEarth) * 0.06;
    const texCanvas = generatePlanetTextureCanvas(planet, pIdx * 100);
    const tex = new THREE.CanvasTexture(texCanvas);
    const planetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(planetRadius, 48, 24),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.1 })
    );
    planetMesh.userData = {
      type: 'planet',
      name: planet.name,
      id: pIdx,
      rotationSpeed: (Math.random() * 0.5 + 0.2),
      planetData: planet
    };

    if (planet.atmosphereComposition !== 'none') {
      const atmoCanvas = generateAtmosphereCanvas(planet, pIdx * 200);
      const atmoTex = new THREE.CanvasTexture(atmoCanvas);
      const atmoSphere = new THREE.Mesh(
        new THREE.SphereGeometry(planetRadius * 1.02, 48, 24),
        new THREE.MeshStandardMaterial({
          map: atmoTex, transparent: true, opacity: 0.5,
          depthWrite: false, roughness: 0.5
        })
      );
      planetMesh.add(atmoSphere);
    }

    if (planet.rings) {
      const ringCanvas = generateRingCanvas(planet, pIdx * 300);
      const ringTex = new THREE.CanvasTexture(ringCanvas);
      const ringGeo = new THREE.RingGeometry(planetRadius * 1.4, planetRadius * 2.2, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      planetMesh.add(ringMesh);
    }

    const orbitPoints = [];
    for (let angle = 0; angle <= Math.PI * 2; angle += 0.1) {
      orbitPoints.push(new THREE.Vector3(
        Math.cos(angle) * planet.distanceAU * AU,
        0,
        Math.sin(angle) * planet.distanceAU * AU
      ));
    }
    const orbitLineGeo = new THREE.BufferGeometry().setFromPoints(orbitPoints);
    const orbitLine = new THREE.Line(
      orbitLineGeo,
      new THREE.LineBasicMaterial({ color: 0x4466cc, transparent: true, opacity: 0.7 })
    );
    systemGroup.add(orbitLine);

    planet.moons.forEach((moon, mIdx) => {
      const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(Math.sqrt(moon.radiusEarth) * 0.04, 16, 8),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.9 })
      );
      moonMesh.userData = { type: 'moon', name: moon.name, planetIdx: pIdx, moonIdx: mIdx };
      planetMesh.add(moonMesh);
    });

    planetMesh.position.set(planet.distanceAU * AU, 0, 0);
    systemGroup.add(planetMesh);
    systemClickableObjects.push(planetMesh);
  });

  sysData.belts.forEach((belt, bIdx) => {
    const innerR = belt.innerRadiusAU * AU;
    const outerR = belt.outerRadiusAU * AU;
    const count = belt.particleCount;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = innerR + Math.random() * (outerR - innerR);
      const y = (Math.random() - 0.5) * 0.2 * AU;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(...belt.colorRGB),
      size: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const beltPoints = new THREE.Points(geom, mat);
    beltPoints.userData = { type: 'belt', name: belt.name, id: bIdx };
    systemGroup.add(beltPoints);
    systemClickableObjects.push(beltPoints);

    const asteroidCount = 3 + Math.floor(Math.random() * 6);
    for (let i = 0; i < asteroidCount; i++) {
      const semiMajor = innerR + Math.random() * (outerR - innerR);
      const eccentricity = Math.random() * 0.1;
      const inclination = (Math.random() - 0.5) * 0.1;
      const longAsc = Math.random() * Math.PI * 2;
      const argPeri = Math.random() * Math.PI * 2;
      const meanAnom = Math.random() * Math.PI * 2;
      const realAU = semiMajor / SYSTEM_SCALE;
      const periodYears = Math.sqrt(realAU * realAU * realAU / sysData.stars[0].massSolar);
      const asteroidOrbit = {
        semiMajorAxisAU: realAU,
        eccentricity, inclination, longAscNode: longAsc,
        argPeriapsis: argPeri, meanAnomaly0: meanAnom, periodYears
      };
      const asteroidMesh = createAsteroidMesh(bIdx * 1000 + i);
      asteroidMesh.userData = {
        type: 'asteroid',
        name: `${belt.name} asteroid ${i+1}`,
        beltIdx: bIdx,
        objectId: i,
        orbit: asteroidOrbit,
        metalTons: Math.floor(5 + Math.random() * 50)
      };
      asteroidMesh.userData.rotationAxis = new THREE.Vector3(
        Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
      ).normalize();
      asteroidMesh.userData.rotationSpeed = 0.002 + Math.random() * 0.008;

      systemGroup.add(asteroidMesh);
      systemClickableObjects.push(asteroidMesh);
      asteroidObjects.push(asteroidMesh);
    }
  });

  return systemGroup;
}

export function enterSystemView(starCatalog, targetStarId, shipGroup, velocity, planetData, VISUAL_SCALE, generateStarSystem) {
  if (!starCatalog[targetStarId]) return false;
  if (!planetData[targetStarId] || !planetData[targetStarId].stars) {
    planetData[targetStarId] = generateStarSystem(starCatalog[targetStarId]);
  }
  systemData = planetData[targetStarId];

  const starGlobalPos = starCatalog[targetStarId].pos.clone().multiplyScalar(VISUAL_SCALE);
  const approachDir = velocity.length() > 0.001
    ? velocity.clone().normalize().multiplyScalar(-1)
    : new THREE.Vector3(0, 0, 1);
  shipGroup.position.copy(
    starGlobalPos.clone().add(approachDir.clone().multiplyScalar(100).multiplyScalar(SYSTEM_SCALE))
  );
  velocity.set(0, 0, 0);
  shipGroup.visible = false;

  systemGroup = buildSystem3D(systemData, starGlobalPos);
  return { systemGroup, systemCameraPos: starGlobalPos.clone() };
}

export function leaveSystemView(scene, shipGroup) {
  if (selectedObject) deselectSystemObject(selectedObject);
  selectedObject = null;
  originalEmissiveMap = new WeakMap();
  if (systemGroup) {
    scene.remove(systemGroup);
    systemGroup = null;
  }
  systemData = null;
  systemClickableObjects = [];
  asteroidObjects = [];
  systemTargetId = null;
  shipGroup.visible = true;
}

export function updateSystemOrbits(timeYears) {
  if (!systemGroup || !systemData) return;
  const companionStar = systemGroup.children.find(c => c.userData?.id === 'companion');
  if (companionStar && systemData.stars[1]) {
    const orb = systemData.stars[1].orbit;
    if (orb) {
      const pos = computeOrbitPosition(orb, timeYears, systemData.stars[0].massSolar);
      companionStar.position.copy(pos.clone().multiplyScalar(SYSTEM_SCALE));
    }
  }
  systemData.planets.forEach((planet, pIdx) => {
    const planetMesh = systemGroup.children.find(c => c.userData?.type === 'planet' && c.userData.id === pIdx);
    if (!planetMesh) return;
    const pos = computeOrbitPosition(planet.orbit, timeYears, systemData.stars[0].massSolar);
    planetMesh.position.copy(pos.clone().multiplyScalar(SYSTEM_SCALE));
    if (planetMesh.userData.rotationSpeed) {
      planetMesh.rotation.y += 0.01 * planetMesh.userData.rotationSpeed;
    }
    planet.moons.forEach((moon, mIdx) => {
      const moonMesh = planetMesh.children.find(c => c.userData?.type === 'moon' && c.userData.moonIdx === mIdx);
      if (moonMesh && moon.orbit) {
        const moonPos = computeOrbitPosition(moon.orbit, timeYears, planet.massEarth);
        moonMesh.position.copy(moonPos.clone().multiplyScalar(SYSTEM_SCALE * 0.1));
      }
    });
  });

  asteroidObjects.forEach(asteroid => {
    if (asteroid.userData.orbit) {
      const pos = computeOrbitPosition(asteroid.userData.orbit, timeYears, systemData.stars[0].massSolar);
      asteroid.position.copy(pos.clone().multiplyScalar(SYSTEM_SCALE));
    }
    const axis = asteroid.userData.rotationAxis;
    if (axis) {
      asteroid.rotateOnWorldAxis(axis, asteroid.userData.rotationSpeed);
    }
  });
}

export function onSystemMouseMove(event, camera, tooltip) {
  const mouse = new THREE.Vector2(
    (event.clientX / innerWidth) * 2 - 1,
    -(event.clientY / innerHeight) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(systemClickableObjects, true);
  if (intersects.length > 0) {
    const obj = intersects[0].object;
    tooltip.style.display = 'block';
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY - 25) + 'px';
    let info = `<strong>${obj.userData.name || 'Object'}</strong><br>${obj.userData.type}`;
    if (obj.userData.type === 'planet') {
      const pd = obj.userData.planetData;
      info += `<br>Life prob: ${pd.lifeProbability}%<br>Hab. prob: ${pd.humanHabitability}%`;
    } else if (obj.userData.type === 'asteroid') {
      info += `<br>Est. metal: ${obj.userData.metalTons} tons`;
    }
    tooltip.innerHTML = info;
    if (obj.userData.type === 'planet') {
      systemTargetId = { type: 'planet', index: obj.userData.id };
    } else if (obj.userData.type === 'asteroid') {
      systemTargetId = { type: 'asteroid', id: obj.userData.objectId, beltIdx: obj.userData.beltIdx };
    } else if (obj.userData.type === 'star') {
      systemTargetId = { type: 'star', id: obj.userData.id };
    } else {
      systemTargetId = null;
    }
  } else {
    tooltip.style.display = 'none';
    systemTargetId = null;
  }
}

export function getSystemTargetId() { return systemTargetId; }
export function setSystemTargetId(val) { systemTargetId = val; }

export function selectSystemObject(obj) {
  if (!obj) return;
  if (obj.material && obj.material.emissive) {
    if (!originalEmissiveMap.has(obj)) {
      originalEmissiveMap.set(obj, obj.material.emissive.getHex());
    }
    obj.material.emissive.setHex(0x444444);
    obj.material.emissiveIntensity = 0.5;
  }
  selectedObject = obj;
}

export function deselectSystemObject(obj) {
  if (!obj || !selectedObject) return;
  if (obj.material && obj.material.emissive) {
    const origHex = originalEmissiveMap.get(obj);
    if (origHex !== undefined) {
      obj.material.emissive.setHex(origHex);
      obj.material.emissiveIntensity = 0;
    }
  }
  selectedObject = null;
}

export function getSelectedSystemObject() { return selectedObject; }

export function updateSystemObjectList(systemData, targetElement) {
  if (!systemData) return;
  let html = '<div><strong>SYSTEM OBJECTS</strong></div>';
  systemData.stars.forEach(s => {
    html += `<div class="sys-obj" data-target="star-${s.name}">★ ${s.name}</div>`;
  });
  systemData.planets.forEach((p, i) => {
    html += `<div class="sys-obj" data-target="planet-${i}">🪐 ${p.name} (${p.type})</div>`;
  });
  systemData.belts.forEach((b, i) => {
    html += `<div class="sys-obj" data-target="belt-${i}">● ${b.name}</div>`;
  });
  targetElement.innerHTML = html;

  document.querySelectorAll('.sys-obj').forEach(el => {
    el.addEventListener('click', () => {
      const target = el.dataset.target;
      if (target.startsWith('planet-')) {
        systemTargetId = { type: 'planet', index: parseInt(target.split('-')[1]) };
      } else if (target.startsWith('belt-')) {
        systemTargetId = { type: 'belt', index: parseInt(target.split('-')[1]) };
      } else {
        systemTargetId = null;
      }
    });
  });
}