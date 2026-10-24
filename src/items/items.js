// Every item in the game. stack: most per inventory slot. color: the item
// lying in the world. floats: drifts on the water instead of sinking.
// eat: what eating one gives back (right-click with it selected).
// tool: what it does when selected while gathering (see world/gathering.js);
// durability: uses before it breaks.
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
  coconut: {
    name: 'Coconut', description: 'A young coconut (buko) from a palm on the beach. Right-click to drink its water and eat it: stamina and health back.',
    stack: 8, color: '#5c7a2c', floats: true, eat: { stamina: 40, health: 12 },
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
  coconut(ctx) {
    const g = ctx.createRadialGradient(26, 26, 4, 32, 36, 24);
    g.addColorStop(0, '#a9c45a');
    g.addColorStop(0.6, '#5c7a2c');
    g.addColorStop(1, '#2f4415');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(32, 36, 20, 22, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4a2a';
    ctx.beginPath();
    ctx.ellipse(36, 14, 7, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
    stroke(ctx, () => { ctx.moveTo(22, 24); ctx.quadraticCurveTo(18, 36, 24, 48); }, 2, 'rgba(255, 255, 255, 0.3)');
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
