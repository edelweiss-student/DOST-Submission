// Every item in the game. stack: most per inventory slot. color: the item
// lying in the world. floats: drifts on the water instead of sinking.
// eat: what eating one gives back (right-click with it selected).
// tool: what it does when selected while gathering (see world/gathering.js);
// durability: uses before it breaks. keep: can't be dropped or thrown out.
// throws: right-click draws it back to throw instead (see world/spears.js).
// Wood isn't an item: logs and planks are carried in your arms (world/timber.js).
export const ITEMS = {
  stick: {
    name: 'Stick', description: 'A dry branch. Handles, frames and kindling.',
    stack: 32, color: '#7a5a3a', floats: true,
  },
  stone: {
    name: 'Stone', description: 'A fist-sized stone with a good heft.',
    stack: 32, color: '#8a8780', floats: false,
  },
  fibre: {
    name: 'Plant fibre', description: 'Tough stems that twist into cordage.',
    stack: 48, color: '#9bb04a', floats: true,
  },
  berries: {
    name: 'Berries', description: 'Right-click to eat: a little stamina and health back.',
    stack: 24, color: '#8e1f3a', floats: true, eat: { stamina: 25, health: 6 },
  },
  knife: {
    name: 'Makeshift knife', description: 'A sharp stone flake wedged into a split stick. Cuts twice the fibre from bushes, and fibre from grass anywhere it grows.',
    stack: 1, color: '#8a8780', floats: false, tool: 'knife', durability: 40,
  },
  axe: {
    name: 'Stone axe', description: 'Fells trees, cuts logs off fallen trunks and splits logs into planks for building.',
    stack: 1, color: '#8a8780', floats: false, tool: 'axe', durability: 150,
  },
  pickaxe: {
    name: 'Stone pickaxe', description: 'A heavy stone head on a stick: in a multiplayer match, the fastest way through an enemy bed.',
    stack: 1, color: '#8a8780', floats: false, tool: 'pickaxe', durability: 50,
  },
  spear: {
    name: 'Spear', description: 'A long stick with a stone point lashed on with fibre. Hold right-click to draw it back (the meter shows how hard), let go to throw it, then go and pick it up (E). In a multiplayer match it hurts another team’s players from afar.',
    stack: 1, color: '#8a6440', floats: true, tool: 'spear', throws: true, durability: 30,
  },
  bed: {
    name: 'Team bed', description: 'Your team’s one bed, in a multiplayer match. Select it, aim at the ground and right-click to place it, anywhere outside the other teams’ bases (R turns it). While it stands, your team comes back at it after going down. If the flood reaches it, it’s washed away.',
    stack: 1, color: '#6e4a2c', floats: false, keep: true,
  },
  kubo: {
    name: 'Bahay kubo', description: 'Your team’s house on stilts, in a multiplayer match: bamboo, woven sawali walls and a steep nipa roof, 4 m square, with steps up to the door. Select it, aim at the ground and right-click: it goes up at once (R turns the door). Raised above the floods, it’s the safest place for your bed.',
    stack: 1, color: '#b89a62', floats: false, keep: true,
  },
};

// --- Icons, drawn once at startup (the game ships no image files).

const SIZE = 64;

function stroke(ctx, path, width, color) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.beginPath();
  path();
  ctx.stroke();
}

// A wooden handle from (x0, y0) to (x1, y1).
function handle(ctx, x0, y0, x1, y1) {
  const path = () => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); };
  stroke(ctx, path, 8, '#3b2616');
  stroke(ctx, path, 5, '#8a6440');
}

// A stone shape from a list of points, shaded from top-left to bottom-right.
function stoneShape(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  const g = ctx.createLinearGradient(14, 8, 52, 44);
  g.addColorStop(0, '#d2cfc8');
  g.addColorStop(1, '#5f5c57');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#34322f';
  ctx.stroke();
}

const DRAW = {
  stick(ctx) {
    const branch = () => { ctx.moveTo(12, 52); ctx.lineTo(52, 12); ctx.moveTo(34, 30); ctx.lineTo(44, 40); };
    stroke(ctx, branch, 9, '#3b2616');
    stroke(ctx, branch, 6, '#8a6440');
    stroke(ctx, () => { ctx.moveTo(14, 48); ctx.lineTo(50, 12); }, 2, '#b88d5f');
  },
  stone(ctx) {
    ctx.beginPath();
    [[14, 38], [20, 20], [38, 14], [52, 24], [54, 42], [40, 52], [22, 50]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    const g = ctx.createLinearGradient(16, 16, 50, 52);
    g.addColorStop(0, '#c9c6bf');
    g.addColorStop(1, '#5f5c57');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3d3b38';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(22, 22); ctx.lineTo(37, 17); ctx.lineTo(30, 28); ctx.closePath();
    ctx.fill();
  },
  fibre(ctx) {
    for (let i = 0; i < 7; i++) {
      const x = 22 + i * 3.4;
      stroke(ctx, () => { ctx.moveTo(x, 54); ctx.quadraticCurveTo(x + 8 - i * 2.5, 32, x - 4 + i * 2, 10); }, 2.4, i % 2 ? '#9fbf4a' : '#c9d36a');
    }
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(22, 34, 22, 5);
  },
  knife(ctx) {
    handle(ctx, 12, 52, 28, 36);
    stoneShape(ctx, [[25, 33], [44, 12], [54, 10], [50, 22], [31, 39]]);
    stroke(ctx, () => { ctx.moveTo(24, 34); ctx.lineTo(31, 41); }, 3, '#c9a46a');
  },
  axe(ctx) {
    handle(ctx, 16, 56, 44, 14);
    stoneShape(ctx, [[30, 14], [40, 6], [54, 12], [56, 28], [46, 30], [38, 22]]);
  },
  pickaxe(ctx) {
    handle(ctx, 18, 56, 38, 20);
    const head = () => { ctx.moveTo(10, 24); ctx.quadraticCurveTo(34, 6, 56, 22); };
    stroke(ctx, head, 10, '#34322f');
    stroke(ctx, head, 6, '#a9a59e');
    stroke(ctx, () => { ctx.moveTo(18, 17); ctx.quadraticCurveTo(34, 9, 48, 15); }, 2, '#d2cfc8');
  },
  // A long shaft from corner to corner, a stone point lashed on with fibre.
  spear(ctx) {
    handle(ctx, 6, 58, 44, 20);
    stroke(ctx, () => { ctx.moveTo(40, 25); ctx.lineTo(46, 19); }, 7, '#9bb04a');
    stoneShape(ctx, [[43, 17], [52, 6], [58, 6], [58, 12], [47, 21]]);
  },
  // A bed seen from the foot end, a little from above: wooden frame and
  // legs, a headboard, a pillow and a blanket.
  bed(ctx) {
    ctx.fillStyle = '#3b2616';
    for (const x of [12, 48]) ctx.fillRect(x, 40, 5, 14);   // legs
    ctx.fillRect(14, 12, 36, 18);                            // headboard
    ctx.fillStyle = '#8a6440';
    ctx.fillRect(16, 14, 32, 14);
    ctx.fillStyle = '#6e4a2c';
    ctx.beginPath();                                         // frame
    ctx.moveTo(8, 42); ctx.lineTo(56, 42); ctx.lineTo(52, 30); ctx.lineTo(12, 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e9e3d2';
    ctx.beginPath();                                         // pillow
    ctx.ellipse(32, 30, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8483f';
    ctx.beginPath();                                         // blanket
    ctx.moveTo(9, 40); ctx.lineTo(55, 40); ctx.lineTo(52, 33); ctx.lineTo(12, 33);
    ctx.closePath();
    ctx.fill();
    stroke(ctx, () => { ctx.moveTo(8, 42); ctx.lineTo(56, 42); }, 3, '#3b2616');
  },
  // A bahay kubo: a steep thatched roof over woven walls, on bamboo stilts,
  // with steps up to the door.
  kubo(ctx) {
    ctx.fillStyle = '#c9b16a';
    for (const x of [16, 30, 44]) ctx.fillRect(x, 40, 4, 18);       // stilts
    ctx.fillStyle = '#b8955c';
    ctx.fillRect(12, 26, 40, 15);                                   // walls
    ctx.strokeStyle = 'rgba(80, 56, 24, 0.6)';
    ctx.lineWidth = 1;
    for (let x = 14; x < 52; x += 4) {
      ctx.beginPath();
      ctx.moveTo(x, 26);
      ctx.lineTo(x + 2, 41);
      ctx.stroke();
    }
    ctx.fillStyle = '#3b2616';
    ctx.fillRect(36, 28, 9, 13);                                    // door
    ctx.fillStyle = '#7a6236';
    ctx.beginPath();                                                // roof
    ctx.moveTo(4, 30);
    ctx.lineTo(32, 6);
    ctx.lineTo(60, 30);
    ctx.closePath();
    ctx.fill();
    stroke(ctx, () => { ctx.moveTo(10, 26); ctx.lineTo(32, 8); ctx.lineTo(54, 26); }, 2, '#a68a52');
    stroke(ctx, () => { ctx.moveTo(40, 42); ctx.lineTo(50, 58); }, 3, '#c9b16a');   // steps
  },
  berries(ctx) {
    ctx.fillStyle = '#4f8a32';
    ctx.beginPath();
    ctx.ellipse(40, 16, 12, 6, -0.5, 0, Math.PI * 2);
    ctx.fill();
    for (const [x, y, r] of [[24, 36, 10], [40, 40, 10], [31, 50, 9], [34, 26, 8]]) {
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
      g.addColorStop(0, '#f2647f');
      g.addColorStop(0.5, '#a3203f');
      g.addColorStop(1, '#4d0c1d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

const icons = {};
export function itemIcon(id) {
  if (!icons[id]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = ctx.lineJoin = 'round';
    DRAW[id](ctx);
    icons[id] = canvas.toDataURL();
  }
  return icons[id];
}
