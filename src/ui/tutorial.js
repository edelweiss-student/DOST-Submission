// Tips for a first game, one at a time in a small panel at the bottom
// left, each done when you do what it says. H hides them for good (until
// the browser's storage is cleared). SOLO is for the island on your own,
// MATCH for a multiplayer match.

const KEY = 'washed-away.tips';

// Each step: what to do, and done(s): whether it's done, where s has
// walked (m), shown (s on this step), has(id, n), the events so far (ate,
// felled, built, struck) and open (a match's barriers are down).
export const SOLO = [
  { text: 'Walk with WASD and look around with the mouse.', done: (s) => s.walked > 8 },
  { text: 'Pick up 2 sticks and 2 stones with E. Sticks lie near the trees, stones on the beaches.', done: (s) => s.has('stick', 2) && s.has('stone', 2) },
  { text: 'Gather berries from a bush with E, then eat them: select them and right-click.', done: (s) => s.ate },
  { text: 'Open the inventory with I and craft a stone axe.', done: (s) => s.has('axe') },
  { text: 'Select the axe (1–9) and press E at a tree to fell it. The prompt counts the blows.', done: (s) => s.felled },
  { text: 'Press B to build. Place a floor with E, then split logs into planks with the axe and carry them to it.', done: (s) => s.built },
  { text: 'Every tree you fell raises the climate’s pressure (top right) and brings the sea closer. Build high, and look after the island.', done: (s) => s.shown > 14 },
];

export const MATCH = [
  { text: 'Your team’s bahay kubo is in your hotbar. Select it, aim at the ground and right-click: the house on stilts goes up at once (R turns the door).', done: (s) => !s.has('kubo') || s.open },
  { text: 'Now your bed: select it and right-click to place it, inside your bahay kubo or anywhere outside the other bases. You come back beside it after going down, and if the flood reaches it, it’s gone.', done: (s) => !s.has('bed') || s.open },
  { text: 'Pick up sticks and stones with E. Sticks lie near the trees, stones on the beaches.', done: (s) => s.has('stick', 2) && s.has('stone', 3) },
  { text: 'Open the inventory with I and craft a stone pickaxe: it breaks beds fastest.', done: (s) => s.has('pickaxe') },
  { text: 'Wall your bed in with B before the barriers come down.', done: (s) => s.built || s.open },
  { text: 'Once the barriers are down, left-click or F strikes. Break the other beds, and keep yours above the flood: any bed the water reaches is washed away.', done: (s) => s.struck || s.shown > 16 },
];

export class Tutorial {
  constructor(steps) {
    this.steps = steps;
    this.step = 0;
    this.shown = 0;
    this.walked = 0;
    this.events = new Set();
    this.from = null;
    this.started = false;
    this.off = false;
    try { this.off = localStorage.getItem(KEY) === 'off'; } catch { /* storage blocked */ }
    this.el = document.getElementById('tutorial');
  }

  // Something happened that a step may be waiting for.
  event(name) { this.events.add(name); }

  // The first time you play: the tips appear.
  begin() {
    this.started = true;
    this.render();
  }

  hide() {
    this.off = true;
    try { localStorage.setItem(KEY, 'off'); } catch { /* storage blocked */ }
    this.render();
  }

  // Every frame while playing. open: a match's barriers are down.
  update(dt, { player, inventory, open = false }) {
    if (!this.started || this.off || this.step >= this.steps.length) return;
    this.shown += dt;
    const p = player.pos;
    if (this.from) this.walked += Math.hypot(p.x - this.from.x, p.z - this.from.z);
    this.from = { x: p.x, z: p.z };
    const s = {
      walked: this.walked, shown: this.shown, open,
      has: (id, n = 1) => inventory.count(id) >= n,
      ate: this.events.has('ate'), felled: this.events.has('felled'), built: this.events.has('built'), struck: this.events.has('struck'),
    };
    if (!this.steps[this.step].done(s)) return;
    this.step++;
    this.shown = 0;
    if (this.step >= this.steps.length) this.hide();
    else this.render();
  }

  render() {
    const on = this.started && !this.off && this.step < this.steps.length;
    this.el.hidden = !on;
    if (!on) return;
    this.el.querySelector('b').textContent = `Tip ${this.step + 1} of ${this.steps.length}`;
    this.el.querySelector('span').textContent = this.steps[this.step].text;
  }
}
