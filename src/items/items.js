// Every item in the game. stack: most per inventory slot. color: the item
// lying in the world. floats: drifts on the water instead of sinking.
// eat: what eating one gives back (right-click with it selected).
export const ITEMS = {
  stick: {
    name: 'Stick', description: 'A dry branch. Handles, frames and kindling.',
    stack: 32, color: '#7a5a3a', floats: true,
  },
  stone: {
    name: 'Stone', description: 'A fist-sized stone with a good heft.',
    stack: 32, color: '#8a8780', floats: false,
  },
  wood: {
    name: 'Wood', description: 'A chunk broken off a fallen trunk.',
    stack: 16, color: '#8c6239', floats: true,
  },
  fibre: {
    name: 'Plant fibre', description: 'Tough stems that twist into cordage.',
    stack: 48, color: '#9bb04a', floats: true,
  },
  berries: {
    name: 'Berries', description: 'Right-click to eat: a little stamina and health back.',
    stack: 24, color: '#8e1f3a', floats: true, eat: { stamina: 25, health: 6 },
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
  wood(ctx) {
    ctx.fillStyle = '#5e3d22';
    ctx.fillRect(14, 22, 30, 24);
    ctx.fillStyle = '#7b5532';
    ctx.fillRect(14, 22, 30, 7);
    ctx.beginPath();
    ctx.ellipse(44, 34, 9, 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d9b27c';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#a07445';
    for (const r of [3, 6, 9]) {
      ctx.beginPath();
      ctx.ellipse(44, 34, r * 0.75, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(14, 34, 3, 12, 0, Math.PI / 2, Math.PI * 1.5);
    ctx.fillStyle = '#4a2f19';
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
