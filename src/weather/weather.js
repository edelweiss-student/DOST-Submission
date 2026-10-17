import * as THREE from 'three';
import { SEA, uniforms, clamp, lerp, smoothstep } from '../shared.js';

// Every preset is a target the live weather blends toward.
// wind is 0..1 of MAX_WIND. It drives tree sway, rain slant and the sea:
// waves are generated from the wind speed (see world/waves.js).
// humidity is relative humidity in %.
export const MAX_WIND = 28; // m/s, about 100 km/h

const DEFAULTS = {
  cloud: 0, dark: 0, rain: 0, snow: 0, fog: 0.0026, wind: 0.11, temp: 20, humidity: 60,
  haze: 0, mist: 0, sunMul: 1, sunScale: 1, lightning: 0,
};

export const WEATHER = {
  clear:    { label: 'Clear skies',  icon: '☀', water: '#2a86ad', cloud: 0.12, wind: 0.11, temp: 24, humidity: 55 },
  overcast: { label: 'Overcast',     icon: '☁', water: '#2d6f8c', cloud: 0.8, dark: 0.25, fog: 0.0035, wind: 0.16, temp: 17, humidity: 70 },
  rain:     { label: 'Rain',         icon: '☂', water: '#2a5f78', cloud: 0.92, dark: 0.45, rain: 0.55, fog: 0.006, wind: 0.3, temp: 14, humidity: 90, sunMul: 0.8 },
  storm:    { label: 'Thunderstorm', icon: '⚡', water: '#21475a', cloud: 1, dark: 0.85, rain: 1, fog: 0.009, wind: 1, temp: 12, humidity: 95, lightning: 0.3 },
  fog:      { label: 'Dense fog',    icon: '≋', water: '#3a6676', cloud: 0.5, dark: 0.1, fog: 0.028, wind: 0.06, temp: 11, humidity: 98, mist: 1 },
  heatwave: { label: 'Heatwave',     icon: '♨', water: '#3e8f7c', cloud: 0, fog: 0.0045, wind: 0.09, temp: 43, humidity: 30, haze: 1, sunMul: 1.25, sunScale: 1.35 },
  snow:     { label: 'Cold snap',    icon: '❄', water: '#3b6f8a', cloud: 0.85, dark: 0.2, snow: 0.8, fog: 0.011, wind: 0.3, temp: -6, humidity: 40 },
};
export const WEATHER_KEYS = Object.keys(WEATHER);
const PARAMS = Object.keys(DEFAULTS);
const target = (key) => ({ ...DEFAULTS, ...WEATHER[key] });

// Storms come in three strengths. `force` is the severity used by the dev key.
const STORM_LEVELS = [
  { upTo: 0.34, label: 'Thunderstorm', force: 0.2 },
  { upTo: 0.67, label: 'Severe thunderstorm', force: 0.55 },
  { upTo: 1.01, label: 'Violent storm', force: 0.95 },
];
const stormTarget = (s) => ({
  ...target('storm'),
  wind: 0.5 + 0.5 * s,          // 50 to 100 km/h
  rain: 0.65 + 0.35 * s,
  lightning: 0.12 + 0.4 * s,
  fog: 0.006 + 0.006 * s,
  dark: 0.65 + 0.3 * s,
});

const CLIMATE_RAMP = 1500;   // seconds until the climate is at its most unstable

// Heat index: how hot it feels (°C) at a temperature (°C) and relative
// humidity (%), in the shade. This is the US National Weather Service's
// Rothfusz regression, with its corrections for very dry and very humid
// air. It is only meant for hot weather, so below about 27 °C it hands over
// to the air temperature.
export function heatIndex(temp, rh) {
  const T = temp * 1.8 + 32;
  let hi = -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh
    - 0.00683783 * T * T - 0.05481717 * rh * rh + 0.00122874 * T * T * rh
    + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
  if (rh < 13 && T > 80 && T < 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  else if (rh > 85 && T > 80 && T < 87) hi += ((rh - 85) / 10) * ((87 - T) / 5);
  return lerp(temp, (hi - 32) / 1.8, smoothstep(26, 28, temp));
}

// Climate model: weather keeps shifting, and as the swelling sun's output
// rises the shifts come faster and more often extreme. The sea level that
// goes with it is in sealevel.js.
export class Weather {
  constructor(rng) {
    this.rng = rng;
    this.elapsed = 0;
    this.instability = 0;
    this.key = 'clear';
    this.severity = 0;
    this.target = target('clear');
    this.current = { ...this.target };
    this.waterColor = new THREE.Color(WEATHER.clear.water);
    this.targetWater = this.waterColor.clone();
    this.timeLeft = 70;
    this.tau = 8;
    this.next = this.pickNext();
    this.windAngle = SEA.windDir;
    this.windPhase = rng() * Math.PI * 2;
    this.gustPhases = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
    this.gustiness = 0;
    this.gustWind = 0;     // wind right now, gusts included (0..1.3)
    this.wetness = 0; this.snowCover = 0; this.dryness = 0; this.bleach = 0;
    this.dayF = 1;
    this.onChange = null;
    this.onMilestone = null;
    this.milestone = 0;
  }

  pickNext() {
    const s = this.instability;
    const weights = {
      clear: 3 - 2 * s, overcast: 2 - 0.8 * s, rain: 2, storm: 0.6 + 2.6 * s,
      fog: 1, heatwave: 0.5 + 2.6 * s, snow: 0.35 + 1.4 * s,
    };
    // Cold snaps right after heatwaves are the climate whiplash we want.
    if (this.key === 'heatwave') weights.snow += s * 2;
    delete weights[this.key];
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (const [k, w] of Object.entries(weights)) {
      if ((r -= w) <= 0) return k;
    }
    return 'overcast';
  }

  setWeather(key, tau, severity) {
    this.key = key;
    if (key === 'storm') {
      // How bad this storm is. Bad ones get likelier as the climate breaks down.
      this.severity = severity ?? clamp(this.rng() * 0.75 + this.instability * 0.45 - 0.1, 0, 1);
      this.target = stormTarget(this.severity);
    } else {
      this.target = target(key);
    }
    this.targetWater.set(WEATHER[key].water);
    this.timeLeft = lerp(110, 35, this.instability) * (0.7 + 0.6 * this.rng());
    this.tau = tau ?? lerp(9, 4, this.instability);
    this.next = this.pickNext();
    this.onChange?.(key);
  }

  // Dev shortcut. Forcing a storm while one is raging steps it up a level.
  force(key) {
    if (!WEATHER[key]) return;
    let severity;
    if (key === 'storm') {
      const level = this.key === 'storm' ? STORM_LEVELS.findIndex((l) => this.severity < l.upTo) : -1;
      severity = STORM_LEVELS[(level + 1) % STORM_LEVELS.length].force;
    }
    this.setWeather(key, 2.5, severity);
  }

  get label() {
    if (this.key !== 'storm') return WEATHER[this.key].label;
    return STORM_LEVELS.find((l) => this.severity < l.upTo).label;
  }

  get windSpeed() { return this.current.wind * MAX_WIND; }

  get gustSpeed() { return this.current.wind * (1 + this.gustiness) * MAX_WIND; }

  advanceClimate(seconds) { this.elapsed += seconds; }

  get temperature() {
    const c = this.current;
    return c.temp + (c.temp > 5 ? 6 * this.instability : 0) - (1 - this.dayF) * 5;
  }

  get humidity() { return this.current.humidity; }

  get heatIndex() { return heatIndex(this.temperature, this.humidity); }

  get solarOutput() { return 1 + this.instability * 0.04; }

  update(dt) {
    this.elapsed += dt;
    this.instability = clamp(this.elapsed / CLIMATE_RAMP, 0, 1);
    const m = Math.floor(this.instability * 4);
    if (m > this.milestone) { this.milestone = m; this.onMilestone?.(m); }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) this.setWeather(this.next);

    const k = 1 - Math.exp(-dt / this.tau);
    for (const p of PARAMS) this.current[p] += (this.target[p] - this.current[p]) * k;
    this.waterColor.lerp(this.targetWater, k);

    // Ground state builds up and fades, so weather leaves traces behind.
    const c = this.current, temp = this.temperature;
    const heat = Math.max(0, temp - 20) / 10;
    this.wetness = clamp(this.wetness + (c.rain * dt) / 18 - (c.rain < 0.1 ? (dt / 90) * (1 + heat) : 0), 0, 1);
    this.snowCover = clamp(this.snowCover + (temp < 2 ? (c.snow * dt) / 30 : 0) - (temp > 0 ? (dt / 60) * Math.max(0.3, temp / 8) : 0), 0, 1);
    this.dryness = clamp(this.dryness + (temp > 32 ? dt / 70 : 0) - (c.rain * dt) / 25 - (temp <= 32 ? dt / 400 : 0), 0, 1);
    this.bleach = clamp(this.bleach + (temp > 35 ? dt / 110 : -dt / 500), 0, 1);

    // The wind wanders around the prevailing direction, swinging harder in storms.
    const e = this.elapsed;
    this.windAngle = SEA.windDir + 0.6 * Math.sin(e * 0.013 + this.windPhase)
      + 0.3 * (0.5 + c.wind) * Math.sin(e * 0.047 + this.windPhase * 2.3);
    // Gusts: the wind never blows steadily, least of all in a storm.
    const [g0, g1, g2] = this.gustPhases;
    const gust = Math.sin(e * 0.83 + g0) * 0.5 + Math.sin(e * 0.37 + g1) * 0.35 + Math.sin(e * 1.9 + g2) * 0.15;
    // Peak gusts run up to ~1.3x the mean wind in a violent storm.
    this.gustiness = 0.08 + 0.22 * clamp((c.wind - 0.3) / 0.7, 0, 1);
    this.gustWind = clamp(c.wind * (1 + this.gustiness * gust), 0, 1.3);

    uniforms.uWind.value = this.gustWind;
    uniforms.uWindDir.value.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    uniforms.uSnow.value = this.snowCover;
    uniforms.uWet.value = this.wetness;
    uniforms.uDry.value = this.dryness;
    uniforms.uBleach.value = this.bleach;
  }
}
