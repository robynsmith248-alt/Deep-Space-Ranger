// Fixed major timeline events (Earth frame ms since 2025-01-01)
window.EARTH_MESSAGES = [
  { earthTimeMs: 5  * 365.25*86400*1000, text: "COASTAL CITIES ABANDONED – sea levels rose 2m", type: "crisis" },
  { earthTimeMs: 10 * 365.25*86400*1000, text: "GLOBAL FAMINE – crop failures in four continents", type: "crisis" },
  { earthTimeMs: 15 * 365.25*86400*1000, text: "RESOURCE WARS – electrical grid collapses in many regions", type: "crisis" },
  { earthTimeMs: 20 * 365.25*86400*1000, text: "UPGRADE RECEIVED: Extended buoy range (75 ly)", type: "upgrade", effect: "buoyRange", value: 75 },
  { earthTimeMs: 25 * 365.25*86400*1000, text: "NEW TECHNOLOGY: Improved mining efficiency +50%", type: "upgrade", effect: "miningRate", value: 1.5 },
  { earthTimeMs: 30 * 365.25*86400*1000, text: "BIOSPHERE NEAR COLLAPSE – last survivors seek off‑world refuge", type: "crisis" },
  { earthTimeMs: 35 * 365.25*86400*1000, text: "DEEP SPACE NETWORK: relay buoys now communicate at 100 ly", type: "upgrade", effect: "buoyRange", value: 100 },
  { earthTimeMs: 40 * 365.25*86400*1000, text: "PANDEMIC OUTBREAK – 40% of remaining population lost", type: "crisis" },
  { earthTimeMs: 45 * 365.25*86400*1000, text: "EXODUS FLEET LAUNCHED – generation ships heading for candidate stars", type: "info" },
  { earthTimeMs: 50 * 365.25*86400*1000, text: "GENETIC ARK COMPLETE – DNA of Earth's species stored aboard", type: "info" },
  { earthTimeMs: 55 * 365.25*86400*1000, text: "ASTEROID IMPACT – further devastation, famine intensifies", type: "crisis" },
  { earthTimeMs: 60 * 365.25*86400*1000, text: "PROBE DATA: Exoplanet survey indicates 12 Earth‑like candidates", type: "info" },
  { earthTimeMs: 65 * 365.25*86400*1000, text: "UPGRADE: Survey probes become autonomous (no metal cost)", type: "upgrade", effect: "freeSurvey", value: true },
  { earthTimeMs: 70 * 365.25*86400*1000, text: "SUPER‑VOLCANO – global winter sets in", type: "crisis" },
  { earthTimeMs: 75 * 365.25*86400*1000, text: "EARTH'S LAST MESSAGE: 'Find a new home. Time is running out.'", type: "final" }
];

// Pool of minor, semi‑random crisis/info snippets
window.MINOR_MESSAGES = [
  "Global temperature anomaly: +2.7°C",
  "Unprecedented storm season in the Atlantic",
  "Water rationing enacted in 17 nations",
  "Industrial collapse in East Asia",
  "Satellite network degraded – communications unstable",
  "New agricultural strain fails in field trials",
  "Global economy contracts 8% this quarter",
  "Antibiotic‑resistant bacteria spread",
  "Air quality reaches hazardous levels in major cities",
  "Asteroid mining initiative abandoned",
  "Fusion power plants offline for maintenance",
  "Tsunami devastates Pacific coastlines",
  "Arctic ice completely melted – new shipping routes opened",
  "Amazon rainforest reduced to 3% of original cover",
  "Himalayan glaciers gone – rivers dry up",
  "UFO sightings increase – mass hysteria reported",
  "Radio telescope detects alien signal (later disproven)",
  "Cloning experiments fail to revive extinct species",
  "Solar output fluctuation causes power grid failures",
  "Martial law declared in over 20 countries"
];