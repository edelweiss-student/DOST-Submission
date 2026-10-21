import { ITEMS, itemIcon } from '../items/items.js';
import { HOTBAR } from '../items/inventory.js';

const $ = (id) => document.getElementById(id);

function makeSlot(index, key) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.dataset.index = index;
  el.innerHTML = '<img alt="" draggable="false" hidden><span class="count"></span>';
  if (key) el.insertAdjacentHTML('beforeend', `<span class="key">${key}</span>`);
  return el;
}

function fill(el, stack) {
  const img = el.querySelector('img');
  if (img.dataset.item !== (stack?.id ?? '')) {
    img.dataset.item = stack?.id ?? '';
    if (stack) img.src = itemIcon(stack.id);
    img.hidden = !stack;
  }
  el.querySelector('.count').textContent = stack && stack.count > 1 ? stack.count : '';
}

// The hotbar along the bottom of the screen, and the inventory screen (I or
// Tab) where stacks are moved around with the mouse. onDrop(stack) throws a
// stack into the world.
export class InventoryUI {
  constructor(inventory, { onDrop }) {
    this.inv = inventory;
    this.onDrop = onDrop;
    this.open = false;
    this.held = null;      // stack on the mouse cursor
    this.hover = -1;       // slot under the mouse
    this.nameTimer = 0;
    this.shownName = null;
    this.el = {
      hotbar: $('hotbar'), name: $('hotbar-name'), prompt: $('prompt'), feed: $('feed'),
      screen: $('inventory'), bag: $('inv-backpack'), bagHotbar: $('inv-hotbar'),
      cursor: $('inv-cursor'), tooltip: $('inv-tooltip'), crosshair: $('crosshair'),
    };

    this.hotbarSlots = [];
    this.screenSlots = [];
    for (let i = 0; i < HOTBAR; i++) {
      this.hotbarSlots.push(this.el.hotbar.appendChild(makeSlot(i, i + 1)));
      this.screenSlots[i] = this.el.bagHotbar.appendChild(makeSlot(i, i + 1));
    }
    for (let i = HOTBAR; i < inventory.slots.length; i++) this.screenSlots[i] = this.el.bag.appendChild(makeSlot(i));
    this.el.cursor.appendChild(makeSlot(-1));

    const screen = this.el.screen;
    screen.addEventListener('contextmenu', (e) => e.preventDefault());
    screen.addEventListener('pointerdown', (e) => {
      e.preventDefault();   // no text selection or focus changes
      const slot = e.target.closest('.slot[data-index]');
      if (slot && slot.dataset.index >= 0) {
        const i = Number(slot.dataset.index);
        if (e.shiftKey && !this.held) inventory.quickMove(i);
        else this.held = inventory.click(i, this.held, e.button === 2);
      } else if (!e.target.closest('.inv-panel') && this.held) {
        // Clicked outside the panel: throw the held stack out.
        this.onDrop(this.held);
        this.held = null;
      }
      this.renderCursor();
      this.renderTooltip(e);
    });
    screen.addEventListener('pointermove', (e) => {
      const slot = e.target.closest('.slot[data-index]');
      this.hover = slot ? Number(slot.dataset.index) : -1;
      this.el.cursor.style.left = `${e.clientX}px`;
      this.el.cursor.style.top = `${e.clientY}px`;
      this.renderTooltip(e);
    });

    inventory.onChange(() => this.render());
    this.render();
  }

  render() {
    const { slots, selected } = this.inv;
    this.hotbarSlots.forEach((el, i) => {
      fill(el, slots[i]);
      el.classList.toggle('selected', i === selected);
    });
    this.screenSlots.forEach((el, i) => fill(el, slots[i]));
    // Name of the selected item, shown for a moment when it changes.
    const id = this.inv.current?.id ?? null;
    if (id !== this.shownName) {
      this.shownName = id;
      this.el.name.textContent = id ? ITEMS[id].name : '';
      this.el.name.classList.toggle('show', !!id);
      this.nameTimer = 1.6;
    }
  }

  renderCursor() {
    fill(this.el.cursor.firstChild, this.held);
    this.el.cursor.hidden = !this.held;
  }

  renderTooltip(e) {
    const stack = this.hover >= 0 && !this.held ? this.inv.slots[this.hover] : null;
    const tip = this.el.tooltip;
    tip.hidden = !stack;
    if (!stack) return;
    tip.innerHTML = '';
    const title = tip.appendChild(document.createElement('b'));
    title.textContent = ITEMS[stack.id].name;
    tip.append(ITEMS[stack.id].description);
    tip.style.left = `${e.clientX + 16}px`;
    tip.style.top = `${e.clientY + 16}px`;
  }

  show() {
    this.open = true;
    this.el.screen.classList.remove('hidden');
    this.el.crosshair.hidden = true;
    this.setPrompt(null);
    this.renderCursor();
  }

  // Anything still on the cursor goes back in the bag (or is dropped if full).
  hide() {
    this.open = false;
    this.el.screen.classList.add('hidden');
    this.el.crosshair.hidden = false;
    this.el.tooltip.hidden = true;
    this.hover = -1;
    if (this.held) {
      const left = this.inv.add(this.held.id, this.held.count);
      if (left) this.onDrop({ id: this.held.id, count: left });
      this.held = null;
    }
  }

  // "+2 Stick" in the corner when you pick something up.
  notify(text) {
    const line = this.el.feed.appendChild(document.createElement('div'));
    line.textContent = text;
    setTimeout(() => line.remove(), 2600);
  }

  // The action under the crosshair, e.g. "E Gather sticks"; dim when there's nothing left.
  setPrompt(text, dim = false) {
    const p = this.el.prompt;
    const key = text ? `E\u0000${text}\u0000${dim}` : '';
    if (p.dataset.key === key) return;
    p.dataset.key = key;
    p.classList.toggle('show', !!text);
    p.classList.toggle('dim', dim);
    p.innerHTML = '';
    if (!text) return;
    p.appendChild(document.createElement('kbd')).textContent = 'E';
    p.append(text);
  }

  update(dt) {
    if (this.nameTimer > 0 && (this.nameTimer -= dt) <= 0) this.el.name.classList.remove('show');
  }
}
