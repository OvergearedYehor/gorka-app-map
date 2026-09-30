import { MODULE_ID, SETTINGS } from "../settings.js";
const MAP_SIZE = 7;
const CENTER = Math.floor(MAP_SIZE / 2);

const TOKEN_KIND_LABEL = {
  player: "POCKET5E.Movement.MapPlayer",
  friendly: "POCKET5E.Movement.MapFriendly",
  neutral: "POCKET5E.Movement.MapNeutral",
  hostile: "POCKET5E.Movement.MapHostile",
  other: "POCKET5E.Movement.MapOther"
};

function collectionValues(collection) {
  if ( Array.isArray(collection) ) return collection;
  if ( collection?.contents ) return collection.contents;
  return Array.from(collection ?? []);
}

function ownedByUser(actor, user) {
  return user?.isGM === true
    || (typeof actor?.testUserPermission === "function" && actor.testUserPermission(user, "OWNER"));
}

function tokenKind(token, actor) {
  switch ( Number(token.disposition ?? actor?.prototypeToken?.disposition) ) {
    case 1: return "friendly";
    case 0: return "neutral";
    case -1: return "hostile";
    default: return "other";
  }
}

function tokenImage(token, actor) {
  const src = token?.texture?.src ?? token?.img ?? actor?.img ?? "";
  return typeof src === "string" ? src : "";
}

/**
 * Where the scene artwork sits on the same grid the tokens already use. Foundry draws the background in the
 * padded scene rectangle (`dimensions.sceneX/Y` + `sceneWidth/Height`); without those, it is the raw width/height.
 */

/**
 * Visible tiles on the scene, scaled to the same grid the tokens and background use.
 * Hidden tiles are shown to the GM, but hidden from regular players.
 */
function sceneTiles(scene, gridSize, isGM=false) {
  const tiles = collectionValues(scene?.tiles);
  if ( !tiles.length ) return [];
  return tiles
    .filter(tile => isGM || tile.hidden !== true)
    .map(tile => {
      const src = tile.texture?.src ?? tile.img ?? "";
      const width = Number(tile.width);
      const height = Number(tile.height);
      if ( !src || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ) return null;

      const rawX = Number(tile.x);
      const rawY = Number(tile.y);
      if ( !Number.isFinite(rawX) || !Number.isFinite(rawY) ) return null;

      // In Foundry VTT v14, tiles default to center anchor (0.5, 0.5).
      // If anchorX / anchorY are specified (either on texture or top-level), respect them.
      const anchorX = Number.isFinite(tile.texture?.anchorX)
        ? Number(tile.texture.anchorX)
        : (Number.isFinite(tile.anchorX) ? Number(tile.anchorX) : (Number.isFinite(tile.anchor?.x) ? Number(tile.anchor.x) : 0.5));
      const anchorY = Number.isFinite(tile.texture?.anchorY)
        ? Number(tile.texture.anchorY)
        : (Number.isFinite(tile.anchorY) ? Number(tile.anchorY) : (Number.isFinite(tile.anchor?.y) ? Number(tile.anchor.y) : 0.5));

      // Convert from anchor-based coordinates to top-left coordinates on the canvas
      const topLeftX = rawX - (anchorX * width);
      const topLeftY = rawY - (anchorY * height);

      const x = topLeftX / gridSize;
      const y = topLeftY / gridSize;
      const cols = width / gridSize;
      const rows = height / gridSize;

      const scaleX = Number.isFinite(tile.texture?.scaleX) ? Number(tile.texture.scaleX) : 1;
      const scaleY = Number.isFinite(tile.texture?.scaleY) ? Number(tile.texture.scaleY) : 1;

      return {
        id: tile.id ?? null,
        src,
        x,
        y,
        cols,
        rows,
        anchorX,
        anchorY,
        scaleX,
        scaleY,
        rotation: Number(tile.rotation) || 0,
        alpha: Number.isFinite(tile.alpha) ? Number(tile.alpha) : 1,
        zIndex: Number(tile.sort ?? tile.elevation ?? 1),
        overhead: tile.overhead === true
      };
    })
    .filter(Boolean);
}

function sceneBackdrop(scene, gridSize, gridColumns, gridRows) {
  const src = scene?.background?.src ?? scene?.img ?? "";
  if ( typeof src !== "string" || !src ) return null;
  const sceneX = Number(scene.dimensions?.sceneX);
  const sceneY = Number(scene.dimensions?.sceneY);
  const sceneW = Number(scene.dimensions?.sceneWidth ?? scene.width);
  const sceneH = Number(scene.dimensions?.sceneHeight ?? scene.height);
  const hasOrigin = Number.isFinite(sceneX) && Number.isFinite(sceneY);
  return {
    src,
    x: hasOrigin ? sceneX / gridSize : 0,
    y: hasOrigin ? sceneY / gridSize : 0,
    cols: Number.isFinite(sceneW) && sceneW > 0 ? sceneW / gridSize : gridColumns,
    rows: Number.isFinite(sceneH) && sceneH > 0 ? sceneH / gridSize : gridRows
  };
}

// Foundry wall.door: 0 none, 1 door, 2 secret door. wall.ds: 0 closed, 1 open, 2 locked.
// Edge kinds are ranked so that, when several walls share an edge, the most blocking kind is drawn.
const EDGE_RANK = { open: 1, "secret-open": 1, window: 1.5, wall: 2, closed: 3, locked: 4 };

// CONST.WALL_SENSE_TYPES: PROXIMITY = 30, DISTANCE = 40. Foundry's window walls use these on light/sight.
function isWindowWall(wall) {
  if ( Number(wall.door ?? 0) !== 0 ) return false;
  const sight = Number(wall.sight ?? wall.sense ?? 20);
  const light = Number(wall.light ?? 20);
  const move = Number(wall.move ?? 20);
  // Foundry windows: sight is NONE (0) or PROXIMITY/DISTANCE (30, 40) while move blocks (move !== 0)
  if ( [30, 40].includes(sight) || [30, 40].includes(light) ) return true;
  if ( sight === 0 && move !== 0 ) return true;
  return false;
}

function wallEdgeKind(wall, isGM) {
  const door = Number(wall.door ?? 0);
  if ( !door ) return isWindowWall(wall) ? "window" : "wall";
  // A secret door the GM has opened is revealed to everyone; otherwise players see an ordinary wall.
  if ( door === 2 && Number(wall.ds ?? 0) === 1 ) return "secret-open";
  if ( door === 2 && !isGM ) return isWindowWall(wall) ? "window" : "wall";
  switch ( Number(wall.ds ?? 0) ) {
    case 1: return "open";
    case 2: return "locked";
    default: return "closed";
  }
}

function addDiagonalWall(coordinates, gridSize, addVertical, addHorizontal) {
  const [x1, y1, x2, y2] = coordinates;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if ( !dx || !dy ) return;

  let column = Math.floor(x1 / gridSize);
  let row = Math.floor(y1 / gridSize);
  const endColumn = Math.floor(x2 / gridSize);
  const endRow = Math.floor(y2 / gridSize);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const deltaX = gridSize / Math.abs(dx);
  const deltaY = gridSize / Math.abs(dy);
  const boundaryX = stepX > 0 ? (column + 1) * gridSize : column * gridSize;
  const boundaryY = stepY > 0 ? (row + 1) * gridSize : row * gridSize;
  let crossingX = (boundaryX - x1) / dx;
  let crossingY = (boundaryY - y1) / dy;
  const maxSteps = Math.abs(endColumn - column) + Math.abs(endRow - row) + 2;
  let steps = 0;

  while ( (column !== endColumn || row !== endRow) && steps++ < maxSteps ) {
    if ( Math.abs(crossingX - crossingY) < 1e-10 ) {
      addVertical(stepX > 0 ? column + 1 : column, row);
      addHorizontal(column, stepY > 0 ? row + 1 : row);
      column += stepX;
      row += stepY;
      crossingX += deltaX;
      crossingY += deltaY;
    }
    else if ( crossingX < crossingY ) {
      addVertical(stepX > 0 ? column + 1 : column, row);
      column += stepX;
      crossingX += deltaX;
    }
    else {
      addHorizontal(column, stepY > 0 ? row + 1 : row);
      row += stepY;
      crossingY += deltaY;
    }
  }
}

function tokenGridPosition(token, gridSize) {
  const x = Number(token.x);
  const y = Number(token.y);
  if ( !Number.isFinite(x) || !Number.isFinite(y) ) return null;
  const width = Number(token.width);
  const height = Number(token.height);
  return {
    x: Math.floor((x + (Number.isFinite(width) ? width * gridSize / 2 : 0)) / gridSize),
    y: Math.floor((y + (Number.isFinite(height) ? height * gridSize / 2 : 0)) / gridSize)
  };
}

/**
 * Grid footprint of a token: its size in cells and the top-left cell it covers, derived from the cell under its
 * centre so it matches the centre-based positioning used everywhere else. Sizes below one cell count as one.
 */
function tokenFootprint(token, centre) {
  const w = Math.max(1, Math.round(Number(token.width) || 1));
  const h = Math.max(1, Math.round(Number(token.height) || 1));
  return { w, h, x0: centre.x - Math.floor(w / 2), y0: centre.y - Math.floor(h / 2), large: w > 1 || h > 1 };
}

function coversCell(token, x, y) {
  return x >= token.x0 && x < token.x0 + token.w && y >= token.y0 && y < token.y0 + token.h;
}

/**
 * Where a large token's outline is anchored inside the seven-cell window: the first visible cell of its footprint,
 * plus how many cells of it are cut off on the top/left (the frame clips whatever sticks out).
 */
function windowPlacement(token, originX, originY) {
  const left = token.x0 - originX;
  const top = token.y0 - originY;
  if ( left > MAP_SIZE - 1 || top > MAP_SIZE - 1 || left + token.w - 1 < 0 || top + token.h - 1 < 0 ) return null;
  return { column: Math.max(left, 0), row: Math.max(top, 0), dx: Math.max(-left, 0), dy: Math.max(-top, 0) };
}

// When non-player creatures share a cell, the most threatening kind gives the cell its colour and its big dot.
const STACK_PRIORITY = { hostile: 0, neutral: 1, other: 2, friendly: 3 };
const MAX_BADGE_SLOTS = 2;

function stackRank(token) {
  return STACK_PRIORITY[token.kind] ?? STACK_PRIORITY.other;
}

/** The creature that gives a shared cell its colour: lowest rank wins, earlier tokens win ties. */
function stackLead(tokens) {
  return tokens.reduce((lead, token) => (!lead || stackRank(token) < stackRank(lead) ? token : lead), null);
}

function makeWallEdges(scene, gridSize, columns, rows, isGM=false) {
  const edges = new Map();
  let kind = "wall";
  const put = key => {
    if ( (EDGE_RANK[edges.get(key)] ?? 0) < EDGE_RANK[kind] ) edges.set(key, kind);
  };
  const addVertical = (boundary, row) => {
    if ( boundary < 0 || boundary > columns || row < 0 || row >= rows ) return;
    put(`v:${boundary}:${row}`);
  };
  const addHorizontal = (column, boundary) => {
    if ( column < 0 || column >= columns || boundary < 0 || boundary > rows ) return;
    put(`h:${column}:${boundary}`);
  };

  for ( const wall of collectionValues(scene.walls) ) {
    if ( wall.hidden === true ) continue;
    kind = wallEdgeKind(wall, isGM);
    const coordinates = Array.from(wall.c ?? [], Number);
    if ( coordinates.length < 4 || coordinates.slice(0, 4).some(value => !Number.isFinite(value)) ) continue;
    const [x1, y1, x2, y2] = coordinates;
    const tolerance = Math.min(2, gridSize * 0.05);
    if ( Math.abs(x2 - x1) <= tolerance ) {
      const boundary = Math.round(((x1 + x2) / 2) / gridSize);
      const firstRow = Math.floor(Math.min(y1, y2) / gridSize);
      const lastRow = Math.ceil(Math.max(y1, y2) / gridSize) - 1;
      for ( let row = firstRow; row <= lastRow; row++ ) addVertical(boundary, row);
    }
    else if ( Math.abs(y2 - y1) <= tolerance ) {
      const boundary = Math.round(((y1 + y2) / 2) / gridSize);
      const firstColumn = Math.floor(Math.min(x1, x2) / gridSize);
      const lastColumn = Math.ceil(Math.max(x1, x2) / gridSize) - 1;
      for ( let column = firstColumn; column <= lastColumn; column++ ) addHorizontal(column, boundary);
    }
    else addDiagonalWall([x1, y1, x2, y2], gridSize, addVertical, addHorizontal);
  }
  return edges;
}

function localize(key) {
  return globalThis.game?.i18n?.localize(key) ?? key;
}

function edgeKind(map, x, y, side) {
  if ( side === "left" ) return map.wallEdges.get(`v:${x}:${y}`);
  if ( side === "right" ) return map.wallEdges.get(`v:${x + 1}:${y}`);
  if ( side === "top" ) return map.wallEdges.get(`h:${x}:${y}`);
  return map.wallEdges.get(`h:${x}:${y + 1}`);
}

function hasWall(map, x, y, side) {
  return edgeKind(map, x, y, side) === "wall";
}

/** Door state of a cell side ("open", "closed", "locked"), or null when the side has no door. */
function doorState(map, x, y, side) {
  const kind = edgeKind(map, x, y, side);
  return kind && kind !== "wall" && kind !== "window" ? kind : null;
}

function hasWindow(map, x, y, side) {
  return edgeKind(map, x, y, side) === "window";
}

function minimapDebugEnabled() {
  return new URLSearchParams(globalThis.location?.search ?? "").get("minimapDebug") === "1";
}

/**
 * Map the seven-cell window from the real token world position and scene documents.
 * The character is always at row/column four (zero-based index three); the map never moves any document.
 */

export function sceneWallSegments(scene, gridSize, originX, originY, isGM=false) {
  const walls = collectionValues(scene?.walls);
  if ( !walls.length ) return [];

  const segments = [];
  for ( const wall of walls ) {
    if ( wall.hidden === true ) continue;
    const coordinates = Array.from(wall.c ?? [], Number);
    if ( coordinates.length < 4 || coordinates.slice(0, 4).some(value => !Number.isFinite(value)) ) continue;

    const [wx1, wy1, wx2, wy2] = coordinates;
    const x1 = (wx1 / gridSize) - originX;
    const y1 = (wy1 / gridSize) - originY;
    const x2 = (wx2 / gridSize) - originX;
    const y2 = (wy2 / gridSize) - originY;

    if ( (x1 < -0.5 && x2 < -0.5) || (x1 > 7.5 && x2 > 7.5) ||
         (y1 < -0.5 && y2 < -0.5) || (y1 > 7.5 && y2 > 7.5) ) {
      continue;
    }

    const kind = wallEdgeKind(wall, isGM);
    const isDoor = wall.door === 1 || (wall.door === 2 && (wall.ds === 1 || isGM));
    const isSecret = wall.door === 2;
    const isWindow = isWindowWall(wall) || kind === "window";
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const length = Math.hypot(x2 - x1, y2 - y1);

    segments.push({
      id: wall.id ?? null,
      kind,
      isDoor,
      isSecret,
      isWindow,
      x1: Number(x1.toFixed(3)),
      y1: Number(y1.toFixed(3)),
      x2: Number(x2.toFixed(3)),
      y2: Number(y2.toFixed(3)),
      midX: Number(midX.toFixed(3)),
      midY: Number(midY.toFixed(3)),
      length: Number(length.toFixed(3)),
      sense: Number(wall.sense ?? 10),
      doorState: wall.ds
    });
  }
  return segments;
}

export function lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const dx1 = x2 - x1;
  const dy1 = y2 - y1;
  const dx2 = x4 - x3;
  const dy2 = y4 - y3;

  const denominator = dx1 * dy2 - dy1 * dx2;
  if ( Math.abs(denominator) < 1e-9 ) return false;

  const s = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / denominator;
  const t = ((x3 - x1) * dy1 - (y3 - y1) * dx1) / denominator;

  return s > 0.05 && s < 0.95 && t >= -0.01 && t <= 1.01;
}

function computeCircleVisibilityPolygon(ox, oy, radius, wallSegments) {
  const TWO_PI = 2 * Math.PI;
  const norm = a => {
    let r = a % TWO_PI;
    return r < 0 ? r + TWO_PI : r;
  };

  const angles = [];
  for ( let a = 0; a < 360; a += 5 ) {
    angles.push(a * Math.PI / 180);
  }
  for ( const s of wallSegments ) {
    for ( const pt of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }] ) {
      const a = norm(Math.atan2(pt.y - oy, pt.x - ox));
      angles.push(norm(a - 0.0001));
      angles.push(a);
      angles.push(norm(a + 0.0001));
    }
  }
  angles.sort((a, b) => a - b);

  const poly = [];
  for ( const angle of angles ) {
    const rdx = Math.cos(angle);
    const rdy = Math.sin(angle);
    let minT = radius;
    for ( const s of wallSegments ) {
      const sdx = s.x2 - s.x1;
      const sdy = s.y2 - s.y1;
      const denom = rdx * sdy - rdy * sdx;
      if ( Math.abs(denom) < 1e-9 ) continue;
      const t1 = ((s.x1 - ox) * sdy - (s.y1 - oy) * sdx) / denom;
      const t2 = ((s.x1 - ox) * rdy - (s.y1 - oy) * rdx) / denom;
      if ( t1 > 0.005 && t1 < minT && t2 >= -0.001 && t2 <= 1.001 ) {
        minT = t1;
      }
    }
    const px = Number((ox + rdx * minT).toFixed(2));
    const py = Number((oy + rdy * minT).toFixed(2));
    poly.push({ x: px, y: py });
  }
  const filtered = [];
  for ( let i = 0; i < poly.length; i++ ) {
    const prev = filtered[filtered.length - 1];
    if ( !prev || Math.hypot(poly[i].x - prev.x, poly[i].y - prev.y) > 0.02 ) {
      filtered.push(poly[i]);
    }
  }
  if ( filtered.length > 2 && Math.hypot(filtered[filtered.length - 1].x - filtered[0].x, filtered[filtered.length - 1].y - filtered[0].y) <= 0.02 ) {
    filtered.pop();
  }
  return filtered;
}

export function computeMinimapVision(scene, playerToken, actor, gridSize, originX, originY, wallSegments, isGM=false) {
  let visionSetting = true;
  try {
    visionSetting = globalThis.game?.settings?.get(MODULE_ID, SETTINGS.MINIMAP_TOKEN_VISION) !== false;
  } catch(err) {
    visionSetting = true;
  }
  if ( !visionSetting || scene?.tokenVision !== true ) {
    return { hasVision: false, isGlobalLit: true, isDarkness: false, hasDarkvision: false, darkvisionRadius: 0, darkvisionPolygonString: "", lightSources: [], cells: [] };
  }

  const gridDist = Number(scene?.grid?.distance ?? 5) || 5;
  const darkness = Number(scene?.darkness ?? 0);
  const globalLightSetting = scene?.globalLight === true || scene?.environment?.globalLight?.enabled === true;
  const globalLightThreshold = Number(scene?.globalLightThreshold ?? scene?.environment?.globalLight?.threshold ?? 1);
  const isGlobalLit = globalLightSetting && (darkness < globalLightThreshold);
  const isDarkness = !isGlobalLit;

  const isBlinded = actor?.statuses?.has("blind") || actor?.statuses?.has("blinded")
    || (Array.isArray(actor?.effects) && actor.effects.some(e => !e.disabled && (e.name?.toLowerCase().includes("blind") || e.statuses?.has("blind"))));

  const sightDoc = playerToken?.document?.sight ?? playerToken?.sight ?? {};
  const sightEnabled = sightDoc.enabled !== false && !isBlinded;
  
  let actorDarkvision = 0;
  const rawSense = actor?.system?.attributes?.senses?.darkvision;
  if ( typeof rawSense === "number" ) actorDarkvision = rawSense;
  else if ( typeof rawSense === "string" ) actorDarkvision = parseFloat(rawSense) || 0;
  else if ( rawSense && typeof rawSense.value !== "undefined" ) actorDarkvision = parseFloat(rawSense.value) || 0;

  const rawSightRange = typeof sightDoc.range !== "undefined" && sightDoc.range !== null ? Number(sightDoc.range) : 0;
  const hasDarkvisionSense = sightDoc.visionMode === "darkvision" || rawSightRange > 0 || actorDarkvision > 0;
  const darkvisionFeet = rawSightRange > 0 ? rawSightRange : (actorDarkvision > 0 ? actorDarkvision : 0);
  const darkvisionRadiusCells = sightEnabled && hasDarkvisionSense ? (darkvisionFeet / gridDist) : 0;
  const hasDarkvision = darkvisionRadiusCells > 0;
  const sightRadiusCells = darkvisionRadiusCells;

  // Token light source (torch, lantern, etc.)
  const lightDoc = playerToken?.document?.light ?? playerToken?.light ?? {};
  const lightDim = Number(lightDoc.dim ?? 0);
  const lightBright = Number(lightDoc.bright ?? 0);
  const playerLightRadiusCells = Math.max(lightDim, lightBright) / gridDist;

  function mapAnimType(type) {
    if (!type) return "torch";
    const t = String(type).toLowerCase();
    if (t.includes("torch") || t.includes("flame") || t.includes("fire")) return "torch";
    if (t.includes("pulse") || t.includes("breathe")) return "pulse";
    if (t.includes("chroma") || t.includes("rainbow")) return "chroma";
    if (t.includes("wave") || t.includes("energy")) return "wave";
    if (t.includes("fairy") || t.includes("ghost") || t.includes("drift")) return "fairy";
    return "torch";
  }

  const sightBlockingWalls = (wallSegments || []).filter(s => {
    if ( s.isDoor && s.doorState === 1 ) return false;
    if ( s.isWindow || s.kind === "window" ) return false;
    return s.sense !== 0;
  });

  function hasLineOfSight(ax, ay, bx, by) {
    for ( const w of sightBlockingWalls ) {
      if ( lineSegmentsIntersect(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2) ) return false;
    }
    return true;
  }

  const pcx = 3.5;
  const pcy = 3.5;

  const lightSources = [];
  if ( playerLightRadiusCells > 0 ) {
    const rawAnim = lightDoc.animation?.type || (lightDoc.animation ? "torch" : null);
    const animType = rawAnim ? mapAnimType(rawAnim) : (lightDim > 0 || lightBright > 0 ? "torch" : null);
    
    let poly = [];
    const sourceId = playerToken?.sourceId || `Token.${playerToken?.id}`;
    const nativeLightSource = globalThis.canvas?.effects?.lightSources?.get(sourceId)
                           || globalThis.canvas?.effects?.lightSources?.get(playerToken?.id)
                           || playerToken?.lightSource;
    const rawPts = nativeLightSource?.shape?.points || nativeLightSource?.los?.points;
    if ( rawPts && rawPts.length >= 6 ) {
      for ( let i = 0; i < rawPts.length; i += 2 ) {
        poly.push({
          x: Number(((rawPts[i] / gridSize) - originX).toFixed(2)),
          y: Number(((rawPts[i + 1] / gridSize) - originY).toFixed(2))
        });
      }
    }
    if ( !poly.length ) {
      poly = computeCircleVisibilityPolygon(pcx, pcy, playerLightRadiusCells, sightBlockingWalls);
    }

    const radiusPct = Number(((playerLightRadiusCells / 7) * 100).toFixed(2));
    const maskOuterPct = radiusPct;
    const maskInnerPct = Number((radiusPct * 0.65).toFixed(2));
    const maskMid1Pct = Number((radiusPct * 0.82).toFixed(2));
    const maskMid2Pct = Number((radiusPct * 0.94).toFixed(2));

    lightSources.push({
      id: "player-light",
      cx: 3.5,
      cy: 3.5,
      radius: Number(playerLightRadiusCells.toFixed(2)),
      brightRadius: Number((lightBright / gridDist).toFixed(2)),
      color: lightDoc.color || "#ffaa33",
      alpha: Number(lightDoc.alpha ?? 0.45),
      animType,
      animationClass: animType ? `anim-${animType}` : "",
      polygonString: poly.map(p => `${p.x},${p.y}`).join(" "),
      clipPolygonString: poly.map(p => `${(p.x / 7).toFixed(4)},${(p.y / 7).toFixed(4)}`).join(" "),
      cssClipPolygon: poly.map(p => `${((p.x / 7) * 100).toFixed(2)}% ${((p.y / 7) * 100).toFixed(2)}%`).join(", "),
      cxNorm: (3.5 / 7).toFixed(4),
      cyNorm: (3.5 / 7).toFixed(4),
      rNorm: (playerLightRadiusCells / 7).toFixed(4),
      radiusPct,
      maskInnerPct,
      maskMid1Pct,
      maskMid2Pct,
      maskOuterPct,
      leftPct: Number(((3.5 / 7) * 100).toFixed(2)),
      topPct: Number(((3.5 / 7) * 100).toFixed(2)),
      diameterPct: Number((((playerLightRadiusCells * 2) / 7) * 100).toFixed(2))
    });
  }

  const rawAmbientLights = collectionValues(scene?.lights);
  for ( const l of rawAmbientLights ) {
    if ( l.hidden === true || l.enabled === false ) continue;
    const lx = Number(l.x) / gridSize;
    const ly = Number(l.y) / gridSize;
    const cx = lx - originX;
    const cy = ly - originY;
    
    // Support Foundry v10, v11, v12, v13 (l.config) as well as legacy v9 (l)
    const dim = Number(l.config?.dim ?? l.dim ?? 0) / gridDist;
    const bright = Number(l.config?.bright ?? l.bright ?? 0) / gridDist;
    const radius = Math.max(dim, bright);
    
    if ( radius > 0 && cx >= -6 && cx <= 13 && cy >= -6 && cy <= 13 ) {
      const rawAnim = l.config?.animation?.type || l.animation?.type || null;
      const animType = rawAnim ? mapAnimType(rawAnim) : (l.config?.animation ? "torch" : null);
      const color = l.config?.color || l.color || "#ffaa33";
      const alpha = Number(l.config?.alpha ?? l.alpha ?? 0.45);
      
      let poly = [];
      const sourceId = l.sourceId || `AmbientLight.${l.id}`;
      const nativeLightSource = globalThis.canvas?.effects?.lightSources?.get(sourceId)
                             || globalThis.canvas?.effects?.lightSources?.get(l.id)
                             || l.source;
      const rawPts = nativeLightSource?.shape?.points || nativeLightSource?.los?.points;
      if ( rawPts && rawPts.length >= 6 ) {
        for ( let i = 0; i < rawPts.length; i += 2 ) {
          poly.push({
            x: Number(((rawPts[i] / gridSize) - originX).toFixed(2)),
            y: Number(((rawPts[i + 1] / gridSize) - originY).toFixed(2))
          });
        }
      }
      if ( !poly.length ) {
        poly = computeCircleVisibilityPolygon(cx, cy, radius, sightBlockingWalls);
      }
      
      const radiusPct = Number(((radius / 7) * 100).toFixed(2));
      const maskOuterPct = radiusPct;
      const maskInnerPct = Number((radiusPct * 0.65).toFixed(2));
      const maskMid1Pct = Number((radiusPct * 0.82).toFixed(2));
      const maskMid2Pct = Number((radiusPct * 0.94).toFixed(2));

      lightSources.push({
        id: `light-${l.id || Math.random()}`,
        cx: Number(cx.toFixed(2)),
        cy: Number(cy.toFixed(2)),
        radius: Number(radius.toFixed(2)),
        brightRadius: Number((bright / gridDist).toFixed(2)),
        color,
        alpha,
        animType,
        animationClass: animType ? `anim-${animType}` : "",
        polygonString: poly.map(p => `${p.x},${p.y}`).join(" "),
        clipPolygonString: poly.map(p => `${(p.x / 7).toFixed(4)},${(p.y / 7).toFixed(4)}`).join(" "),
        cssClipPolygon: poly.map(p => `${((p.x / 7) * 100).toFixed(2)}% ${((p.y / 7) * 100).toFixed(2)}%`).join(", "),
        cxNorm: (cx / 7).toFixed(4),
        cyNorm: (cy / 7).toFixed(4),
        rNorm: (radius / 7).toFixed(4),
        radiusPct,
        maskInnerPct,
        maskMid1Pct,
        maskMid2Pct,
        maskOuterPct,
        leftPct: Number(((cx / 7) * 100).toFixed(2)),
        topPct: Number(((cy / 7) * 100).toFixed(2)),
        diameterPct: Number((((radius * 2) / 7) * 100).toFixed(2))
      });
    }
  }

  const visionGrid = [];
  for ( let r = 0; r < MAP_SIZE; r++ ) {
    for ( let c = 0; c < MAP_SIZE; c++ ) {
      const cellCenterX = c + 0.5;
      const cellCenterY = r + 0.5;
      const distFromPlayer = Math.hypot(cellCenterX - pcx, cellCenterY - pcy);

      const fogX = c === 0 ? -0.8 : c - 0.1;
      const fogY = r === 0 ? -0.8 : r - 0.1;
      const fogW = (c === 0 ? 0.9 : 0.2) + (c === 6 ? 0.9 : 0.2) + 1.0;
      const fogH = (r === 0 ? 0.9 : 0.2) + (r === 6 ? 0.9 : 0.2) + 1.0;

      if ( isGlobalLit && !isBlinded ) {
        const los = hasLineOfSight(pcx, pcy, cellCenterX, cellCenterY);
        visionGrid.push({
          col: c,
          row: r,
          seen: los,
          lit: true,
          darkness: !los,
          isDarkvision: false,
          fogX: Number(fogX.toFixed(2)),
          fogY: Number(fogY.toFixed(2)),
          fogW: Number(fogW.toFixed(2)),
          fogH: Number(fogH.toFixed(2))
        });
        continue;
      }

      // Darkness mode (global light is off)
      const losToPlayer = hasLineOfSight(pcx, pcy, cellCenterX, cellCenterY);
      const litByPlayer = losToPlayer && (distFromPlayer <= playerLightRadiusCells);
      let litByAmbient = false;
      for ( const ls of lightSources ) {
        if ( ls.id !== "player-light" && Math.hypot(cellCenterX - ls.cx, cellCenterY - ls.cy) <= ls.radius ) {
          if ( hasLineOfSight(ls.cx, ls.cy, cellCenterX, cellCenterY) ) {
            litByAmbient = true;
            break;
          }
        }
      }
      const isLit = litByPlayer || (litByAmbient && losToPlayer);
      const seenByDarkvision = hasDarkvision && losToPlayer && (distFromPlayer <= darkvisionRadiusCells);
      const isCenter = c === 3 && r === 3;
      const isSeen = isLit || seenByDarkvision || isCenter;
      const inDarkness = !isSeen;
      const isDarkvisionCell = seenByDarkvision && !isLit;

      visionGrid.push({
        col: c,
        row: r,
        seen: isSeen,
        lit: isLit,
        darkness: inDarkness,
        isDarkvision: isDarkvisionCell,
        fogX: Number(fogX.toFixed(2)),
        fogY: Number(fogY.toFixed(2)),
        fogW: Number(fogW.toFixed(2)),
        fogH: Number(fogH.toFixed(2))
      });
    }
  }

  // Daylight LOS Polygon (20 cells radius)
  let sightPolygonPoints = [];
  const sourceId = playerToken?.sourceId || `Token.${playerToken?.id}`;
  const visionSource = globalThis.canvas?.effects?.visionSources?.get(sourceId)
                    || globalThis.canvas?.effects?.visionSources?.get(playerToken?.id)
                    || playerToken?.vision;
  if ( visionSource?.los?.points && visionSource.los.points.length >= 6 ) {
    const raw = visionSource.los.points;
    for ( let i = 0; i < raw.length; i += 2 ) {
      const mx = Number(((raw[i] / gridSize) - originX).toFixed(2));
      const my = Number(((raw[i + 1] / gridSize) - originY).toFixed(2));
      sightPolygonPoints.push(`${mx},${my}`);
    }
  }

  if ( !sightPolygonPoints.length && !isBlinded ) {
    const poly = computeCircleVisibilityPolygon(pcx, pcy, 20, sightBlockingWalls);
    sightPolygonPoints = poly.map(p => `${p.x},${p.y}`);
  }

  // Smooth circular Darkvision Polygon
  let darkvisionPolygonString = "";
  if ( hasDarkvision && !isBlinded ) {
    const dvPoly = computeCircleVisibilityPolygon(pcx, pcy, darkvisionRadiusCells, sightBlockingWalls);
    darkvisionPolygonString = dvPoly.map(p => `${p.x},${p.y}`).join(" ");
  }

  let litClipPath = "";
  let litMaskImage = "";
  if ( lightSources.length > 0 ) {
    litMaskImage = lightSources
      .map(ls => `radial-gradient(circle at ${ls.leftPct}% ${ls.topPct}%, #000 0%, #000 ${ls.maskInnerPct}%, rgba(0, 0, 0, 0.85) ${ls.maskMid1Pct}%, rgba(0, 0, 0, 0.25) ${ls.maskMid2Pct}%, transparent ${ls.maskOuterPct}%)`)
      .join(", ");

    if ( lightSources.length === 1 ) {
      const ls0 = lightSources[0];
      litClipPath = ls0.cssClipPolygon
        ? `polygon(${ls0.cssClipPolygon})`
        : `circle(${((ls0.radius / 7) * 100).toFixed(2)}% at ${ls0.leftPct}% ${ls0.topPct}%)`;
    } else {
      litClipPath = "url(#pocket5e-light-clip)";
    }
  }

  return {
    hasVision: true,
    isGlobalLit,
    isDarkness,
    hasDarkvision,
    darkvisionRadius: Number(darkvisionRadiusCells.toFixed(2)),
    darkvisionPolygonString,
    lightSources,
    litClipPath,
    litMaskImage,
    cells: visionGrid,
    sightPolygonString: sightPolygonPoints.join(" "),
    playerSightRange: sightRadiusCells,
    playerLightRange: playerLightRadiusCells
  };
}

export function buildMovementMapWindow(map) {
  if ( !map.available || !map.player ) return [];
  const originX = map.player.x - CENTER;
  const originY = map.player.y - CENTER;
  return Array.from({ length: MAP_SIZE }, (_, rowIndex) => ({
    cells: Array.from({ length: MAP_SIZE }, (_, columnIndex) => {
      const x = originX + columnIndex;
      const y = originY + rowIndex;
      const player = rowIndex === CENTER && columnIndex === CENTER;
      const walls = {
        top: hasWall(map, x, y, "top"),
        right: hasWall(map, x, y, "right"),
        bottom: hasWall(map, x, y, "bottom"),
        left: hasWall(map, x, y, "left")
      };
      const doors = {
        top: doorState(map, x, y, "top"),
        right: doorState(map, x, y, "right"),
        bottom: doorState(map, x, y, "bottom"),
        left: doorState(map, x, y, "left")
      };
      const windows = {
        top: hasWindow(map, x, y, "top"),
        right: hasWindow(map, x, y, "right"),
        bottom: hasWindow(map, x, y, "bottom"),
        left: hasWindow(map, x, y, "left")
      };
      const outside = x < 0 || y < 0 || x >= map.gridColumns || y >= map.gridRows;
      // Small creatures are dots in their own cell; large ones are one outline spanning their whole footprint,
      // attached to the first visible cell of it. The player's own body is drawn the same way when it is large.
      const bodies = map.playerBody?.large
        ? [{ ...map.playerBody, id: map.playerTokenId, kind: "player", img: map.playerImg ?? "" }]
        : [];
      // Creatures overlapping each other or the player (same cell, or standing inside a large one's footprint) get
      // a tinted, dashed cell and corner badges, coloured by the most threatening kind present.
      // The player's own token counts as one occupant, so a single other creature there is already a shared cell.
      const sharing = map.tokens.filter(token => coversCell(token, x, y));
      const stacked = sharing.length > (player ? 0 : 1);
      const stackKind = stacked ? stackLead(sharing).kind : null;
      const stackDot = stacked && !player ? stackLead(sharing.filter(token => !token.large)) : null;
      let badgeSlot = 0;
      const tokens = [...bodies, ...map.tokens]
        .map(token => ({ token, placement: token.large ? windowPlacement(token, originX, originY) : null }))
        .filter(({ token, placement }) => token.large
          ? placement?.column === columnIndex && placement?.row === rowIndex
          : token.x === x && token.y === y)
        .map(({ token, placement }) => ({
          ...token,
          coLocated: !token.large && (player || (stacked && token !== stackDot)),
          ...(token.large ? { cols: token.w, rows: token.h, dx: placement.dx, dy: placement.dy } : {}),
          label: localize(TOKEN_KIND_LABEL[token.kind])
        }))
        // Several corner badges in one cell sit side by side instead of on top of each other.
        .map(token => token.coLocated ? { ...token, slot: Math.min(badgeSlot++, MAX_BADGE_SLOTS) } : token);
      // Standing anywhere inside a friendly creature's footprint counts as sharing its space.
      
      const visionCell = map.visionGrid?.find(v => v.col === columnIndex && v.row === rowIndex);
      const inDarkness = map.hasVision && visionCell ? visionCell.darkness : false;
      const isLit = map.hasVision && visionCell ? visionCell.lit : false;
      const isSeen = map.hasVision && visionCell ? visionCell.seen : true;
      const isDarkvision = map.hasVision && visionCell ? Boolean(visionCell.isDarkvision) : false;
      const visibleTokens = tokens.map(t => ({ ...t, inDarkness: inDarkness && t.kind !== "player" }));
      const occupiedFriendly = player
        && map.tokens.some(token => token.kind === "friendly" && coversCell(token, x, y));
      return {
        x,
        y,
        player,
        occupiedFriendly,
        stacked,
        stackKind,
        outside,
        debug: `${x},${y} T:${Number(walls.top)} R:${Number(walls.right)} B:${Number(walls.bottom)} L:${Number(walls.left)}`,
        className: `pocket5e-minimap-cell${player ? " player" : ""}${outside ? " outside" : ""}${occupiedFriendly ? " occupied-friendly" : ""}${stacked ? ` stacked stacked-${stackKind}` : ""}${tokens.length ? " has-token" : ""}${tokens.some(token => !token.large) ? " has-small-token" : ""}${inDarkness ? " in-darkness" : ""}${isLit ? " lit" : ""}`,
        walls,
        doors,
        windows,
        seen: isSeen,
        lit: isLit,
        darkness: inDarkness,
        isDarkvision,
        tokens: visibleTokens
      };
    })
  }));
}

/**
 * Read map data from the selected scene, filtering hidden tokens and requiring the selected actor's ownership.
 * No canvas or synthetic map is used. Scene artwork is optional (GM world setting) and cropped to the same
 * seven-cell window as the tokens.
 */
export function prepareMovementMap(scene, actor, user) {
  if ( !scene || !actor?.id || !ownedByUser(actor, user) ) {
    return { available: false, hasPlayer: false, sceneName: "", rows: [] };
  }

  const gridSize = Number(scene.grid?.size ?? scene.dimensions?.size);
  const width = Number(scene.width);
  const height = Number(scene.height);
  if ( !Number.isFinite(gridSize) || gridSize <= 0
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ) {
    return { available: false, hasPlayer: false, sceneName: scene.navName || scene.name || "", rows: [] };
  }

  const columns = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);
  const sceneTokens = collectionValues(scene.tokens);
  const playerToken = sceneTokens.find(token => token.actorId === actor.id && token.hidden !== true);
  const player = playerToken ? tokenGridPosition(playerToken, gridSize) : null;
  if ( !player ) {
    return {
      available: true,
      hasPlayer: false,
      sceneId: scene.id,
      sceneName: scene.navName || scene.name || "",
      rows: [],
      cells: [],
      debug: minimapDebugEnabled()
    };
  }
  const map = {
    available: true,
    sceneId: scene.id,
    sceneName: scene.navName || scene.name || "",
    debug: minimapDebugEnabled(),
    hasPlayer: !!player,
    player,
    playerTokenId: playerToken.id ?? null,
    playerImg: tokenImage(playerToken, actor),
    playerBody: tokenFootprint(playerToken, player),
    playerRotation: Number(playerToken.rotation) || 0,
    originX: player.x - CENTER,
    originY: player.y - CENTER,
    columns,
    gridColumns: columns,
    gridRows: rows,
    sceneBackdrop: sceneBackdrop(scene, gridSize, columns, rows),
    sceneTiles: sceneTiles(scene, gridSize, user?.isGM === true),
    wallEdges: makeWallEdges(scene, gridSize, columns, rows, user?.isGM === true),
    tokens: sceneTokens
      .filter(token => token.hidden !== true && token !== playerToken)
      .map(token => {
        const position = tokenGridPosition(token, gridSize);
        if ( !position ) return null;
        const tokenActor = token.actor ?? globalThis.game?.actors?.get(token.actorId);
        const kind = tokenKind(token, tokenActor);
        return {
          ...position,
          ...tokenFootprint(token, position),
          id: token.id ?? null,
          kind,
          name: token.name ?? tokenActor?.name ?? "",
          img: tokenImage(token, tokenActor),
          rotation: Number(token.rotation) || 0,
          label: localize(TOKEN_KIND_LABEL[kind])
        };
      })
      .filter(Boolean)
  };
  
  const wallSegments = sceneWallSegments(scene, gridSize, map.originX, map.originY, user?.isGM === true);
  const vision = computeMinimapVision(scene, playerToken, actor, gridSize, map.originX, map.originY, wallSegments, user?.isGM === true);
  map.wallSegments = wallSegments;
  map.hasVision = vision.hasVision;
  map.visionGrid = vision.cells;
  map.sightPolygonString = vision.sightPolygonString;
  map.isDarkness = vision.isDarkness;
  map.hasDarkvision = vision.hasDarkvision;
  map.darkvisionRadius = vision.darkvisionRadius;
  map.darkvisionPolygonString = vision.darkvisionPolygonString;
  map.lightSources = vision.lightSources;
  map.litClipPath = vision.litClipPath;
  map.litMaskImage = vision.litMaskImage;
  map.isGlobalLit = vision.isGlobalLit;
  map.playerSightRange = vision.playerSightRange;
  map.playerLightRange = vision.playerLightRange;
  map.hasSceneArtwork = Boolean(map.sceneBackdrop || map.sceneTiles?.length);
  map.rows = buildMovementMapWindow(map);
  map.cells = map.rows.flatMap(row => row.cells);
  map.worldPosition = { x: player.x + 1, y: player.y + 1 };
  return map;
}

/** Snapshot of what the minimap showed, in world coordinates, so the next render can animate the difference. */
export function captureMinimapState(map) {
  if ( !map?.available || !map.player ) return null;
  const tokens = new Map();
  for ( const token of map.tokens ) if ( token.id ) tokens.set(token.id, { x: token.x, y: token.y });
  if ( map.playerTokenId ) tokens.set(map.playerTokenId, { x: map.player.x, y: map.player.y });
  return { sceneId: map.sceneId, player: { x: map.player.x, y: map.player.y }, tokens };
}

const ANIMATION_MS = 220;
const MAX_ANIMATED_CELLS = 2;

/**
 * Animate the change between two minimap states, purely visually (the DOM is already final).
 * The view is always centred on the player, so a step pans every cell (walls, doors, windows, dots) by the
 * player's displacement. Each dot then gets its own extra slide equal to its world displacement: this keeps
 * the player's dot still in the centre and lets creatures that moved slide to their new cell.
 */
export function animateMinimap(grid, previous, next, { duration = ANIMATION_MS } = {}) {
  if ( !grid || !previous || !next || previous.sceneId !== next.sceneId ) return;
  if ( globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ) return;
  const dx = next.player.x - previous.player.x;
  const dy = next.player.y - previous.player.y;
  if ( Math.abs(dx) > MAX_ANIMATED_CELLS || Math.abs(dy) > MAX_ANIMATED_CELLS ) return;
  const options = { duration, easing: "ease-out" };
  const cells = Array.from(grid.querySelectorAll(".pocket5e-minimap-cell"));
  if ( !cells.length || typeof cells[0].animate !== "function" ) return;
  const { width, height } = cells[0].getBoundingClientRect();

  if ( dx || dy ) {
    for ( const cell of cells ) {
      cell.animate([{ translate: `${dx * 100}% ${dy * 100}%` }, { translate: "0 0" }], options);
    }
    const sceneLayer = grid.parentElement?.querySelector(".pocket5e-minimap-scene");
    // The scene layer is the whole 7×7, so one cell is `width` px — not 100% of this element.
    sceneLayer?.animate?.([{ translate: `${dx * width}px ${dy * height}px` }, { translate: "0 0" }], options);
  }
  for ( const dot of grid.querySelectorAll(".pocket5e-minimap-token[data-token-id]") ) {
    const id = dot.dataset.tokenId;
    const before = previous.tokens.get(id);
    const after = next.tokens.get(id);
    if ( !after ) continue;
    if ( !before ) {
      dot.animate([{ opacity: 0 }, { opacity: 1 }], options);
      continue;
    }
    const ex = before.x - after.x;
    const ey = before.y - after.y;
    if ( !ex && !ey ) continue;
    if ( Math.abs(ex) > MAX_ANIMATED_CELLS || Math.abs(ey) > MAX_ANIMATED_CELLS ) continue;
    dot.animate([{ translate: `${ex * width}px ${ey * height}px` }, { translate: "0 0" }], options);
  }
}
