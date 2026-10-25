// The menu (index.html #menu): a black panel down the left of the screen
// with one page at a time. Play, Settings and Credits to start with; Play
// leads to Singleplayer and Multiplayer (Bedwars), Settings to Keybinds (a
// tinted screen of every key), Water and Graphics. Paused, it offers
// Resume, Settings and Quit; in multiplayer it holds the lobby.
//
// Buttons say what they do: data-go="page" opens a page, data-back goes
// back one, data-action="name" calls onAction(name, button). A click
// beside the panel (on the game) is onAction('outside').

const MENU_KEY = 'washed-away.menu';   // a page to come back to after reloading for a setting

export class Menu {
  constructor({ onAction }) {
    this.root = document.getElementById('menu');
    this.keys = document.getElementById('keybinds');
    this.pages = new Map([...this.root.querySelectorAll('.menu-page')].map((el) => [el.dataset.page, el]));
    this.statusLine = this.root.querySelector('.menu-status');
    this.stack = [];
    this.rows = new Map();   // option rows by their container (see options())
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) {
        onAction('outside');
        return;
      }
      const button = e.target.closest('button');
      if (!button) return;
      if (button.dataset.go) this.go(button.dataset.go);
      else if (button.hasAttribute('data-back')) this.back();
      else if (button.dataset.action) onAction(button.dataset.action, button);
    });
    this.keys.addEventListener('click', (e) => {
      if (e.target === this.keys || e.target.closest('[data-close]')) this.keybinds(false);
    });
  }

  get visible() { return !this.root.hidden; }
  get page() { return this.stack.at(-1); }

  // Shows the menu at a page (and the pages that lead to it, for Back).
  open(...path) {
    this.root.hidden = false;
    document.body.classList.add('in-menu');
    this.stack = path;
    this.show();
  }

  close() {
    this.keybinds(false);
    // No button keeps the focus, or Space (jump) would press it.
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
    this.root.hidden = true;
    document.body.classList.remove('in-menu');
  }

  go(page) {
    this.stack.push(page);
    this.show();
  }

  back() {
    if (this.stack.length < 2) return;
    this.stack.pop();
    this.show();
  }

  // Esc: closes the keybinds, or goes back a page.
  escape() {
    if (!this.keys.hidden) this.keybinds(false);
    else this.back();
  }

  show() {
    if (!this.pages.has(this.page)) this.stack = ['main'];
    const page = this.page;
    for (const [name, el] of this.pages) el.hidden = name !== page;
    this.root.dataset.page = page;
    for (const [el, render] of this.rows) if (this.pages.get(page).contains(el)) render();
  }

  // The keybinds screen, tinted over the sea (or the game), with the panel
  // out of the way.
  keybinds(open) {
    this.keys.hidden = !open;
    this.root.classList.toggle('keys', open);
  }

  // The button for an action, to relabel or disable.
  button(action) { return this.root.querySelector(`[data-action="${action}"]`); }

  // A line under the pages: what the game is doing (loading, connecting).
  status(text) { this.statusLine.textContent = text; }

  // Advice about the graphics card, on the first page and under Graphics.
  hint(text) { for (const el of this.root.querySelectorAll('.gpu-tip')) el.textContent = text; }

  dev(on) { this.root.querySelector('.menu-dev').hidden = !on; }

  // The game is drawing behind the menu now: the backdrop fades out.
  live() { this.root.classList.add('live'); }

  // Rows of choices in a settings page: [{ label, choices: [[value, text]]
  // (or a function that returns them), get(), set(value), note(value) }].
  // Redrawn whenever the page shows (and by the function returned, when
  // something they show changes).
  options(container, rows) {
    const render = () => {
      container.replaceChildren(...rows.map((row) => {
        const el = document.createElement('div');
        el.className = 'menu-option';
        const label = el.appendChild(document.createElement('b'));
        label.textContent = row.label;
        const choices = el.appendChild(document.createElement('div'));
        choices.className = 'choices';
        const current = String(row.get());
        for (const [value, text] of typeof row.choices === 'function' ? row.choices() : row.choices) {
          const button = choices.appendChild(document.createElement('button'));
          button.type = 'button';
          button.textContent = text;
          button.classList.toggle('active', String(value) === current);
          button.addEventListener('click', () => {
            row.set(value);
            render();
          });
        }
        const note = row.note?.(current);
        if (note) el.appendChild(document.createElement('small')).textContent = note;
        return el;
      }));
    };
    this.rows.set(container, render);
    render();
    return render;
  }

  // Reloading the page for a setting: come back to this page afterwards.
  remember() {
    try { sessionStorage.setItem(MENU_KEY, JSON.stringify(this.stack)); } catch { /* storage blocked */ }
  }

  // The pages to open at, if a reload for a setting left some.
  static remembered() {
    try {
      const stack = JSON.parse(sessionStorage.getItem(MENU_KEY));
      sessionStorage.removeItem(MENU_KEY);
      return Array.isArray(stack) && stack.length ? stack : null;
    } catch {
      return null;
    }
  }
}
