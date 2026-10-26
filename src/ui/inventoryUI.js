import { ITEMS, itemIcon } from '../items/items.js';
import { HOTBAR } from '../items/inventory.js';
import { RECIPES, canCraft } from '../items/recipes.js';

const $ = (id) => document.getElementById(id);

function makeSlot(index, key) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.dataset.index = index;
  el.innerHTML = '<img alt="" draggable="false" hidden><span class="count"></span><span class="wear" hidden><i></i></span>';
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
  // A worn tool shows how much use it has left, green to red.
  const max = stack && ITEMS[stack.id].durability;
  const wear = el.querySelector('.wear');
  wear.hidden = !max || stack.durability >= max;
  if (!wear.hidden) {
    const f = stack.durability / max;
    wear.firstChild.style.width = `${f * 100}%`;
    wear.firstChild.style.background = `hsl(${Math.round(f * 110)}, 75%, 50%)`;
  }
}

function makeRecipe(recipe, index) {
  const el = document.createElement('div');
  el.className = 'recipe';
  el.dataset.recipe = index;
  const icon = el.appendChild(makeSlot(-1));
  fill(icon, { id: recipe.makes, count: 1 });
  const info = el.appendChild(document.createElement('div'));
  info.className = 'recipe-info';
  info.appendChild(document.createElement('b')).textContent = ITEMS[recipe.makes].name;
  const needs = info.appendChild(document.createElement('div'));
  needs.className = 'needs';
  for (const id of Object.keys(recipe.needs)) {
    const need = needs.appendChild(document.createElement('span'));
    need.className = 'need';
    need.dataset.id = id;
    need.title = ITEMS[id].name;
    const img = need.appendChild(document.createElement('img'));
    img.src = itemIcon(id);
    img.alt = ITEMS[id].name;
    need.appendChild(document.createElement('span'));
  }
  const button = el.appendChild(document.createElement('button'));
  button.type = 'button';
  button.textContent = 'Craft';
  return el;
}

// The hotbar along the bottom of the screen, and the inventory screen (I or
// Tab) where stacks are moved around with the mouse and tools are crafted.
// onDrop(stack) throws a stack into the world; onCraft(recipe) makes one.
export class InventoryUI {
  constructor(inventory, { onDrop, onCraft }) {
    this.inv = inventory;
    this.onDrop = onDrop;
    this.onCraft = onCraft;
    this.hoverRecipe = -1;
    this.open = false;
    this.held = null;      // stack on the mouse cursor
    this.hover = -1;       // slot under the mouse
    this.nameTimer = 0;
    this.shownName = null;
    this.carrying = null;
    this.el = {
      hotbar: $('hotbar'), name: $('hotbar-name'), prompt: $('prompt'), feed: $('feed'),
      screen: $('inventory'), bag: $('inv-backpack'), bagHotbar: $('inv-hotbar'),
      cursor: $('inv-cursor'), tooltip: $('inv-tooltip'), crosshair: $('crosshair'), crafting: $('inv-crafting'),
    };
    this.recipeRows = RECIPES.map((recipe, i) => this.el.crafting.appendChild(makeRecipe(recipe, i)));

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
      const craftButton = e.target.closest('.recipe button');
      if (craftButton) {
        if (!craftButton.disabled) this.onCraft(RECIPES[craftButton.parentElement.dataset.recipe]);
        return;
      }
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
      const recipe = e.target.closest('.recipe');
      this.hoverRecipe = recipe ? Number(recipe.dataset.recipe) : -1;
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
    // Recipes: what you have of each ingredient, and whether it's enough.
    RECIPES.forEach((recipe, i) => {
      const row = this.recipeRows[i];
      for (const need of row.querySelectorAll('.need')) {
        const have = this.inv.count(need.dataset.id), n = recipe.needs[need.dataset.id];
        need.lastChild.textContent = `${have}/${n}`;
        need.classList.toggle('short', have < n);
      }
      row.querySelector('button').disabled = !canCraft(this.inv, recipe);
    });
    // Name of the selected item, shown for a moment when it changes (unless
    // you're carrying wood, which shows there instead).
    const id = this.inv.current?.id ?? null;
    if (id !== this.shownName) {
      this.shownName = id;
      if (this.carrying) return;
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
    const id = stack?.id ?? (this.hoverRecipe >= 0 && !this.held ? RECIPES[this.hoverRecipe].makes : null);
    const tip = this.el.tooltip;
    tip.hidden = !id;
    if (!id) return;
    tip.innerHTML = '';
    const title = tip.appendChild(document.createElement('b'));
    title.textContent = ITEMS[id].name;
    tip.append(ITEMS[id].description);
    if (stack?.durability) {
      const uses = tip.appendChild(document.createElement('span'));
      uses.className = 'uses';
      uses.textContent = `${stack.durability} of ${ITEMS[id].durability} uses left`;
    }
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
    this.hoverRecipe = -1;
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

  // The actions under the crosshair, as [key, text] pairs, e.g.
  // [['E', 'Gather sticks']], plus [null, text] lines that only inform
  // (text can be { meter (0..1), label } for a bar, e.g. a piece's
  // stability); dim when there's nothing to be done.
  setPrompt(actions, dim = false) {
    const p = this.el.prompt;
    const key = actions ? JSON.stringify([actions, dim]) : '';
    if (p.dataset.key === key) return;
    p.dataset.key = key;
    p.classList.toggle('show', !!actions);
    p.classList.toggle('dim', dim);
    p.innerHTML = '';
    for (const [k, text] of actions ?? []) {
      const line = p.appendChild(document.createElement('div'));
      if (k) line.appendChild(document.createElement('kbd')).textContent = k;
      else line.className = 'info';
      if (text?.meter === undefined) {
        line.append(text);
        continue;
      }
      line.classList.add('meter');
      line.style.setProperty('--fill', `${Math.round(text.meter * 100)}%`);
      line.style.setProperty('--hue', String(Math.round(text.meter * 120)));   // red to green
      line.append(document.createElement('i'), text.label);
    }
  }

  // What you're carrying in your arms, in place of the selected item's
  // name (e.g. "Carrying 2 logs"); null when your arms are empty.
  setCarrying(text) {
    if (this.carrying === text) return;
    this.carrying = text;
    this.el.name.textContent = text ?? (this.shownName ? ITEMS[this.shownName].name : '');
    this.el.name.classList.toggle('show', !!text);
    this.el.name.classList.toggle('carrying', !!text);
    this.nameTimer = text ? 0 : 1.2;
  }

  update(dt) {
    if (!this.carrying && this.nameTimer > 0 && (this.nameTimer -= dt) <= 0) this.el.name.classList.remove('show');
  }
}
