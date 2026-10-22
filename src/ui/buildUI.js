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
};

function pieceIcon(id) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = ctx.lineJoin = 'round';
  DRAW[id](ctx);
  return canvas.toDataURL();
}

// The build bar (B): what can be built and its cost in planks, in place
// of the hotbar while you're building.
export class BuildUI {
  constructor(pieces) {
    this.pieces = pieces;
    this.el = { bar: $('build-bar'), list: $('build-pieces'), name: $('build-name'), hotbar: $('hotbar') };
    this.slots = pieces.map((piece, i) => {
      const slot = this.el.list.appendChild(document.createElement('div'));
      slot.className = 'slot';
      const img = slot.appendChild(document.createElement('img'));
      img.src = pieceIcon(piece.id);
      img.alt = piece.name;
      slot.insertAdjacentHTML('beforeend', `<span class="key">${i + 1}</span><span class="count">${piece.cost}</span>`);
      return slot;
    });
    this.open = false;
  }

  show(open) {
    this.open = open;
    this.el.bar.hidden = !open;
    this.el.hotbar.hidden = open;
  }

  select(index) {
    const piece = this.pieces[index];
    this.slots.forEach((slot, i) => slot.classList.toggle('selected', i === index));
    this.el.name.innerHTML = '';
    this.el.name.appendChild(document.createElement('b')).textContent = piece.name;
    this.el.name.append(` · ${piece.cost} planks · ${piece.hint}`);
  }
}
