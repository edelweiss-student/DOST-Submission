const $ = (id) => document.getElementById(id);

// --- Icons for what can be built, drawn once (the game ships no image files).

const PLANK = '#b5865a', LINE = '#5c3a1a', DARK = '#3a2412';

function boards(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = PLANK;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = DARK;
  ctx.stroke();
}
function lines(ctx, segments, width = 1.5) {
  ctx.lineWidth = width;
  ctx.strokeStyle = LINE;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of segments) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
}

const DRAW = {
  floor(ctx) {
    // A deck seen from above at an angle, on two posts.
    lines(ctx, [[14, 40, 14, 54], [50, 40, 50, 54]], 5);
    boards(ctx, [[6, 30], [34, 18], [58, 30], [30, 44]]);
    lines(ctx, [[13, 27, 37, 41], [20, 24, 44, 38], [27, 21, 51, 35]]);
  },
  wall(ctx) {
    boards(ctx, [[10, 12], [54, 12], [54, 54], [10, 54]]);
    lines(ctx, [[10, 22.5, 54, 22.5], [10, 33, 54, 33], [10, 43.5, 54, 43.5]]);
    lines(ctx, [[12, 12, 12, 54], [52, 12, 52, 54]], 4);
  },
  doorway(ctx) {
    boards(ctx, [[10, 12], [54, 12], [54, 54], [10, 54]]);
    lines(ctx, [[10, 22.5, 54, 22.5], [10, 33, 23, 33], [41, 33, 54, 33], [10, 43.5, 23, 43.5], [41, 43.5, 54, 43.5]]);
    ctx.fillStyle = '#16100a';
    ctx.fillRect(23, 22.5, 18, 31.5);
  },
  roof(ctx) {
    // A gable end: the triangle boarded up under two sloping roofs.
    boards(ctx, [[32, 16], [52, 40], [12, 40]]);
    lines(ctx, [[22, 28, 22, 40], [32, 18, 32, 40], [42, 28, 42, 40]]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#7d5532';
    ctx.beginPath();
    ctx.moveTo(4, 44);
    ctx.lineTo(32, 10);
    ctx.lineTo(60, 44);
    ctx.stroke();
  },
  pilings(ctx) {
    // Log stilts standing in the water, braced, a deck on top.
    ctx.fillStyle = '#2f6f8c';
    ctx.fillRect(4, 42, 56, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(4, 42, 56, 2);
    // The brace: a log from low on one stilt to high on the other.
    for (const [width, color] of [[7, DARK], [4, '#6b4a2a']]) {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(14, 38);
      ctx.lineTo(50, 20);
      ctx.stroke();
    }
    for (const x of [14, 50]) {
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(x - 5, 16, 10, 44);
      ctx.strokeStyle = DARK;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 5, 16, 10, 44);
    }
    boards(ctx, [[4, 10], [60, 10], [60, 17], [4, 17]]);
  },
  window(ctx) {
    boards(ctx, [[10, 12], [54, 12], [54, 54], [10, 54]]);
    lines(ctx, [[10, 22.5, 54, 22.5], [10, 43.5, 54, 43.5]]);
    ctx.fillStyle = '#9cc8dc';
    ctx.fillRect(22, 23, 20, 18);
    lines(ctx, [[20, 41, 44, 41]], 3);
    lines(ctx, [[32, 23, 32, 41], [22, 32, 42, 32]], 1.5);
  },
  railing(ctx) {
    lines(ctx, [[10, 22, 10, 54], [32, 22, 32, 54], [54, 22, 54, 54]], 5);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#8a6440';
    ctx.beginPath();
    ctx.moveTo(6, 22);
    ctx.lineTo(58, 22);
    ctx.moveTo(8, 38);
    ctx.lineTo(56, 38);
    ctx.stroke();
    ctx.fillStyle = '#5d4a33';
    ctx.fillRect(4, 54, 56, 5);
  },
  stairs(ctx) {
    // Steps from the ground up to a deck, seen from the side.
    lines(ctx, [[8, 58, 46, 14]], 5);
    for (let k = 0; k < 5; k++) boards(ctx, [[12 + k * 8, 50 - k * 9], [24 + k * 8, 50 - k * 9], [24 + k * 8, 54 - k * 9], [12 + k * 8, 54 - k * 9]]);
    boards(ctx, [[44, 10], [60, 10], [60, 15], [44, 15]]);
  },
};

function pieceIcon(id) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = ctx.lineJoin = 'round';
  DRAW[id](ctx);
  return canvas.toDataURL();
}

// The build bar (B): what can be built and what it costs (planks, or logs
// in brown), in place of the hotbar while you're building, with a line
// about anything you've built that needs repairs.
export class BuildUI {
  constructor(pieces) {
    this.pieces = pieces;
    this.el = { bar: $('build-bar'), list: $('build-pieces'), name: $('build-name'), status: $('build-status'), hotbar: $('hotbar') };
    this.slots = pieces.map((piece, i) => {
      const slot = this.el.list.appendChild(document.createElement('div'));
      slot.className = 'slot';
      const img = slot.appendChild(document.createElement('img'));
      img.src = pieceIcon(piece.id);
      img.alt = piece.name;
      slot.insertAdjacentHTML('beforeend', `<span class="key">${i + 1}</span><span class="count${piece.material === 'log' ? ' logs' : ''}">${piece.cost}</span>`);
      return slot;
    });
    this.open = false;
    this.shown = '';
  }

  show(open) {
    this.open = open;
    this.el.bar.hidden = !open;
    this.el.hotbar.hidden = open;
  }

  // The chosen piece, what it costs, and a hint (or details) about it.
  select(index, detail) {
    const piece = this.pieces[index];
    const text = `${piece.name}\u0000${detail ?? piece.hint}`;
    if (text === this.shown) return;
    this.shown = text;
    this.slots.forEach((slot, i) => slot.classList.toggle('selected', i === index));
    this.el.name.innerHTML = '';
    this.el.name.appendChild(document.createElement('b')).textContent = piece.name;
    this.el.name.append(` · ${piece.cost} ${piece.material ?? 'plank'}s · ${detail ?? piece.hint}`);
  }

  // e.g. "2 pieces need repairs (the worst is at 31%)"; empty to hide.
  status(text) {
    if (this.el.status.textContent !== text) this.el.status.textContent = text;
  }
}
