// Playing on your own: a score, and a leaderboard of your best runs kept in
// this browser (the Leaderboard page of the menu).
//
// A run lasts from when you start until you black out, or quit to the
// menu. Each new day scores PER_PIECE points for every finished piece you've
// built that's still standing and dry, times how balanced the climate is
// (FACTOR, by its tier: see climate/entity.js). So the points are in
// building, but building takes wood, and felling trees for it pushes the
// climate the wrong way; and what's built wears down unless it's looked
// after.

const KEY = 'washed-away.scores';
const KEEP = 10;   // runs on the leaderboard
export const PER_PIECE = 10;
export const FACTOR = [1, 0.6, 0.3, 0.1];   // Balanced, Unstable, Severe, Crisis

function load() {
  try {
    const runs = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(runs) ? runs.filter((r) => Number.isFinite(r?.score)) : [];
  } catch {
    return [];   // storage blocked, or something unreadable in it
  }
}

export class Scoreboard {
  // list: the leaderboard's <ol> on the menu page.
  constructor(list) {
    this.list = list;
    this.runs = load();
    this.reset();
    this.render();
  }

  reset() {
    this.score = 0;
    this.days = 0;
    this.day = null;   // the day count when the run's last day began
  }

  get best() { return Math.max(this.score, this.runs[0]?.score ?? 0); }

  // What the next day would score now.
  next(standing, tier) { return Math.round(standing * PER_PIECE * (FACTOR[tier] ?? 0)); }

  // Every frame while you play: day (the sky's day count), standing
  // (finished pieces up and dry), tier (the climate's). Returns the points
  // a new day just brought (0 the rest of the time).
  update(day, standing, tier) {
    if (this.day === null || day < this.day) this.day = day;
    if (day === this.day) return 0;
    this.days += day - this.day;
    this.day = day;
    const gain = this.next(standing, tier);
    this.score += gain;
    return gain;
  }

  // The run is over: onto the leaderboard if it lasted a day or scored.
  // Returns { score, days, rank (its place, or null if it didn't make the
  // top KEEP) }, or null for a run too short to count; a new run starts.
  end() {
    const run = { score: this.score, days: this.days, date: new Date().toLocaleDateString('en-CA') };   // YYYY-MM-DD, here
    this.reset();
    if (run.score <= 0 && run.days === 0) return null;
    this.runs.push(run);
    this.runs.sort((a, b) => b.score - a.score || b.days - a.days);
    this.runs.length = Math.min(this.runs.length, KEEP);
    try { localStorage.setItem(KEY, JSON.stringify(this.runs)); } catch { /* storage blocked */ }
    this.render();
    const at = this.runs.indexOf(run);
    return { ...run, rank: at >= 0 ? at + 1 : null };
  }

  render() {
    if (!this.list) return;
    this.list.innerHTML = '';
    if (!this.runs.length) {
      this.list.insertAdjacentHTML('beforeend', '<li class="empty">No runs yet: play on your own and build to score.</li>');
      return;
    }
    for (const run of this.runs) {
      const li = this.list.appendChild(document.createElement('li'));
      li.innerHTML = `<b>${run.score}</b><span>${run.days} day${run.days === 1 ? '' : 's'} · ${run.date}</span>`;
    }
  }
}
