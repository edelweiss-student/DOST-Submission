import { ITEMS } from './items.js';

export const HOTBAR = 9;
export const BACKPACK = 27;

// The player's items. A stack is { id, count }; empty slots are null.
// Slots 0-8 are the hotbar (keys 1-9), 9-35 the backpack.
export class Inventory {
  constructor() {
    this.slots = new Array(HOTBAR + BACKPACK).fill(null);
    this.selected = 0;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  changed() { for (const fn of this.listeners) fn(this); }

  // The stack in the selected hotbar slot.
  get current() { return this.slots[this.selected]; }

  select(index) {
    const i = ((index % HOTBAR) + HOTBAR) % HOTBAR;
    if (i === this.selected) return;
    this.selected = i;
    this.changed();
  }

  count(id) {
    return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  }

  // Puts items in: tops up stacks already there, then fills empty slots,
  // hotbar first. Returns how many didn't fit.
  add(id, count = 1) {
    const max = ITEMS[id].stack;
    for (const s of this.slots) {
      if (count === 0) break;
      if (s?.id === id && s.count < max) {
        const n = Math.min(count, max - s.count);
        s.count += n;
        count -= n;
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(count, max);
      this.slots[i] = { id, count: n };
      count -= n;
    }
    this.changed();
    return count;
  }

  // Takes up to count from a slot. Returns the stack taken, or null.
  take(index, count = 1) {
    const s = this.slots[index];
    if (!s) return null;
    const n = Math.min(count, s.count);
    s.count -= n;
    if (s.count === 0) this.slots[index] = null;
    this.changed();
    return { id: s.id, count: n };
  }

  // A click on the inventory screen, with `held` on the cursor (or null).
  // Left: pick a stack up, put it down, top up a matching stack, or swap.
  // Right: pick up half, or put down one. Returns what is held afterwards.
  click(index, held, right = false) {
    const slot = this.slots[index];
    let next = held;
    if (!held) {
      if (slot) {
        const n = right ? Math.ceil(slot.count / 2) : slot.count;
        next = { id: slot.id, count: n };
        slot.count -= n;
        if (slot.count === 0) this.slots[index] = null;
      }
    } else if (!slot) {
      const n = right ? 1 : held.count;
      this.slots[index] = { id: held.id, count: n };
      next = held.count > n ? { id: held.id, count: held.count - n } : null;
    } else if (slot.id === held.id) {
      const n = Math.min(ITEMS[slot.id].stack - slot.count, right ? 1 : held.count);
      slot.count += n;
      next = held.count > n ? { id: held.id, count: held.count - n } : null;
    } else if (!right) {
      this.slots[index] = held;
      next = slot;
    }
    this.changed();
    return next;
  }

  // Shift-click: sends a stack between the hotbar and the backpack.
  quickMove(index) {
    const s = this.slots[index];
    if (!s) return;
    const [from, to] = index < HOTBAR ? [HOTBAR, this.slots.length] : [0, HOTBAR];
    const max = ITEMS[s.id].stack;
    for (let i = from; i < to && s.count > 0; i++) {
      const t = this.slots[i];
      if (t?.id !== s.id || t.count >= max) continue;
      const n = Math.min(s.count, max - t.count);
      t.count += n;
      s.count -= n;
    }
    for (let i = from; i < to && s.count > 0; i++) {
      if (this.slots[i]) continue;
      this.slots[i] = { id: s.id, count: s.count };
      s.count = 0;
    }
    if (s.count === 0) this.slots[index] = null;
    this.changed();
  }

  // Number key over a slot on the inventory screen: swap it with that hotbar slot.
  swap(a, b) {
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    this.changed();
  }
}
