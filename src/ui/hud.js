import { WEATHER } from '../weather/weather.js';
import { MAX_OXYGEN } from '../player/player.js';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

// Sea state names by significant wave height (after the Douglas sea scale).
const SEA_STATES = [[0.1, 'Glassy'], [0.5, 'Calm'], [1.25, 'Choppy'], [2.5, 'Rough'], [4, 'Very rough'], [Infinity, 'High seas']];
const seaState = (hs) => SEA_STATES.find(([max]) => hs < max)[1];

export class HUD {
  constructor() {
    this.el = {
      icon: $('w-icon'), label: $('w-label'), temp: $('w-temp'), wind: $('w-wind'), seaState: $('w-sea'),
      forecast: $('w-forecast'), clock: $('clock'), solar: $('solar'), sea: $('sea'),
      oxygen: $('oxygen'), oxygenFill: $('oxygen-fill'), health: $('health'), healthFill: $('health-fill'),
      depth: $('depth'), message: $('message'), underwater: $('underwater'),
    };
    this.timer = 0;
    this.messageTimer = 0;
  }

  message(text, seconds = 4) {
    this.el.message.textContent = text;
    this.el.message.classList.add('show');
    this.messageTimer = seconds;
  }

  update(dt, { weather, clock, player, waves }) {
    if (this.messageTimer > 0 && (this.messageTimer -= dt) <= 0) this.el.message.classList.remove('show');

    // Per-frame: underwater tint and bars.
    const e = this.el;
    e.underwater.style.opacity = player.underwater ? Math.min(1, 0.55 + player.depth / 30) : 0;
    const showOxygen = player.underwater || player.oxygen < MAX_OXYGEN - 0.1;
    e.oxygen.classList.toggle('show', showOxygen);
    e.oxygenFill.style.width = `${(player.oxygen / MAX_OXYGEN) * 100}%`;
    e.oxygen.classList.toggle('low', player.oxygen < 8);
    e.health.classList.toggle('show', player.health < 99.5);
    e.healthFill.style.width = `${Math.max(0, player.health)}%`;

    // Text: a few times a second is plenty.
    if ((this.timer -= dt) > 0) return;
    this.timer = 0.2;
    const w = WEATHER[weather.key];
    e.icon.textContent = w.icon;
    e.label.textContent = weather.label;
    e.temp.textContent = `${Math.round(weather.temperature)}°C`;
    const gusts = weather.gustiness > 0.15 ? `, gusting ${Math.round(weather.gustSpeed * 3.6)}` : '';
    e.wind.textContent = `Wind ${Math.round(weather.windSpeed * 3.6)} km/h${gusts}`;
    e.seaState.textContent = `Sea: ${seaState(waves.hs)} · ${waves.hs.toFixed(1)} m waves`;
    const s = Math.max(0, Math.ceil(weather.timeLeft));
    e.forecast.textContent = `Next: ${WEATHER[weather.next].label} in ${Math.floor(s / 60)}:${pad(s % 60)}`;
    e.clock.textContent = `Day ${clock.day} · ${pad(clock.hours)}:${pad(clock.minutes)}`;
    e.solar.textContent = `Solar output +${((weather.solarOutput - 1) * 100).toFixed(2)}%`;
    e.sea.textContent = `Sea level +${weather.seaLevel.toFixed(2)} m`;
    e.depth.textContent = player.underwater ? `Depth ${player.depth.toFixed(1)} m` : '';
  }
}
