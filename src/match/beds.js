import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEAMS, BASE_RADIUS } from './teams.js';
import { PLACE_REACH } from './rules.js';
import { patchMaterial } from '../world/materials.js';
import { uniforms } from '../shared.js';

const BACK = 3;   // metres behind where the team spawns (towards the shore): where a bed nobody placed goes
const WOOD = '#6e4a2c', PILLOW = '#e9e3d2';
const WIDTH = 1.1, LENGTH = 2.1;
const STEEP = 0.6;   // radians (about 35°): ground steeper than this is a cliff, not somewhere for a bed
const SIDE = 1.3;    // metres beside its bed that a player comes back

// How a bed at (x, z), turned to yaw, lies on the ground: tipped to follow
// it, { pitch, roll } in radians (head end up, right side up).
function lie(terrain, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (u, v) => terrain.heightAt(x + c * u + s * v, z - s * u + c * v);
  return {
    pitch: Math.atan2(at(0, LENGTH / 2) - at(0, -LENGTH / 2), LENGTH),
    roll: Math.atan2(at(WIDTH / 2, 0) - at(-WIDTH / 2, 0), WIDTH),
  };
}

// A low-poly bed: a wooden frame on legs with a headboard, a mattress in the
// team's colour, a pillow, and a darker blanket over the foot end. About
// 1.1 m by 2.1 m, its head towards +Z.
function bedGeometry(color) {
  const blanket = new THREE.Color(color).multiplyScalar(0.62).getStyle();
  const parts = [
    [WOOD, [WIDTH, 0.16, LENGTH], [0, 0.3, 0]],                // frame
    ...[[-0.48, -0.95], [0.48, -0.95], [-0.48, 0.95], [0.48, 0.95]].map(([x, z]) => [WOOD, [0.12, 0.26, 0.12], [x, 0.13, z]]),
    [WOOD, [WIDTH, 0.8, 0.12], [0, 0.55, 1.02]],            // headboard
    [WOOD, [WIDTH, 0.42, 0.1], [0, 0.4, -1.03]],            // footboard
    [color, [1.0, 0.2, 1.92], [0, 0.48, 0]],              // mattress
    [PILLOW, [0.78, 0.12, 0.36], [0, 0.63, 0.72]],        // pillow
    [blanket, [1.04, 0.08, 1.15], [0, 0.6, -0.36]],       // blanket
  ].map(([c, [w, h, d], [x, y, z]]) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    g.deleteAttribute('uv');
    const rgb = new THREE.Color(c);
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => [rgb.r, rgb.g, rgb.b]).flat(), 3));
    return g;
  });
  const geometry = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return geometry;
}

// The beds of a bed-wars match, lit and weathered like the world. Each
// team's bed starts in its players' inventories and stands wherever one of
// them places it (see rules.js); one nobody placed goes down at its base,
// just behind where the team spawns. A team is out of respawns once its bed
// is destroyed.
export class Beds {
  // bases: every team's ({ x, z }) in TEAMS order; teams: the teams in the
  // match; building: what's built (beds can stand on a finished floor).
  constructor(scene, terrain, building, bases, teams) {
    Object.assign(this, { scene, terrain, building, bases, teams });
    this.beds = new Map();   // the placed ones, by team: { x, y, z, yaw, mesh, box }
    // Where each team's bed goes if nobody places it ({ x, z, yaw } in TEAMS
    // order, null for teams not in the match): head towards the shore.
    this.defaults = TEAMS.map((_, team) => {
      if (!teams.includes(team)) return null;
      const base = bases[team], r = Math.hypot(base.x, base.z) || 1;
      const ux = base.x / r, uz = base.z / r;   // outwards, away from the middle of the island
      return { x: base.x + ux * BACK, z: base.z + uz * BACK, yaw: Math.atan2(ux, uz) };
    });
    // The see-through bed that shows where yours would go.
    this.ghost = new THREE.Mesh(bedGeometry('#ffffff'), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 2;
    scene.add(this.ghost);
  }

  placed(team) { return this.beds.has(team); }

  // Puts a team's bed down ({ x, y, z, yaw }; y null: on the ground there,
  // yaw null: head towards the shore). On the ground it tips to follow it;
  // on a floor it lies flat.
  place(team, { x, y, z, yaw }) {
    if (this.beds.has(team)) return;
    const ground = this.terrain.heightAt(x, z);
    y ??= ground - 0.05;
    yaw ??= this.defaults[team]?.yaw ?? 0;
    const { pitch, roll } = y < ground + 0.1 ? lie(this.terrain, x, z, yaw) : { pitch: 0, roll: 0 };
    const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'bed', snowMin: 0.6 });
    const mesh = new THREE.Mesh(bedGeometry(TEAMS[team].color), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(-pitch, yaw, roll, 'YXZ');
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    mesh.updateMatrixWorld();
    this.beds.set(team, { x, y, z, yaw, mesh, box: new THREE.Box3().setFromObject(mesh).expandByScalar(0.1) });
  }

  // Where a team's players come back while its bed stands: beside it,
  // facing the middle of the island ({ x, y, z, yaw }, for player.spawn), or
  // null if it hasn't been placed.
  spawnBeside(team) {
    const bed = this.beds.get(team);
    if (!bed) return null;
    const x = bed.x + Math.cos(bed.yaw) * SIDE, z = bed.z - Math.sin(bed.yaw) * SIDE;
    return { x, z, y: bed.y + 0.05, yaw: Math.atan2(x, z) };
  }

  // Where your team's bed would go, aiming along ray (turn: quarter turns,
  // R): { ok, reason, x, y, z, yaw }, or null with no ground within reach.
  // It goes anywhere dry outside the other teams' bases: on the ground
  // (anything short of a cliff), or on a finished floor. Shows the
  // see-through bed there.
  plan(ray, team, turn = 0) {
    const plan = this.aim(ray, team, turn);
    this.ghost.visible = !!plan;
    if (plan) {
      this.ghost.position.set(plan.x, plan.y, plan.z);
      this.ghost.rotation.set(-plan.pitch, plan.yaw, plan.roll, 'YXZ');
      this.ghost.material.color.set(plan.ok ? '#8ff09a' : '#ff6b6b');
    }
    return plan;
  }

  hideGhost() { this.ghost.visible = false; }

  aim(ray, team, turn) {
    const o = ray.origin, d = ray.direction, sea = uniforms.uWaterLevel.value;
    for (let t = 0.3; t <= PLACE_REACH; t += 0.05) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const terrain = this.terrain.heightAt(x, z), floor = this.building.floorAt(x, z, y + 0.3);
      const ground = Math.max(terrain, floor);
      if (y > Math.max(ground, sea)) continue;
      const yaw = Math.atan2(d.x, d.z) + turn * (Math.PI / 2);
      const { pitch, roll } = floor < terrain ? lie(this.terrain, x, z, yaw) : { pitch: 0, roll: 0 };
      const plan = { ok: false, x, y: Math.max(ground, sea) - 0.05, z, yaw, pitch, roll };
      if (ground < sea + 0.05) return { ...plan, reason: 'Not in the water' };
      const other = this.teams.find((i) => i !== team && Math.hypot(x - this.bases[i].x, z - this.bases[i].z) < BASE_RADIUS + 1);
      if (other !== undefined) return { ...plan, reason: `Not in Team ${TEAMS[other].name}’s base` };
      if (Math.abs(pitch) > STEEP || Math.abs(roll) > STEEP) return { ...plan, reason: 'Too steep for a bed' };
      return { ...plan, ok: true };
    }
    return null;
  }

  // The bed a swing along ray would hit within reach (not your own team's):
  // { team, distance }, or null.
  aimed(ray, reach, ownTeam) {
    let best = null;
    const hit = new THREE.Vector3();
    for (const [team, bed] of this.beds) {
      if (team === ownTeam || !ray.intersectBox(bed.box, hit)) continue;
      const distance = hit.distanceTo(ray.origin);
      if (distance <= reach && (!best || distance < best.distance)) best = { team, distance };
    }
    return best;
  }

  destroy(team) {
    const bed = this.beds.get(team);
    if (!bed) return;
    this.scene.remove(bed.mesh);
    bed.mesh.geometry.dispose();
    bed.mesh.material.dispose();
    this.beds.delete(team);
  }
}
