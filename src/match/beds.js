import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEAMS } from './teams.js';
import { patchMaterial } from '../world/materials.js';

const BACK = 3;   // metres behind where the team spawns (towards the shore)
const WOOD = '#6e4a2c', PILLOW = '#e9e3d2';

// A low-poly bed: a wooden frame on legs with a headboard, a mattress in the
// team's colour, a pillow, and a darker blanket over the foot end. About
// 1.1 m by 2.1 m, its head towards +Z.
function bedGeometry(color) {
  const blanket = new THREE.Color(color).multiplyScalar(0.62).getStyle();
  const parts = [
    [WOOD, [1.1, 0.16, 2.1], [0, 0.3, 0]],                // frame
    ...[[-0.48, -0.95], [0.48, -0.95], [-0.48, 0.95], [0.48, 0.95]].map(([x, z]) => [WOOD, [0.12, 0.26, 0.12], [x, 0.13, z]]),
    [WOOD, [1.1, 0.8, 0.12], [0, 0.55, 1.02]],            // headboard
    [WOOD, [1.1, 0.42, 0.1], [0, 0.4, -1.03]],            // footboard
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

// The beds of a bed-wars match, one at each team's base (just behind where
// it spawns), lit and weathered like the world. A team is out of
// respawns once its bed is destroyed (see rules.js).
export class Beds {
  // bases: every team's ({ x, z }) in TEAMS order; teams: the teams in the match.
  constructor(scene, terrain, bases, teams) {
    this.scene = scene;
    this.beds = new Map();   // by team: { x, z, mesh, box }
    for (const team of teams) {
      const base = bases[team], r = Math.hypot(base.x, base.z) || 1;
      const ux = base.x / r, uz = base.z / r;   // outwards, away from the middle of the island
      const x = base.x + ux * BACK, z = base.z + uz * BACK;
      const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'bed', snowMin: 0.6 });
      const mesh = new THREE.Mesh(bedGeometry(TEAMS[team].color), material);
      mesh.position.set(x, terrain.heightAt(x, z) - 0.05, z);
      mesh.rotation.y = Math.atan2(ux, uz);   // head towards the shore
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      mesh.updateMatrixWorld();
      this.beds.set(team, { x, z, mesh, box: new THREE.Box3().setFromObject(mesh).expandByScalar(0.1) });
    }
  }

  // Where each team's bed is ({ x, z } in TEAMS order, null for teams not
  // in the match), for the server to check swings against.
  get positions() {
    return TEAMS.map((_, team) => {
      const bed = this.beds.get(team);
      return bed ? { x: bed.x, z: bed.z } : null;
    });
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
