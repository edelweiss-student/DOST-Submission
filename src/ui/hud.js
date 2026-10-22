import { WEATHER } from '../weather/weather.js';
import { MAX_OXYGEN, MAX_STAMINA } from '../player/player.js';
import { TIERS } from '../climate/entity.js';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

// Sea state names by significant wave height (after the Douglas sea scale).
const SEA_STATES = [[0.1, 'Glassy'], [0.5, 'Calm'], [1.25, 'Choppy'], [2.5, 'Rough'], [4, 'Very rough'], [Infinity, 'High seas']];
const seaState = (hs) => SEA_STATES.find(([max]) => hs < max)[1];

// Heat warnings by heat index (°C), at the US National Weather Service's
// "danger" and "extreme danger" levels.
const HEAT_WARNINGS = [
  { min: 41, text: 'Dangerous heat. You’ll tire fast: cool off in the sea or find some shade.' },
  { min: 54, text: 'Extreme heat. Get into the sea or out of the sun.' },
];

// What's stressing the land where you are (see climate/entity.js).
const CAUSES = { felling: 'felling', mining: 'mining and clearing', building: 'building' };

export class HUD {
  constructor() {
    this.el = {
      icon: $('w-icon'), label: $('w-label'), temp: $('w-temp'), feels: $('w-feels'), wind: $('w-wind'), seaState: $('w-sea'),
      forecast: $('w-forecast'), clock: $('clock'), solar: $('solar'), sea: $('sea'), climate: $('climate'), region: $('region'),
      oxygen: $('oxygen'), oxygenFill: $('oxygen-fill'), health: $('health'), healthFill: $('health-fill'),
      stamina: $('stamina'), staminaFill: $('stamina-fill'),
      depth: $('depth'), message: $('message'), underwater: $('underwater'),
    };
    this.timer = 0;
    this.messageTimer = 0;
    this.heatLevel = 0;   // heat warnings given so far (until the heat eases)
  }

  message(text, seconds = 4) {
    this.el.message.textContent = text;
    this.el.message.classList.add('show');
    this.messageTimer = seconds;
  }

  update(dt, { weather, sea, climate, clock, player, waves }) {
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
    // Stamina turns orange while the heat is wearing you down.
    e.stamina.classList.toggle('show', player.stamina < MAX_STAMINA - 0.1);
    e.staminaFill.style.width = `${(player.stamina / MAX_STAMINA) * 100}%`;
    e.stamina.classList.toggle('low', player.exhausted);
    e.stamina.classList.toggle('hot', player.hot);

    // Text: a few times a second is plenty.
    if ((this.timer -= dt) > 0) return;
    this.timer = 0.2;
    const w = WEATHER[weather.key];
    e.icon.textContent = w.icon;
    e.label.textContent = weather.label;
    // The heat index, when humidity makes it feel clearly hotter than it is.
    const temp = weather.temperature, hi = weather.heatIndex;
    e.temp.textContent = `${Math.round(temp)}°C`;
    e.feels.textContent = hi - temp >= 2 ? `feels ${Math.round(hi)}°C` : '';
    e.feels.classList.toggle('danger', hi >= HEAT_WARNINGS[0].min);
    // Warn as the heat turns dangerous, and again if it turns extreme. A
    // warning comes back only once the heat has eased 3 °C below its level.
    while (this.heatLevel > 0 && hi < HEAT_WARNINGS[this.heatLevel - 1].min - 3) this.heatLevel--;
    const level = HEAT_WARNINGS.filter((warning) => hi >= warning.min).length;
    if (level > this.heatLevel) {
      this.heatLevel = level;
      this.message(HEAT_WARNINGS[level - 1].text, 6);
    }
    const gusts = weather.gustiness > 0.15 ? `, gusting ${Math.round(weather.gustSpeed * 3.6)}` : '';
    e.wind.textContent = `Wind ${Math.round(weather.windSpeed * 3.6)} km/h${gusts}`;
    e.seaState.textContent = `Sea: ${seaState(waves.hs)} · ${waves.hs.toFixed(1)} m waves`;
    const s = Math.max(0, Math.ceil(weather.timeLeft));
    e.forecast.textContent = `Next: ${WEATHER[weather.next].label} in ${Math.floor(s / 60)}:${pad(s % 60)}`;
    e.clock.textContent = `Day ${clock.day} · ${pad(clock.hours)}:${pad(clock.minutes)}`;
    e.solar.textContent = `Solar output +${((weather.solarOutput - 1) * 100).toFixed(2)}%`;
    // Long-term rise, which way the tide is going, and any storm surge.
    const turning = Math.abs(sea.tideRate) < 0.0012;
    const tide = turning ? (sea.tide > 0 ? 'high tide' : 'low tide') : sea.tideRate > 0 ? 'tide rising' : 'tide falling';
    const surge = sea.surge > 0.1 ? ` · surge +${sea.surge.toFixed(1)} m` : '';
    e.sea.textContent = `Sea level +${sea.rise.toFixed(2)} m · ${tide}${surge}`;
    // The climate's tier and pressure, with an arrow while it's on its way
    // to the next tier up or down; then how the land you're on is doing.
    const heading = climate.timers.up > 0 ? ' ▲' : climate.timers.down > 0 ? ' ▼' : '';
    e.climate.dataset.tier = climate.tier;
    e.climate.textContent = `Climate: ${TIERS[climate.tier].name} · pressure ${Math.round(climate.pressure * 100)}%${heading}`;
    const r = climate.here, cause = r.land && climate.causeOf(r);
    e.region.textContent = r.land ? `${r.name}: ${climate.statusOf(r)}${cause ? ` · ${CAUSES[cause]}` : ''}` : '';
    e.depth.textContent = player.underwater ? `Depth ${player.depth.toFixed(1)} m` : '';
  }
}
