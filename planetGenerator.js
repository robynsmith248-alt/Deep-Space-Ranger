// planetGenerator.js – Full star system generation + advanced procedural textures
//                     + small irregular asteroids.
import * as THREE from 'three';

// ---------- Simple PRNG ----------
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Perlin noise (simplified 2D) with FBM ----------
class Perlin {
  constructor(seed = 0) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const r = (seed * 9301 + 49297) % 233280;
      const j = r % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
      seed = (seed * 47281 + 32213) % 333227;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(a, b, t) { return a + (b - a) * t; }
  grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  }
  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this.fade(xf);
    const v = this.fade(yf);
    const a = this.perm[this.perm[X] + Y];
    const b = this.perm[this.perm[X + 1] + Y];
    const c = this.perm[this.perm[X] + Y + 1];
    const d = this.perm[this.perm[X + 1] + Y + 1];
    return this.lerp(
      this.lerp(this.grad(a, xf, yf), this.grad(b, xf - 1, yf), u),
      this.lerp(this.grad(c, xf, yf - 1), this.grad(d, xf - 1, yf - 1), u),
      v
    );
  }
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return value / maxValue;
  }
  diffClouds(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      let n = this.noise(x * frequency, y * frequency);
      value += amplitude * (Math.abs(n) * 2 - 1);
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return value / maxValue;
  }
}

// ---------- Stellar parameter estimator ----------
function estimateStellarParams(spect) {
  const t = spect ? spect.trim().toUpperCase() : 'G2V';
  switch (t.charAt(0)) {
    case 'O': return [40, 500000, 40000];
    case 'B': return [8, 1000, 20000];
    case 'A': return [2.5, 20, 8500];
    case 'F': return [1.5, 5, 6500];
    case 'G': return [1.0, 1.0, 5800];
    case 'K': return [0.7, 0.2, 4500];
    case 'M': return [0.4, 0.01, 3000];
    default: return [1.0, 1.0, 5800];
  }
}

function habitableZone(lum) {
  return { inner: 0.95 * Math.sqrt(lum), outer: 1.37 * Math.sqrt(lum) };
}

function planetName(starName, idx) {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return idx < roman.length ? starName + ' ' + roman[idx] : starName + ' ' + (idx + 1);
}

export function generateStarSystem(star) {
  const seed = star.hip ? star.hip : star.name.charCodeAt(0) * 10000 + star.name.length;
  const rand = mulberry32(seed);
  const perlin = new Perlin(seed);

  const [mass, lum, temp] = estimateStellarParams(star.spect);
  const hz = habitableZone(lum);
  const snowLine = 2.7 * Math.sqrt(lum);

  const stars = [{
    name: star.name, type: 'primary', massSolar: mass, radiusSolar: Math.pow(mass, 0.8),
    luminosity: lum, temperature: temp, colorRGB: star.spectralRgb || [1, 0.92, 0.7], orbit: null
  }];

  if (rand() < 0.3) {
    const compMass = mass * (0.3 + rand() * 0.7);
    const compLum = Math.pow(compMass, 3.5) * lum;
    const compTemp = temp * (0.7 + rand() * 0.5);
    const compRadius = Math.pow(compMass, 0.8);
    const separationAU = 5 + rand() * 200;
    stars.push({
      name: star.name + ' B', type: 'companion', massSolar: compMass, radiusSolar: compRadius,
      luminosity: compLum, temperature: compTemp,
      colorRGB: [1, 0.8 + rand() * 0.2, 0.4 + rand() * 0.3],
      orbit: {
        semiMajorAxisAU: separationAU, eccentricity: rand() * 0.6,
        inclination: (rand() - 0.5) * 0.2, longAscNode: rand() * Math.PI * 2,
        argPeriapsis: rand() * Math.PI * 2, meanAnomaly0: rand() * Math.PI * 2,
        periodYears: Math.sqrt(separationAU * separationAU * separationAU / (mass + compMass))
      }
    });
  }

  const planetCount = Math.floor(rand() * 6) + 2;
  const planets = [];
  const logMin = Math.log(0.3), logMax = Math.log(80);
  const step = (logMax - logMin) / (planetCount + 1);

  for (let i = 0; i < planetCount; i++) {
    const logAU = logMin + step * (i + 1) + (rand() - 0.5) * step * 0.8;
    let au = Math.exp(logAU);
    const minSep = au < 1.5 ? 0.7 : 1.3;
    if (i > 0 && au - planets[i - 1].distanceAU < minSep) {
      au = planets[i - 1].distanceAU + minSep + rand() * 1.2;
    }
    const baseTemp = 300 * Math.sqrt(lum) / Math.sqrt(au);

    let type, radiusEarth, massEarth, surfaceGravity, colorRGB, atmoComp, atmoPress, water, tempLow, tempHigh, magField, rings, textureType;

    if (au < 0.4 * hz.inner) type = 'Hot rocky';
    else if (au < hz.inner) type = 'Warm rocky';
    else if (au < hz.outer) type = 'Temperate rocky';
    else if (au < snowLine * 1.5) type = rand() < 0.6 ? 'Ice giant' : 'Rocky';
    else type = rand() < 0.5 ? 'Gas giant' : 'Ice giant';

    if (type.includes('rocky')) {
      radiusEarth = 0.5 + rand() * 1.5;
      massEarth = Math.pow(radiusEarth, 2.2) * (0.8 + rand() * 0.4);
      surfaceGravity = massEarth / (radiusEarth * radiusEarth);
      if (baseTemp > 800) {
        colorRGB = [0.9, 0.3, 0.1]; atmoComp = 'CO₂/SO₂'; atmoPress = 0.2 + rand() * 0.5;
        water = false; textureType = 'lava';
      } else if (baseTemp > 400) {
        colorRGB = [0.8, 0.6, 0.3]; atmoComp = 'CO₂/N₂'; atmoPress = 0.1 + rand() * 0.8;
        water = false; textureType = 'desert';
      } else {
        colorRGB = [0.4, 0.6, 0.9];
        atmoComp = rand() < 0.4 ? 'N₂/O₂' : 'CO₂/N₂';
        atmoPress = 0.5 + rand() * 1.5;
        water = (baseTemp > 273 && baseTemp < 350 && rand() < 0.5) || (baseTemp > 280 && rand() < 0.2);
        textureType = water ? 'earthlike' : 'rocky';
      }
      tempLow = baseTemp - 30 - rand() * 40; tempHigh = baseTemp + 20 + rand() * 50;
      magField = massEarth > 0.5 && rand() < 0.7; rings = false;
    } else if (type.includes('Gas')) {
      radiusEarth = 3.5 + rand() * 7; massEarth = 30 + rand() * 250;
      surfaceGravity = massEarth / (radiusEarth * radiusEarth);
      colorRGB = [0.8, 0.7 + rand() * 0.2, 0.5 + rand() * 0.3];
      atmoComp = 'H₂/He'; atmoPress = 10 + rand() * 40; water = false;
      tempLow = baseTemp - 50; tempHigh = baseTemp + 30; magField = true; rings = rand() < 0.3; textureType = 'gas';
    } else {
      radiusEarth = 2.5 + rand() * 3; massEarth = 10 + rand() * 20;
      surfaceGravity = massEarth / (radiusEarth * radiusEarth);
      colorRGB = [0.5, 0.7, 0.95]; atmoComp = 'H₂/He/CH₄'; atmoPress = 5 + rand() * 10; water = false;
      tempLow = baseTemp - 30; tempHigh = baseTemp + 10; magField = true; rings = rand() < 0.15; textureType = 'ice';
    }

    const moonCount = type.includes('rocky') ? Math.floor(rand() * 3) : Math.floor(rand() * 8) + 5;
    const moons = [];
    for (let m = 0; m < moonCount; m++) {
      const moonMass = 0.001 + rand() * 0.1;
      const moonRadius = Math.cbrt(moonMass) * 0.8;
      const moonDist = (radiusEarth * 3 + rand() * 10) * 0.03;
      moons.push({
        name: planetName(star.name, i) + ' Moon ' + (m + 1),
        massEarth: moonMass, radiusEarth: moonRadius, colorRGB: [0.7, 0.7, 0.7],
        orbit: {
          semiMajorAxisAU: moonDist, eccentricity: rand() * 0.1,
          inclination: (rand() - 0.5) * 0.3, longAscNode: rand() * Math.PI * 2,
          argPeriapsis: rand() * Math.PI * 2, meanAnomaly0: rand() * Math.PI * 2,
          periodDays: 2 * Math.PI * Math.sqrt(Math.pow(moonDist * 149.6e6, 3) / (massEarth * 3.986e14))
        },
        water: false, atmosphere: 'none', textureType: 'rocky'
      });
    }

    planets.push({
      name: planetName(star.name, i), type, radiusEarth, massEarth, surfaceGravity, distanceAU: au,
      colorRGB, atmosphereComposition: atmoComp, atmospherePressure: atmoPress, water,
      temperatureLow: Math.round(tempLow), temperatureHigh: Math.round(tempHigh),
      magneticField: magField, rings, moons, textureType,
      orbit: {
        semiMajorAxisAU: au, eccentricity: 0.05 + rand() * 0.15,
        inclination: (rand() - 0.5) * 0.1, longAscNode: rand() * Math.PI * 2,
        argPeriapsis: rand() * Math.PI * 2, meanAnomaly0: rand() * Math.PI * 2,
        periodYears: Math.sqrt(au * au * au / mass)
      },
      lifeProbability: parseFloat((rand() * 100).toFixed(1)),
      humanHabitability: parseFloat((rand() * 100).toFixed(1)),
      surveyed: false,
      hasLife: false,
      isHabitable: false
    });
  }

  const belts = [];
  const belt1AU = 2.0 * Math.sqrt(lum);
  if (rand() < 0.9) {
    belts.push({ name: star.name + ' Main Belt', innerRadiusAU: belt1AU * 0.8, outerRadiusAU: belt1AU * 1.2, particleCount: 1200, composition: 'rocky/metallic', colorRGB: [0.6, 0.5, 0.4] });
  }
  if (rand() < 0.4 && planets.length > 3) {
    const outerAU = planets[planets.length - 1].distanceAU * 2 + 5;
    belts.push({ name: star.name + ' Outer Belt', innerRadiusAU: outerAU * 0.9, outerRadiusAU: outerAU * 1.1, particleCount: 2000, composition: 'icy', colorRGB: [0.7, 0.75, 0.9] });
  }

  return { stars, planets, belts };
}

// ---------- TEXTURE GENERATORS (1024×1024) ----------
const TEXTURE_SIZE = 1024;

export function generatePlanetTextureCanvas(planet, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  const baseSeed = seed + planet.name.length * 100;
  const perlin = new Perlin(baseSeed);

  switch (planet.textureType) {
    case 'earthlike': drawEarthlike(ctx, TEXTURE_SIZE, perlin, planet, baseSeed); break;
    case 'rocky':     drawRocky(ctx, TEXTURE_SIZE, perlin, planet, false, baseSeed); break;
    case 'desert':    drawRocky(ctx, TEXTURE_SIZE, perlin, planet, true, baseSeed); break;
    case 'gas':       drawGasGiant(ctx, TEXTURE_SIZE, perlin, planet, baseSeed); break;
    case 'ice':       drawIce(ctx, TEXTURE_SIZE, perlin, baseSeed); break;
    case 'lava':      drawLava(ctx, TEXTURE_SIZE, perlin, baseSeed); break;
    default:          ctx.fillStyle = 'gray'; ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  }
  return canvas;
}

function drawEarthlike(ctx, size, perlin, planet, seed) {
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const lat = (v - 0.5) * Math.PI;
    const polarZone = Math.abs(lat) > 1.2;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const h = perlin.fbm(u * 3 + seed, v * 3 + seed, 10, 2.3, 0.5);
      const seaLevel = 0.48 + perlin.noise(u * 1.5 + seed * 3, v * 1.5 + seed * 3) * 0.12;
      const tempNoise = perlin.fbm(u * 2 + seed, v * 2 + seed, 5, 2.0, 0.5);
      const latitudeTemp = 1.0 - Math.abs(lat) / (Math.PI / 2);
      const temp = (latitudeTemp * 0.7 + tempNoise * 0.3);

      let r, g, b;
      if (polarZone && h < 0.6) {
        const snow = perlin.fbm(u * 5 + seed, v * 5 + seed, 6, 2.1, 0.6);
        r = 230 + snow * 25; g = 240 + snow * 15; b = 250 + snow * 5;
      } else if (h < seaLevel) {
        const depth = (seaLevel - h) * 3;
        r = 10 + depth * 20; g = 50 + depth * 50; b = 120 + depth * 80;
      } else {
        const landHeight = (h - seaLevel) / (1 - seaLevel);
        const moisture = perlin.fbm(u * 5 + seed, v * 3 + seed, 6, 2.0, 0.5);
        if (landHeight > 0.8) {
          r = 120 + landHeight * 100; g = 100 + landHeight * 60; b = 70 + landHeight * 40;
        } else if (temp > 0.7 && moisture < 0.4) {
          r = 220 + tempNoise * 35; g = 180 + tempNoise * 40; b = 80 + tempNoise * 30;
        } else if (temp > 0.4 && moisture > 0.3) {
          const veg = perlin.fbm(u * 7 + seed, v * 4 + seed, 7, 2.4, 0.6);
          r = 40 + veg * 60; g = 120 + veg * 100; b = 30 + veg * 50;
        } else {
          r = 150 + moisture * 60; g = 130 + moisture * 50; b = 100 + moisture * 40;
        }
      }
      const idx = (y * size + x) * 4;
      imageData.data[idx] = r; imageData.data[idx+1] = g; imageData.data[idx+2] = b; imageData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawRocky(ctx, size, perlin, planet, desert, seed) {
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const diff = perlin.diffClouds(u * 5 + seed, v * 3 + seed, 8, 2.2, 0.6);
      const h = perlin.fbm(u * 5 + seed, v * 3 + seed, 6, 2.1, 0.5) * 0.7 + 0.3;
      let r, g, b;
      if (desert) {
        const sandR = 200 + perlin.noise(u * 6 + seed, v * 6 + seed) * 40;
        const sandG = 140 + perlin.noise(u * 5 + seed, v * 5 + seed) * 50;
        const sandB = 50 + perlin.noise(u * 4 + seed, v * 4 + seed) * 30;
        const craterFactor = diff < -0.2 ? 0.5 : 1.0;
        r = sandR * craterFactor; g = sandG * craterFactor; b = sandB * craterFactor;
        if (diff > 0.3 && diff < 0.5) { r += 20; g += 15; b += 10; }
      } else {
        const base = 60 + h * 110;
        r = base + perlin.noise(u * 10 + seed, v * 10 + seed) * 35;
        g = base + perlin.noise(u * 8 + seed, v * 8 + seed) * 30;
        b = base + perlin.noise(u * 6 + seed, v * 6 + seed) * 25;
        if (diff > 0.3 && diff < 0.5) { r += 30; g += 20; b += 10; }
        else if (diff < -0.2) { r *= 0.6; g *= 0.6; b *= 0.6; }
      }
      const idx = (y * size + x) * 4;
      imageData.data[idx] = r; imageData.data[idx+1] = g; imageData.data[idx+2] = b; imageData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawGasGiant(ctx, size, perlin, planet, seed) {
  const imageData = ctx.createImageData(size, size);
  const baseColor = planet.colorRGB;
  const bandsCount = 10 + Math.floor(perlin.noise(seed + 1, 0) * 14);
  const spotX = 0.4 + perlin.noise(seed + 2, 0) * 0.5;
  const spotY = 0.4 + perlin.noise(seed + 3, 0) * 0.3;
  const spotWidth = 0.06 + perlin.noise(seed + 4, 0) * 0.04;
  const spotHeight = 0.05 + perlin.noise(seed + 5, 0) * 0.03;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    let mix = 0;
    for (let b = 0; b < bandsCount; b++) {
      const freq = (b + 1) * 3.0 + perlin.noise(seed + b + 100, 0) * 2.0;
      const phase = perlin.noise(seed + b + 200, 0) * Math.PI;
      mix += Math.sin(v * Math.PI * freq + phase) * (0.3 + perlin.noise(seed + b + 300, 0) * 0.2);
    }
    mix /= bandsCount;
    const storm = perlin.fbm(v * 5 + seed, 0.5, 6, 2.0, 0.5) * 0.3;
    mix += storm;

    const rBase = baseColor[0] * 255 + perlin.noise(seed + 6, v * 3) * 20;
    const gBase = baseColor[1] * 255 + perlin.noise(seed + 7, v * 3) * 20;
    const bBase = baseColor[2] * 255 + perlin.noise(seed + 8, v * 3) * 20;

    let spot = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const dx = (u - spotX) / spotWidth;
      const dy = (v - spotY) / spotHeight;
      const dist = Math.sqrt(dx * dx + dy * dy);
      spot = Math.max(0, 1 - dist) * perlin.noise(u * 30, v * 30) * 0.7;
    }

    let r = rBase * (0.6 + mix * 0.5) + spot * 120;
    let g = gBase * (0.5 + mix * 0.6) + spot * 70;
    let b = bBase * (0.4 + mix * 0.6) + spot * 40;
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));

    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      imageData.data[idx] = r; imageData.data[idx+1] = g; imageData.data[idx+2] = b; imageData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawIce(ctx, size, perlin, seed) {
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const diff = perlin.diffClouds(u * 4 + seed, v * 2 + seed, 7, 2.3, 0.6);
      const fbm = perlin.fbm(u * 5 + seed, v * 3 + seed, 6, 2.0, 0.5);
      const crack = diff < -0.3 ? 0.4 : 1.0;
      const base = 180 + fbm * 60;
      let r = base * crack, g = base * crack + 20, b = base * crack + 60;
      r = Math.min(255, r); g = Math.min(255, g); b = Math.min(255, b);
      const idx = (y * size + x) * 4;
      imageData.data[idx] = r; imageData.data[idx+1] = g; imageData.data[idx+2] = b; imageData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawLava(ctx, size, perlin, seed) {
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const diff = perlin.diffClouds(u * 4 + seed, v * 3 + seed, 8, 2.2, 0.6);
      const crust = 30 + perlin.fbm(u * 6 + seed, v * 3 + seed, 5, 2.0, 0.5) * 40;
      let r = crust, g = crust * 0.5, b = crust * 0.3;
      if (diff > 0.35) {
        const glow = (diff - 0.35) / 0.65;
        r = Math.min(255, r + 200 * glow);
        g = Math.min(255, g + 150 * glow);
        b = Math.min(255, b + 50 * glow);
      }
      const idx = (y * size + x) * 4;
      imageData.data[idx] = r; imageData.data[idx+1] = g; imageData.data[idx+2] = b; imageData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export function generateAtmosphereCanvas(planet, seed) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const perlin = new Perlin(seed + 999);
  const imageData = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const cloud = perlin.fbm(u * 6 + seed, v * 4 + seed, 7, 2.5, 0.5) * 0.5 + 0.5;
      const alpha = cloud * 0.4;
      let r, g, b;
      if (planet.water && planet.textureType === 'earthlike') {
        r = 240; g = 245; b = 255;
      } else if (planet.type.includes('Gas')) {
        r = 255; g = 230; b = 180;
      } else if (planet.type.includes('Ice')) {
        r = 220; g = 230; b = 255;
      } else if (planet.textureType === 'lava') {
        r = 255; g = 120; b = 50;
      } else {
        r = 200; g = 210; b = 220;
      }
      const idx = (y * size + x) * 4;
      imageData.data[idx] = r; imageData.data[idx+1] = g; imageData.data[idx+2] = b; imageData.data[idx+3] = alpha * 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function generateRingCanvas(planet, seed) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const perlin = new Perlin(seed + 777);
  const center = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center, dy = y - center;
      const r = Math.sqrt(dx * dx + dy * dy);
      const inner = 0.25 * size, outer = 0.45 * size;
      if (r > inner && r < outer) {
        const n = perlin.noise(x / 40, y / 40) * 0.5 + 0.5;
        const alpha = n * 0.8;
        const gray = 180 + n * 75;
        ctx.fillStyle = `rgba(${gray},${gray},${gray},${alpha})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return canvas;
}

export function createAsteroidMesh(seed) {
  const rng = mulberry32(seed);
  const rand = () => rng();
  const size = 0.008 + rand() * 0.015;
  const baseGeo = new THREE.IcosahedronGeometry(size, 1);
  const positions = baseGeo.attributes.position.array;
  const scaleX = 0.6 + rand() * 1.4;
  const scaleY = 0.6 + rand() * 1.4;
  const scaleZ = 0.6 + rand() * 1.4;

  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= scaleX; positions[i+1] *= scaleY; positions[i+2] *= scaleZ;
    const x = positions[i], y = positions[i+1], z = positions[i+2];
    const len = Math.sqrt(x*x + y*y + z*z);
    const nx = x / len, ny = y / len, nz = z / len;
    const displacement = (0.1 + rand() * 0.3) * size * 0.2;
    positions[i] += nx * displacement;
    positions[i+1] += ny * displacement;
    positions[i+2] += nz * displacement;
  }
  baseGeo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.6 + rand() * 0.3, 0.5 + rand() * 0.3, 0.4 + rand() * 0.2),
    roughness: 0.9, metalness: 0.1, flatShading: true
  });
  const asteroid = new THREE.Mesh(baseGeo, material);
  asteroid.castShadow = true; asteroid.receiveShadow = true;
  asteroid.rotation.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
  return asteroid;
}