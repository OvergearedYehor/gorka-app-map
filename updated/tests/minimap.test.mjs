import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MOVE_DIRECTIONS } from "../scripts/relay.js";
import { animateMinimap, buildMovementMapWindow, captureMinimapState, prepareMovementMap } from "../scripts/shell/minimap.js";

const user = { id: "player" };
const actor = {
  id: "hero",
  name: "Hero",
  testUserPermission: (candidate, level) => candidate === user && level === "OWNER"
};

function makeScene(overrides={}) {
  return {
    id: "scene-1",
    name: "Battle",
    navName: "The Arena",
    width: 1000,
    height: 1000,
    grid: { size: 100 },
    walls: [
      { c: [600, 400, 600, 800] },
      { c: [400, 600, 800, 600] },
      { c: [200, 500, 500, 800] },
      { c: [900, 400, 900, 800], hidden: true }
    ],
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1, disposition: 1 },
      {
        id: "friend", actorId: "ally", x: 650, y: 450, width: 1, height: 1, disposition: 1,
        actor: { hasPlayerOwner: false }
      },
      {
        id: "foe", actorId: "ogre", x: 750, y: 350, width: 1, height: 1, disposition: -1,
        actor: { hasPlayerOwner: false }
      },
      {
        id: "secret", actorId: "spy", x: 550, y: 550, width: 1, height: 1, disposition: 0, hidden: true,
        actor: { hasPlayerOwner: false }
      }
    ],
    ...overrides
  };
}

test("builds a seven-by-seven display centered on the real player token", () => {
  const map = prepareMovementMap(makeScene(), actor, user);

  assert.equal(map.available, true);
  assert.equal(map.sceneName, "The Arena");
  assert.deepEqual(map.worldPosition, { x: 6, y: 6 });
  assert.equal(map.rows.length, 7);
  assert.equal(map.rows.every(row => row.cells.length === 7), true);
  assert.equal(map.cells.length, 49, "the rendered minimap has exactly 49 cells");
  assert.equal(map.rows[3].cells[3].player, true);
  assert.equal(map.cells[24].player, true, "the player occupies row four, column four");
  assert.deepEqual(
    map.rows.flatMap(row => row.cells.flatMap(cell => cell.tokens.map(token => token.kind))).sort(),
    ["friendly", "hostile"]
  );
});

test("draws visible scene walls as shared neighbouring cell edges, including diagonal walls and boundaries", () => {
  const map = prepareMovementMap(makeScene(), actor, user);
  const view = buildMovementMapWindow(map);
  const center = view[3].cells[3];
  const right = view[3].cells[4];

  assert.equal(center.walls.right, true);
  assert.equal(right.walls.left, true);
  assert.equal(center.walls.bottom, true);
  assert.equal(map.wallEdges.has("v:6:5"), true);
  assert.equal(map.wallEdges.has("v:9:5"), false, "hidden walls aren't exposed to players");
  const edgeScene = makeScene({
    tokens: [{ id: "hero-token", actorId: "hero", x: 0, y: 0, width: 1, height: 1 }]
  });
  const edgeView = prepareMovementMap(edgeScene, actor, user).rows;
  assert.equal(edgeView[3].cells[3].walls.left, false, "scene perimeter is not treated as a wall");
  assert.equal(edgeView[3].cells[3].walls.top, false, "scene perimeter is not treated as a wall");
});

test("does not synthesize a continuous wall along the scene edge outside its bounds", () => {
  const map = prepareMovementMap(makeScene({
    width: 400,
    height: 400,
    tokens: [{ id: "hero-token", actorId: "hero", x: 250, y: 150, width: 1, height: 1 }],
    walls: []
  }), actor, user);

  assert.equal(map.rows[3].cells[3].x, 3, "player stands in the scene's last column");
  assert.deepEqual(map.rows.map(row => row.cells[3].walls.right), [
    false, false, false, false, false, false, false
  ], "no implicit full-height wall is drawn at the scene perimeter");
  assert.equal(map.rows[3].cells[3].debug, "3,2 T:0 R:0 B:0 L:0", "debug data reports cell coordinates and wall sides");
});

test("enables per-cell coordinate and wall diagnostics with minimapDebug=1", () => {
  const previousLocation = globalThis.location;
  globalThis.location = { search: "?minimapDebug=1" };
  try {
    const map = prepareMovementMap(makeScene(), actor, user);
    assert.equal(map.debug, true);
    assert.match(map.cells[24].debug, /^5,5 T:[01] R:[01] B:[01] L:[01]$/);
  }
  finally {
    if ( previousLocation === undefined ) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});

test("keeps token markers round and unchanged beside vertical and horizontal walls", async () => {
  const scene = makeScene({
    walls: [
      { c: [500, 500, 500, 600] },
      { c: [400, 500, 500, 500] },
      { c: [500, 500, 600, 500] },
      { c: [600, 600, 600, 700] },
      { c: [600, 600, 700, 600] },
      { c: [700, 600, 700, 700] }
    ],
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 },
      { id: "friendly", actorId: "ally", x: 350, y: 450, width: 1, height: 1, disposition: 1 },
      { id: "hostile", actorId: "ogre", x: 550, y: 550, width: 1, height: 1, disposition: -1 }
    ]
  });
  const map = prepareMovementMap(scene, actor, user);
  const friendlyCell = map.rows[3].cells[2];
  const hostileCell = map.rows[4].cells[4];
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");

  assert.equal(friendlyCell.tokens[0].kind, "friendly");
  assert.equal(friendlyCell.walls.right, true, "friendly marker touches a vertical wall");
  assert.equal(friendlyCell.walls.top, true, "friendly marker touches a horizontal wall");
  assert.equal(hostileCell.tokens[0].kind, "hostile");
  assert.deepEqual(hostileCell.walls, { top: true, right: true, bottom: false, left: true },
    "hostile marker sits in a cell with walls on three sides");
  assert.match(css, /\.pocket5e-minimap-token\s*\{[^}]*pointer-events:\s*auto;/s);
  assert.match(css, /\.pocket5e-minimap-token\.player\s*\{[^}]*pointer-events:\s*none;/s);
  assert.doesNotMatch(css, /\.pocket5e-minimap-cell\s*\{[^}]*overflow:\s*hidden;/s);
  assert.doesNotMatch(css, /\.pocket5e-minimap-grid\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.pocket5e-minimap-wall\s*\{[^}]*z-index:\s*1;/s);
  assert.match(css, /\.pocket5e-minimap-token\.friendly\s*\{\s*background:\s*#35c759;/);
  assert.match(css, /\.pocket5e-minimap-token\.hostile\s*\{\s*background:\s*#ff4d4d;/);
  assert.match(css, /\.pocket5e-minimap-token\.neutral\s*\{\s*background:\s*#ffb020;/);
  assert.match(css, /\.pocket5e-minimap-token\.player\s*\{[^}]*background:\s*#29b6e6;/);
  for ( const side of ["top", "right", "bottom", "left"] ) {
    assert.match(template, new RegExp(`walls\\.${side}.*pocket5e-minimap-wall ${side}`));
  }
});

test("recentres real token, other tokens, and scene geometry after each original movement direction", () => {
  const directions = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const scene = makeScene({
    walls: [],
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 },
      {
        id: "friend", actorId: "ally", x: 650, y: 450, width: 1, height: 1, disposition: 1,
        actor: { hasPlayerOwner: false }
      }
    ]
  });

  for ( const direction of directions ) {
    scene.tokens[0].x = 450;
    scene.tokens[0].y = 450;
    const delta = MOVE_DIRECTIONS[direction];
    const tokenBeforeMovement = { x: scene.tokens[0].x, y: scene.tokens[0].y };
    scene.tokens[0].x += delta.x * scene.grid.size;
    scene.tokens[0].y += delta.y * scene.grid.size;
    const map = prepareMovementMap(scene, actor, user);

    assert.deepEqual(
      { x: scene.tokens[0].x, y: scene.tokens[0].y },
      { x: tokenBeforeMovement.x + delta.x * 100, y: tokenBeforeMovement.y + delta.y * 100 },
      `${direction} keeps actual token world coordinates`
    );
    assert.equal(map.rows[3].cells[3].player, true, `${direction} keeps the updated token centred`);
    assert.deepEqual(
      [map.rows[3 - delta.y].cells[3 + 2 - delta.x].tokens.length,
        map.rows[3 - delta.y].cells[3 + 2 - delta.x].tokens[0]?.kind],
      [1, "friendly"],
      `${direction} repositions the visible friend relative to the moved token`
    );
  }
});

test("recentres real token, other tokens, and wall edges after vertical and diagonal movement", () => {
  const directions = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  for ( const direction of directions ) {
    const delta = MOVE_DIRECTIONS[direction];
    const scene = makeScene({
      walls: [{ c: [600, 400, 600, 800] }],
      tokens: [
        { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 },
        {
          id: "friend", actorId: "ally", x: 650, y: 450, width: 1, height: 1, disposition: 1,
          actor: { hasPlayerOwner: false }
        }
      ]
    });
    scene.tokens[0].x += delta.x * scene.grid.size;
    scene.tokens[0].y += delta.y * scene.grid.size;
    const map = prepareMovementMap(scene, actor, user);
    const boundaryColumn = 4 - delta.x;

    assert.equal(map.rows[3].cells[3].player, true, `${direction} keeps the player at the map centre`);
    assert.equal(map.rows[3].cells[boundaryColumn - 1].walls.right, true, `${direction} updates wall position`);
    assert.equal(map.rows[3].cells[boundaryColumn].walls.left, true, `${direction} updates shared wall edge`);
  }
});

test("keeps a complete unhighlighted grid when the player is far outside the scene", () => {
  for ( const direction of ["n", "ne", "e", "se", "s", "sw", "w", "nw"] ) {
    const delta = MOVE_DIRECTIONS[direction];
    const scene = makeScene({
      tokens: [{
        id: "hero-token", actorId: "hero",
        x: (delta.x || 1) * 100_000, y: (delta.y || 1) * 100_000, width: 1, height: 1
      }]
    });
    const map = prepareMovementMap(scene, actor, user);

    assert.equal(map.rows.length, 7, `${direction} keeps all seven rows`);
    assert.equal(map.rows.every(row => row.cells.length === 7), true, `${direction} keeps all seven columns`);
    assert.equal(map.rows[3].cells[3].player, true, `${direction} keeps the player centred`);
    assert.equal(map.rows.flatMap(row => row.cells).every(cell => cell.outside), true,
      `${direction} marks all far-away cells outside the scene`);
    assert.equal(map.rows.flatMap(row => row.cells).some(cell => cell.className.split(" ").includes("safe")), false,
      `${direction} does not add safe-zone highlights`);
  }
});

test("keeps the map display-only and shows no simulated map when actual scene data is missing", async () => {
  const unavailable = prepareMovementMap(null, actor, user);
  const noToken = prepareMovementMap(makeScene({
    tokens: [{ actorId: "ally", x: 100, y: 100, disposition: 1, actor: { hasPlayerOwner: false } }]
  }), actor, user);
  const noPermission = prepareMovementMap(makeScene(), {
    ...actor, testUserPermission: () => false
  }, user);
  const minimapSource = await readFile(new URL("../scripts/shell/minimap.js", import.meta.url), "utf8");
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../scripts/shell/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");

  assert.equal(unavailable.available, false);
  assert.equal(unavailable.rows.length, 0);
  assert.equal(noToken.hasPlayer, false);
  assert.equal(noToken.rows.length, 0);
  assert.equal(noPermission.available, false);
  assert.doesNotMatch(minimapSource, /addEventListener|requestTokenMove|\.update\(/);
  assert.doesNotMatch(template, /data-minimap-move|data-minimap-reset|MapTestControls|MapMoveNorth/);
  assert.match(template, /\{\{#each movementMap\.cells\}\}/);
  assert.doesNotMatch(template, /pocket5e-minimap-row/);
  assert.match(appSource, /await requestTokenMove\(this\.actor, target\.dataset\.direction\)/);
  assert.match(appSource, /on\(evt, document => \{ if \( document\.parent === this\.#movementMapScene \) this\.refresh\("more"\); \}\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.pocket5e-minimap-grid\s*\{[^}]*aspect-ratio:\s*1;/s);
  assert.match(css, /\.pocket5e-minimap-cell:nth-child\(-n \+ 7\)\s*\{\s*border-top:\s*0;/);
  assert.doesNotMatch(css, /\.pocket5e-minimap-cell\.outside\s*\{[^}]*background/s);
  assert.doesNotMatch(css, /\.pocket5e-minimap-cell\.safe\b/);
  assert.match(template, /data-debug="\{\{movementMap\.debug\}\}"/);
  assert.match(template, /pocket5e-minimap-debug/);
  assert.match(css, /\.pocket5e-minimap-grid\[data-debug="true"\] \.pocket5e-minimap-debug/);
  assert.match(css, /html:has\(body\.pocket5e-standalone\)\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /#pocket5e-root\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /#pocket5e-root::-webkit-scrollbar\s*\{\s*display:\s*none;/);
  assert.match(css, /\.pocket5e-tab::-webkit-scrollbar\s*\{\s*display:\s*none;/);
});

test("places the map above the unchanged eight-button movement pad", async () => {
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const mapIndex = template.indexOf('class="pocket5e-minimap"');
  const padIndex = template.indexOf('class="pocket5e-movement-pad"');
  const directions = [...template.matchAll(/data-action="moveToken" data-direction="(nw|n|ne|w|e|sw|s|se)"/g)]
    .map(([, direction]) => direction);

  assert.ok(mapIndex < padIndex, "map precedes the original controls");
  assert.equal(template.includes("pocket5e-movement-hint"), false, "no instruction under the pad");
  assert.deepEqual(directions, ["nw", "n", "ne", "w", "e", "sw", "s", "se"]);
});

test("only the controlled actor's own token is player-coloured; other player-owned actors use disposition colours", () => {
  const map = prepareMovementMap(makeScene({
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1, disposition: 1 },
      { id: "pc2", actorId: "pc2", x: 550, y: 450, width: 1, height: 1, disposition: 1, actor: { hasPlayerOwner: true } }
    ]
  }), actor, user);
  const kinds = map.cells.flatMap(cell => cell.tokens.map(token => token.kind));
  assert.deepEqual(kinds, ["friendly"]);
});

test("marks the player's cell as occupied when a friendly creature shares it", () => {
  const scene = makeScene({
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 },
      { id: "ally", actorId: "ally", x: 450, y: 450, width: 1, height: 1, disposition: 1, actor: { hasPlayerOwner: false } },
      { id: "foe", actorId: "ogre", x: 550, y: 450, width: 1, height: 1, disposition: -1, actor: { hasPlayerOwner: false } }
    ]
  });
  const map = prepareMovementMap(scene, actor, user);
  const center = map.rows[3].cells[3];
  assert.equal(center.occupiedFriendly, true);
  assert.ok(center.className.split(" ").includes("occupied-friendly"));
  assert.equal(center.tokens[0].coLocated, true);
  assert.equal(map.rows[3].cells[4].occupiedFriendly, false);
  const alone = prepareMovementMap(makeScene(), actor, user);
  assert.equal(alone.rows[3].cells[3].occupiedFriendly, false);
});

test("marks a cell shared by hostile and other creatures like the player's shared cell", () => {
  const npc = (id, x, y, disposition, extra={}) => ({
    id, actorId: id, x, y, width: 1, height: 1, disposition, actor: { hasPlayerOwner: false }, ...extra
  });
  const hero = { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 };
  // Hostile + neutral on the same cell (5,3): red colours the cell, the red dot stays big, the neutral one is a badge.
  const map = prepareMovementMap(makeScene({
    tokens: [hero, npc("foe", 550, 350, -1), npc("guard", 550, 350, 0), npc("lone", 350, 350, 0)]
  }), actor, user);
  const shared = map.cells.find(cell => cell.stacked);
  assert.ok(shared, "a cell with two creatures is stacked");
  assert.equal(shared.stackKind, "hostile");
  assert.ok(shared.className.split(" ").includes("stacked-hostile"));
  const byId = Object.fromEntries(shared.tokens.map(token => [token.id, token]));
  assert.equal(byId.foe.coLocated, false);
  assert.equal(byId.guard.coLocated, true);
  assert.equal(byId.guard.slot, 0);
  assert.equal(map.cells.filter(cell => cell.stacked).length, 1, "a creature on its own cell is not stacked");
  assert.equal(map.rows[3].cells[3].stacked, false, "the player's own cell is only shared once another creature is in it");

  // The player entering any other creature's cell gets the ring in that creature's colour, not just for friendlies.
  for ( const [disposition, kind] of [[-1, "hostile"], [0, "neutral"], [1, "friendly"]] ) {
    const entered = prepareMovementMap(makeScene({ tokens: [hero, npc("x", 450, 450, disposition)] }), actor, user);
    const center = entered.rows[3].cells[3];
    assert.equal(center.stacked, true, `${kind}: player cell is shared`);
    assert.equal(center.stackKind, kind);
    assert.ok(center.className.split(" ").includes(`stacked-${kind}`));
    assert.equal(center.tokens[0].coLocated, true);
  }
  const purple = prepareMovementMap(makeScene({ tokens: [hero, npc("p", 450, 450, 2)] }), actor, user);
  assert.equal(purple.rows[3].cells[3].stackKind, "other", "purple creature gives a purple ring");
  const bigOther = prepareMovementMap(makeScene({ tokens: [hero, npc("p", 450, 350, 2, { width: 3, height: 3 })] }), actor, user);
  assert.equal(bigOther.rows[3].cells[3].stackKind, "other", "standing inside a large purple creature counts");

  // Several badges sit side by side; the slot count is capped.
  const crowd = prepareMovementMap(makeScene({
    tokens: [hero, npc("a", 550, 350, -1), npc("b", 550, 350, 0), npc("c", 550, 350, 1),
      npc("d", 550, 350, 0, { actorId: "d2" }), npc("e", 550, 350, 0)]
  }), actor, user);
  const slots = crowd.cells.find(cell => cell.stacked).tokens.filter(token => token.coLocated).map(token => token.slot);
  assert.deepEqual(slots, [0, 1, 2, 2]);

  // Without a hostile the most threatening remaining kind colours the cell.
  const calm = prepareMovementMap(makeScene({ tokens: [hero, npc("n", 550, 350, 0), npc("f", 550, 350, 1)] }), actor, user);
  assert.equal(calm.cells.find(cell => cell.stacked).stackKind, "neutral");

  // Standing inside a large creature's footprint counts as well, in every covered cell.
  const ogre = npc("ogre", 650, 350, -1, { width: 3, height: 3 });
  const inside = prepareMovementMap(makeScene({ tokens: [hero, ogre, npc("imp", 750, 450, 0)] }), actor, user);
  const covered = inside.cells.find(cell => cell.tokens.some(token => token.id === "imp"));
  assert.equal(covered.stacked, true);
  assert.equal(covered.stackKind, "hostile");
  assert.equal(covered.tokens.find(token => token.id === "imp").coLocated, false, "the only small dot keeps its size");
  assert.equal(inside.cells.filter(cell => cell.stacked).length, 1, "cells of the footprint without other creatures stay plain");
});

test("styles shared cells of other creatures and offers a localised label", async () => {
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  for ( const kind of ["hostile", "neutral", "other", "friendly"] ) {
    assert.match(css, new RegExp(`\\.pocket5e-minimap-cell\\.stacked-${kind}\\s*\\{[^}]*--stack-color`));
  }
  assert.match(css, /\.pocket5e-minimap-cell\.stacked::after\s*\{[^}]*dashed/s);
  assert.match(css, /right:\s*calc\(5% \+ var\(--slot/);
  assert.match(template, /--slot: \{\{slot\}\}/);
  for ( const lang of ["ru", "en"] ) {
    const strings = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url), "utf8"));
    assert.ok(JSON.stringify(strings).includes('"MapStacked"'), `${lang} has MapStacked`);
  }
});

test("distinguishes closed, open and locked doors from plain walls", () => {
  // Hero stands in cell (5,5): closed door on top, open door below, plain wall on the left,
  // and a hidden door on the right that must not be drawn.
  const scene = makeScene({
    walls: [
      { c: [500, 500, 500, 600] },
      { c: [500, 500, 600, 500], door: 1, ds: 0 },
      { c: [500, 600, 600, 600], door: 1, ds: 1 },
      { c: [600, 500, 600, 600], door: 1, ds: 0, hidden: true }
    ],
    tokens: [{ id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 }]
  });
  const center = prepareMovementMap(scene, actor, user).rows[3].cells[3];
  assert.equal(center.x, 5);
  assert.deepEqual(center.doors, { top: "closed", right: null, bottom: "open", left: null });
  assert.equal(center.walls.left, true, "plain wall still reported as a wall");
  assert.equal(center.walls.top, false, "a door is not drawn as a wall");

  const locked = prepareMovementMap(makeScene({
    walls: [{ c: [600, 500, 600, 600], door: 1, ds: 2 }],
    tokens: [{ id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 }]
  }), actor, user).rows[3].cells[3];
  assert.equal(locked.doors.right, "locked");
  assert.equal(locked.walls.right, false);
});

test("hides secret doors from players but shows them to the GM; plain wall beats an open door", () => {
  const scene = makeScene({
    walls: [
      { c: [600, 500, 600, 600], door: 2, ds: 0 },
      { c: [500, 600, 600, 600], door: 1, ds: 1 },
      { c: [500, 600, 600, 600] }
    ],
    tokens: [{ id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 }]
  });
  const asPlayer = prepareMovementMap(scene, actor, user).rows[3].cells[3];
  assert.equal(asPlayer.walls.right, true, "secret door looks like a wall to players");
  assert.equal(asPlayer.doors.right, null);
  assert.equal(asPlayer.walls.bottom, true, "wall sharing an edge with an open door stays a wall");
  assert.equal(asPlayer.doors.bottom, null);

  const gm = { id: "gm", isGM: true };
  const asGM = prepareMovementMap(scene, actor, gm).rows[3].cells[3];
  assert.equal(asGM.doors.right, "closed");
});

test("renders door markers and a legend in the template and styles", async () => {
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  for ( const side of ["top", "right", "bottom", "left"] ) {
    assert.match(template, new RegExp(`doors\\.${side}.*pocket5e-minimap-door ${side} \\{\\{doors\\.${side}\\}\\}`));
  }
  assert.match(template, /pocket5e-minimap-legend/);
  assert.match(css, /\.pocket5e-minimap-door\.closed/);
  assert.match(css, /\.pocket5e-minimap-door\.open\.top/);
  assert.match(css, /\.pocket5e-minimap-door\.locked::after/);
});

test("shows a secret door opened by the GM as a purple dashed door, but keeps closed ones hidden from players", async () => {
  const hero = { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 };
  const scene = makeScene({
    walls: [
      { c: [600, 500, 600, 600], door: 2, ds: 1 },
      { c: [500, 600, 600, 600], door: 2, ds: 0 },
      { c: [500, 500, 600, 500], door: 2, ds: 2 }
    ],
    tokens: [hero]
  });
  const asPlayer = prepareMovementMap(scene, actor, user).rows[3].cells[3];
  assert.equal(asPlayer.doors.right, "secret-open", "opened secret door is revealed to players");
  assert.equal(asPlayer.walls.bottom, true, "closed secret door still looks like a wall");
  assert.equal(asPlayer.walls.top, true, "locked secret door still looks like a wall");
  assert.equal(asPlayer.doors.bottom, null);

  const asGM = prepareMovementMap(scene, actor, { id: "gm", isGM: true }).rows[3].cells[3];
  assert.equal(asGM.doors.right, "secret-open");

  const plainWallToo = prepareMovementMap(makeScene({
    walls: [{ c: [600, 500, 600, 600], door: 2, ds: 1 }, { c: [600, 500, 600, 600] }],
    tokens: [hero]
  }), actor, user).rows[3].cells[3];
  assert.equal(plainWallToo.walls.right, true, "a plain wall on the same edge still wins");

  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  assert.match(css, /\.pocket5e-minimap-door\.secret-open\.top[^}]*border-top:\s*2px dashed var\(--pocket5e-door-secret\)/s);
  assert.match(css, /--pocket5e-door-secret:\s*#b57bff/);
});

test("draws proximity/distance walls as windows, but doors and plain walls keep their look", async () => {
  const hero = { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 };
  const scene = makeScene({
    walls: [
      { c: [500, 500, 500, 600], sight: 30, light: 30, move: 20 },
      { c: [600, 500, 600, 600], sight: 40 },
      { c: [500, 500, 600, 500], sight: 20, light: 20 },
      { c: [500, 600, 600, 600], door: 1, ds: 0, sight: 30 }
    ],
    tokens: [hero]
  });
  const cell = prepareMovementMap(scene, actor, user).rows[3].cells[3];
  assert.deepEqual(cell.windows, { top: false, right: true, bottom: false, left: true });
  assert.equal(cell.walls.top, true, "normal wall stays a wall");
  assert.equal(cell.doors.bottom, "closed", "a door wins over window flags");
  assert.equal(cell.walls.left, false, "a window is not drawn as a wall");

  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  for ( const side of ["top", "right", "bottom", "left"] ) {
    assert.match(template, new RegExp(`windows\\.${side}.*pocket5e-minimap-window ${side}`));
  }
  assert.match(css, /--pocket5e-window:\s*#8fe3f0/);
});

test("captures token positions and animates the pan and token slides without touching scene data", () => {
  const hero = { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 };
  const ally = { id: "ally", actorId: "ally", x: 650, y: 450, width: 1, height: 1, disposition: 1, actor: { hasPlayerOwner: false } };
  const before = captureMinimapState(prepareMovementMap(makeScene({ tokens: [hero, ally] }), actor, user));
  const after = captureMinimapState(prepareMovementMap(makeScene({ tokens: [{ ...hero, x: 550 }, { ...ally, x: 750 }] }), actor, user));
  assert.deepEqual(before.player, { x: 5, y: 5 });
  assert.deepEqual(before.tokens.get("hero-token"), { x: 5, y: 5 });
  assert.deepEqual(after.tokens.get("ally"), { x: 8, y: 5 });

  const calls = [];
  const make = (cls, dataset = {}) => ({
    dataset, animate: (frames, options) => calls.push({ cls, frames, options }),
    getBoundingClientRect: () => ({ width: 50, height: 50 })
  });
  const cells = [make("cell"), make("cell")];
  const dots = [make("hero", { tokenId: "hero-token" }), make("ally", { tokenId: "ally" }), make("new", { tokenId: "fresh" })];
  after.tokens.set("fresh", { x: 1, y: 1 });
  const grid = {
    querySelectorAll: selector => selector.includes("-cell") ? cells : dots
  };
  animateMinimap(grid, before, after);
  const byClass = cls => calls.filter(call => call.cls === cls);

  assert.equal(byClass("cell").length, 2, "every cell pans");
  assert.equal(byClass("cell")[0].frames[0].translate, "100% 0%", "cells start one column to the right and slide in");
  assert.equal(byClass("hero")[0].frames[0].translate, "-50px 0px", "player dot is counter-animated to stay put");
  assert.equal(byClass("ally").length, 1);
  assert.equal(byClass("ally")[0].frames[0].translate, "-50px 0px", "creature moved one cell east in the world");
  assert.equal(byClass("new")[0].frames[0].opacity, 0, "new dots fade in");

  calls.length = 0;
  animateMinimap(grid, before, { ...after, sceneId: "other" });
  animateMinimap(grid, null, after);
  animateMinimap(grid, before, { ...after, player: { x: 20, y: 5 } });
  assert.equal(calls.length, 0, "no animation across scenes, without history, or for teleports");
});

test("draws large creatures as one outline over their whole footprint", async () => {
  const hero = { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1 };
  const ogre = { id: "ogre", actorId: "o", x: 650, y: 350, width: 3, height: 3, disposition: -1, actor: { hasPlayerOwner: false } };
  const map = prepareMovementMap(makeScene({ tokens: [hero, ogre] }), actor, user);
  const holders = map.cells.filter(cell => cell.tokens.length);
  assert.equal(holders.length, 1, "a large token is rendered once, not once per covered cell");
  const [holder] = holders;
  assert.deepEqual([holder.tokens[0].cols, holder.tokens[0].rows], [3, 3]);
  assert.equal(holder.tokens[0].kind, "hostile");
  // the ogre's centre cell is (8,5), so its footprint starts at (7,4)
  assert.deepEqual([holder.x, holder.y], [7, 4]);

  // Partly outside the window: anchored at the first visible cell, with the cut-off part recorded.
  const edge = prepareMovementMap(makeScene({
    tokens: [hero, { ...ogre, x: 50, y: 350 }]
  }), actor, user);
  const clipped = edge.cells.find(cell => cell.tokens.length).tokens[0];
  assert.deepEqual([clipped.dx, clipped.dy], [1, 0], "one column is cut off on the left");

  // Completely outside: not drawn at all.
  const far = prepareMovementMap(makeScene({ tokens: [hero, { ...ogre, x: 2450 }] }), actor, user);
  assert.equal(far.cells.some(cell => cell.tokens.length), false);

  // Standing inside a large friendly's footprint (not just its centre) counts as sharing its space.
  const ally = { id: "ally", actorId: "a", x: 450, y: 350, width: 3, height: 3, disposition: 1, actor: { hasPlayerOwner: false } };
  const shared = prepareMovementMap(makeScene({ tokens: [hero, ally] }), actor, user);
  assert.equal(shared.rows[3].cells[3].occupiedFriendly, true);

  // A large player token gets its own outline in addition to the centred dot.
  const big = prepareMovementMap(makeScene({ tokens: [{ ...hero, x: 400, y: 400, width: 3, height: 3 }] }), actor, user);
  const body = big.cells.flatMap(cell => cell.tokens).find(token => token.kind === "player");
  assert.deepEqual([body.cols, body.rows], [3, 3]);
  assert.equal(body.id, "hero-token");

  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  assert.match(css, /\.pocket5e-minimap-token\.large\s*\{[^}]*width:\s*calc\(var\(--cols/s);
  assert.match(template, /--cols: \{\{cols\}\}/);
});

test("keeps the movement tab free of caption and position text, and offers a minimap switch with the scenes icon", async () => {
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../scripts/shell/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  assert.equal(template.includes("MapScene"), false);
  assert.equal(template.includes("MapPosition"), false);
  assert.match(template, /fa-solid fa-map"/, "Foundry's scenes icon (fa-map)");
  assert.match(template, /role="switch"[^>]*data-action="toggleMinimap"/);
  assert.match(template, /\{\{#if minimapEnabled\}\}\s*<div class="pocket5e-minimap" data-minimap/);
  assert.match(appSource, /toggleMinimap: PocketShell\.#onToggleMinimap/);
  assert.match(appSource, /#bindMinimapTokenInfo/);
  assert.match(appSource, /#showMinimapTokenInfo/);
  assert.match(appSource, /context\.minimapEnabled = this\.moreState\.minimap !== false/);
  assert.match(css, /\.pocket5e-switch\.on/);
});

test("carries token artwork so the GM can swap coloured dots for portraits", async () => {
  const map = prepareMovementMap(makeScene({
    tokens: [
      {
        id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1,
        texture: { src: "tokens/hero.webp" }
      },
      {
        id: "foe", actorId: "ogre", x: 750, y: 350, width: 1, height: 1, disposition: -1,
        texture: { src: "tokens/ogre.webp" }, actor: { hasPlayerOwner: false }
      }
    ]
  }), actor, user);
  assert.equal(map.playerImg, "tokens/hero.webp");
  assert.equal(map.tokens.find(token => token.id === "foe").img, "tokens/ogre.webp");

  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../scripts/shell/app.js", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../scripts/settings.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  assert.match(settingsSource, /MINIMAP_TOKEN_PORTRAITS:\s*"minimapTokenPortraits"/);
  assert.match(settingsSource, /scope:\s*"world"/);
  assert.match(appSource, /SETTINGS\.MINIMAP_TOKEN_PORTRAITS/);
  assert.match(appSource, /pocket5e\.minimapChanged/);
  assert.match(template, /movementMap\.tokenPortraits/);
  assert.match(template, /movementMap\.playerImg/);
  assert.match(css, /\.pocket5e-minimap-token\.portrait\s*>\s*img/);
});

test("carries scene artwork so the GM can put the map image under the seven-cell window", async () => {
  const map = prepareMovementMap(makeScene({
    background: { src: "maps/arena.webp" },
    dimensions: { sceneX: 200, sceneY: 100, sceneWidth: 1000, sceneHeight: 800, size: 100 }
  }), actor, user);
  assert.equal(map.originX, 2);
  assert.equal(map.originY, 2);
  assert.equal(map.sceneBackdrop.src, "maps/arena.webp");
  assert.equal(map.sceneBackdrop.x, 2);
  assert.equal(map.sceneBackdrop.y, 1);
  assert.equal(map.sceneBackdrop.cols, 10);
  assert.equal(map.sceneBackdrop.rows, 8);

  const noArt = prepareMovementMap(makeScene(), actor, user);
  assert.equal(noArt.sceneBackdrop, null);

  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../scripts/shell/app.js", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../scripts/settings.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  const minimapSource = await readFile(new URL("../scripts/shell/minimap.js", import.meta.url), "utf8");
  assert.match(settingsSource, /MINIMAP_SCENE_BACKGROUND:\s*"minimapSceneBackground"/);
  assert.match(appSource, /SETTINGS\.MINIMAP_SCENE_BACKGROUND/);
  assert.match(template, /pocket5e-minimap-scene/);
  assert.match(template, /movementMap\.sceneBackground/);
  assert.match(css, /\.pocket5e-minimap-scene img/);
  assert.match(minimapSource, /pocket5e-minimap-scene/);
});

test("carries scene tiles under the seven-cell window, respecting grid scale, v14 anchor and player visibility", async () => {
  const sceneWithTiles = makeScene({
    background: { src: "maps/dungeon.webp" },
    tiles: [
      {
        id: "altar-tile",
        x: 400,
        y: 400,
        width: 200,
        height: 200,
        rotation: 45,
        alpha: 0.9,
        sort: 2,
        texture: { src: "tiles/altar.webp", anchorX: 0.5, anchorY: 0.5, scaleX: -1 }
      },
      {
        id: "corner-chest",
        x: 100,
        y: 200,
        width: 100,
        height: 100,
        texture: { src: "tiles/chest.webp", anchorX: 0, anchorY: 0 }
      },
      {
        id: "hidden-trap",
        x: 500,
        y: 500,
        width: 100,
        height: 100,
        hidden: true,
        texture: { src: "tiles/trap.webp" }
      }
    ]
  });

  // Regular player: hidden trap is excluded
  const playerMap = prepareMovementMap(sceneWithTiles, actor, user);
  assert.equal(playerMap.sceneTiles.length, 2);
  
  // Altar: centered at 400, 400 (w:200, h:200, anchor:0.5) -> top-left is 300, 300 -> grid x=3, y=3
  const altar = playerMap.sceneTiles.find(t => t.id === "altar-tile");
  assert.equal(altar.id, "altar-tile");
  assert.equal(altar.src, "tiles/altar.webp");
  assert.equal(altar.x, 3);
  assert.equal(altar.y, 3);
  assert.equal(altar.cols, 2);
  assert.equal(altar.rows, 2);
  assert.equal(altar.anchorX, 0.5);
  assert.equal(altar.anchorY, 0.5);
  assert.equal(altar.scaleX, -1);
  assert.equal(altar.scaleY, 1);
  assert.equal(altar.rotation, 45);
  assert.equal(altar.alpha, 0.9);
  assert.equal(altar.zIndex, 2);

  // Corner chest: top-left anchor (0, 0) at 100, 200 -> grid x=1, y=2
  const chest = playerMap.sceneTiles.find(t => t.id === "corner-chest");
  assert.equal(chest.x, 1);
  assert.equal(chest.y, 2);
  assert.equal(chest.anchorX, 0);
  assert.equal(chest.anchorY, 0);

  // GM: hidden trap is visible
  const gmUser = { id: "gm", isGM: true };
  const gmMap = prepareMovementMap(sceneWithTiles, actor, gmUser);
  assert.equal(gmMap.sceneTiles.length, 3);
  assert.ok(gmMap.sceneTiles.some(t => t.id === "hidden-trap"));

  // Check template and css integration
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  assert.match(template, /movementMap\.sceneTiles/);
  assert.match(template, /pocket5e-minimap-tile/);
  assert.match(css, /\.pocket5e-minimap-scene\s+\.pocket5e-minimap-tile/);
});

test("hides walls and legend when scene background is enabled, and adds facing rotation to token portraits", async () => {
  const scene = makeScene({
    tokens: [
      {
        id: "hero-token",
        actorId: "hero",
        x: 450,
        y: 450,
        rotation: 90,
        texture: { src: "tokens/hero.webp" }
      },
      {
        id: "foe",
        actorId: "ogre",
        x: 750,
        y: 350,
        rotation: 270,
        texture: { src: "tokens/ogre.webp" },
        actor: { hasPlayerOwner: false }
      }
    ]
  });

  const map = prepareMovementMap(scene, actor, user);
  assert.equal(map.playerRotation, 90);
  assert.equal(map.tokens.find(t => t.id === "foe").rotation, 270);

  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");

  // Hides walls and legend under sceneBackground condition
  assert.match(template, /\{\{#unless @root\.movementMap\.sceneBackground\}\}/);
  assert.match(template, /\{\{#unless movementMap\.sceneBackground\}\}/);

  // Direct desktop-like rotation on token image, no arrow overlay
  assert.equal(template.includes("pocket5e-token-heading"), false);
  assert.match(template, /--token-rot: \{\{rotation\}\}deg;/);
  assert.match(css, /\.pocket5e-minimap-token\.portrait\s*>\s*img\s*\{[^}]*transform:\s*rotate\(var\(--token-rot/s);
  assert.match(css, /\.pocket5e-minimap-token\.large\.portrait\s*\{[^}]*width:\s*calc\(var\(--cols/s);
});

test("movement tab removes scene name, centers pad when minimap is off, adds gap with scene, and expands token info card", async () => {
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");

  // 1. Scene name removed from movement tab
  assert.equal(template.includes("movementMap.sceneName"), false);

  // 2. No-minimap pad centering
  assert.match(template, /no-minimap/);
  assert.match(css, /\.pocket5e-movement\.no-minimap\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.pocket5e-movement\.no-minimap\s+\.pocket5e-movement-pad\s*\{[^}]*margin:\s*auto/s);

  // 3. Margin between minimap frame and pad when scene is enabled
  assert.match(css, /\.pocket5e-minimap-frame\.has-scene\s*\{[^}]*margin-bottom:\s*16px/s);

  // 4. Token info popup window enlarged
  assert.match(css, /\.pocket5e-minimap-token-info\s*\{[^}]*max-width:\s*330px/s);
  assert.match(css, /\.pocket5e-minimap-token-info-img\s*\{[^}]*width:\s*64px/s);
});

test("renders exact vector wall segments and supports token vision with darkness and line of sight", async () => {
  // 1. Exact vector walls (diagonal, doors, windows, off-grid)
  const sceneWithWalls = makeScene({
    walls: [
      { id: "diag", c: [150, 250, 450, 550] }, // arbitrary diagonal wall
      { id: "door-1", c: [600, 400, 600, 500], door: 1, ds: 0 }, // closed door
      { id: "door-2", c: [600, 500, 600, 600], door: 1, ds: 1 }, // open door
      { id: "win", c: [400, 600, 500, 600], sense: 20 } // window
    ]
  });

  const mapWalls = prepareMovementMap(sceneWithWalls, actor, user);
  assert.equal(mapWalls.wallSegments.length >= 4, true);
  const diagSegment = mapWalls.wallSegments.find(s => s.id === "diag");
  assert.equal(diagSegment.kind, "wall");
  assert.equal(diagSegment.length > 0, true);

  const doorSegment = mapWalls.wallSegments.find(s => s.id === "door-1");
  assert.equal(doorSegment.isDoor, true);
  assert.equal(doorSegment.kind, "closed");

  // 2. Token vision & darkness
  // A dark dungeon scene with tokenVision enabled
  const darkScene = makeScene({
    tokenVision: true,
    globalLight: false,
    darkness: 1.0,
    walls: [
      { id: "blocker", c: [500, 400, 500, 600] } // wall between player at 450,450 and foe at 750,350
    ],
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1, sight: { enabled: true, range: 0 } },
      { id: "foe", actorId: "ogre", x: 750, y: 350, width: 1, height: 1, disposition: -1, actor: { hasPlayerOwner: false } }
    ]
  });

  const darkMap = prepareMovementMap(darkScene, actor, user);
  assert.equal(darkMap.hasVision, true);
  assert.equal(darkMap.isGlobalLit, false);

  // Player cell is visible, but surrounding cells in pitch black are dark
  const centerCell = darkMap.rows[3].cells[3];
  assert.equal(centerCell.darkness, false);
  const distantCell = darkMap.rows[0].cells[0];
  assert.equal(distantCell.darkness, true);

  // Foe in the darkness is marked inDarkness
  const foeToken = darkMap.cells.flatMap(c => c.tokens).find(t => t.id === "foe");
  assert.equal(foeToken.inDarkness, true);

  // 3. Hero with Torch (dim: 40ft = 8 cells radius) illuminates cells
  const litScene = makeScene({
    walls: [],
    tokenVision: true,
    globalLight: false,
    darkness: 1.0,
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1, sight: { range: 0 }, light: { dim: 40, bright: 20 } },
      { id: "foe", actorId: "ogre", x: 550, y: 450, width: 1, height: 1, disposition: -1, actor: { hasPlayerOwner: false } }
    ]
  });
  const litMap = prepareMovementMap(litScene, actor, user);
  const adjacentCell = litMap.rows[3].cells[4];
  assert.equal(adjacentCell.seen, true);
  assert.equal(adjacentCell.lit, true);
  assert.equal(adjacentCell.darkness, false);

  // 4. Template & CSS checks
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  assert.match(template, /pocket5e-minimap-walls-svg/);
  assert.match(template, /pocket5e-svg-wall/);
  assert.match(template, /pocket5e-minimap-fog-svg/);
  assert.match(css, /.pocket5e-minimap-walls-svg/);
  assert.match(css, /.pocket5e-svg-wall.wall/);
  assert.match(css, /.pocket5e-minimap-fog-svg/);
  assert.match(css, /.pocket5e-minimap-cell.in-darkness/);
});

test("supports darkvision monochrome mode and animated light sources in darkness", async () => {
  // 1. Total darkness: globalLight off, no darkvision, no light
  const pitchDarkScene = makeScene({
    tokenVision: true,
    globalLight: false,
    darkness: 1.0,
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1, sight: { enabled: true, range: 0 } }
    ]
  });
  const darkMap = prepareMovementMap(pitchDarkScene, actor, user);
  assert.equal(darkMap.isDarkness, true);
  assert.equal(darkMap.hasDarkvision, false);
  assert.equal(darkMap.lightSources.length, 0);

  // 2. Darkvision in darkness: sees monochrome map
  const darkvisionScene = makeScene({
    tokenVision: true,
    globalLight: false,
    darkness: 1.0,
    walls: [],
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1, sight: { enabled: true, range: 60, visionMode: "darkvision" } }
    ]
  });
  const dvMap = prepareMovementMap(darkvisionScene, actor, user);
  assert.equal(dvMap.isDarkness, true);
  assert.equal(dvMap.hasDarkvision, true);
  assert.equal(dvMap.darkvisionRadius > 0, true);
  assert.equal(dvMap.rows[3].cells[4].isDarkvision, true);

  // 3. Torch light source with animation
  const torchScene = makeScene({
    tokenVision: true,
    globalLight: false,
    darkness: 1.0,
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1, sight: { range: 0 }, light: { dim: 40, bright: 20, animation: { type: "torch" } } }
    ]
  });
  const torchMap = prepareMovementMap(torchScene, actor, user);
  assert.equal(torchMap.lightSources.length, 1);
  assert.equal(torchMap.lightSources[0].animType, "torch");
  assert.equal(torchMap.lightSources[0].animationClass, "anim-torch");

  // 4. Template & CSS checks for lighting, B&W darkvision, and animations
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  assert.match(template, /is-lit-color/);
  assert.match(template, /pocket5e-minimap-lights-layer/);
  assert.match(template, /pocket5e-light-mask/);
  assert.match(template, /stdDeviation="0.09"/);
  assert.match(css, /pocket5e-torch-flicker/);
  assert.match(css, /grayscale\(100%\)/);
});

test("supports full-color lit areas via clip-path and prevents shadow artifacts across light sources", async () => {
  // Scene with a torch to the left and player to the right, plus an upper wall
  const scene = makeScene({
    tokenVision: true,
    globalLight: false,
    darkness: 1.0,
    walls: [
      { c: [300, 200, 300, 350] } // wall above
    ],
    lights: [
      { id: "ambient-torch", x: 250, y: 450, config: { dim: 30, bright: 15, color: "#ff9900" } }
    ],
    tokens: [
      { id: "hero-token", actorId: "hero", x: 450, y: 450, width: 1, height: 1, sight: { enabled: true, range: 60, visionMode: "darkvision" } }
    ]
  });

  const map = prepareMovementMap(scene, actor, user);
  assert.equal(map.lightSources.length, 1);
  const light = map.lightSources[0];
  assert.ok(light.clipPolygonString);
  assert.ok(light.cssClipPolygon);
  assert.ok(map.litClipPath.length > 0);

  // Verify that polygon points sweep around in valid order without negative coordinates or NaN
  const coords = light.clipPolygonString.split(" ").map(pair => pair.split(",").map(Number));
  assert.ok(coords.length >= 10);
  for ( const [x, y] of coords ) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  }

  // Verify CSS has mask support for lit color layer and token z-index above lights
  const css = await readFile(new URL("../styles/elfrey-pocket-app.css", import.meta.url), "utf8");
  assert.match(css, /\.pocket5e-minimap-scene\.is-lit-color\s*\{[^}]*mask:\s*url\(#pocket5e-light-mask\)/s);
  assert.match(css, /\.pocket5e-minimap-lights-layer\s*\{[^}]*z-index:\s*2/s);
  assert.match(css, /\.pocket5e-minimap-token\s*\{[^}]*z-index:\s*20/s);

  // Verify template has pocket5e-light-mask with blur filter and inline litMaskImage
  const template = await readFile(new URL("../templates/tabs/more.hbs", import.meta.url), "utf8");
  assert.match(template, /id="pocket5e-light-mask"/);
  assert.match(template, /id="pocket5e-light-blur"/);
  assert.match(template, /feGaussianBlur/);
  assert.match(template, /mask-image:\s*\{\{movementMap\.litMaskImage\}\}/);
});

