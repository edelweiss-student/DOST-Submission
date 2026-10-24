import * as THREE from 'three';
import { TEAMS, BASE_RADIUS } from './teams.js';
import { patchMaterial } from '../world/materials.js';

const HEIGHT = 4;        // metres a barrier stands above the ground (or the sea): over your head
const BELOW = 1.5;       // and reaches below it, so no gap shows on slopes or in the waves
const THICKNESS = 0.4;   // metres through
const SEGMENTS = 160;    // around each one, about 2 m apiece
const DROP = 2.5;        // seconds it takes to sink away when the build phase ends
// How close the other teams can come to a base's middle: up to the wall's
// outer face, less half a body's width.
const KEEP_OUT = BASE_RADIUS + THICKNESS / 2 + 0.4;

// The wall's look, on the world's own material, so it's lit, shadowed,
// fogged, wet and snowy like everything else: the team's colour in panels
// between slightly lighter ribs every few metres, darker at the foot, with
// a glowing edge along the top and faint glowing bands rising up it (it
// glows at night too). vWall: metres around, and 0 at the foot to 1 at the
// top.
const VERTEX_HEAD = 'attribute vec2 aWall;\nvarying vec2 vWall;\n';
const BEGIN = '#include <begin_vertex>\nvWall = aWall;\n';
const FRAGMENT_HEAD = 'varying vec2 vWall;\n';
const COLOR = /* glsl */ `
{
  float rib = smoothstep( 0.96, 1.0, abs( sin( vWall.x * 0.75 ) ) );
  float cap = smoothstep( 0.9, 0.97, vWall.y );
  float foot = 1.0 - smoothstep( 0.15, 0.4, vWall.y );
  float band = smoothstep( 0.85, 1.0, sin( vWall.y * 14.0 - uTime * 1.4 ) );
  diffuseColor.rgb *= 0.82 + 0.18 * rib + 0.25 * cap - 0.3 * foot;
  totalEmissiveRadiance += diffuseColor.rgb * ( 0.06 * rib + 0.7 * cap + 0.08 * band );
}
`;

// A solid ring of wall around a base: its outside, inside and top, following
// the ground (or the sea, where that's higher) from under it to HEIGHT above.
function ring(terrain, { x: cx, z: cz }, seaLevel) {
  const position = [], normal = [], wall = [], index = [];
  const vertex = (x, y, z, nx, ny, nz, u, v) => {
    position.push(x, y, z);
    normal.push(nx, ny, nz);
    wall.push(u, v);
    return position.length / 3 - 1;
  };
  const outer = BASE_RADIUS + THICKNESS / 2, inner = BASE_RADIUS - THICKNESS / 2;
  let last = null;
  for (let k = 0; k <= SEGMENTS; k++) {
    const a = (k / SEGMENTS) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), u = a * BASE_RADIUS;
    const ground = Math.max(terrain.heightAt(cx + c * BASE_RADIUS, cz + s * BASE_RADIUS), seaLevel);
    const bottom = ground - BELOW, top = ground + HEIGHT;
    const v = {
      outerFoot: vertex(cx + c * outer, bottom, cz + s * outer, c, 0, s, u, 0),
      outerTop: vertex(cx + c * outer, top, cz + s * outer, c, 0, s, u, 1),
      innerFoot: vertex(cx + c * inner, bottom, cz + s * inner, -c, 0, -s, u, 0),
      innerTop: vertex(cx + c * inner, top, cz + s * inner, -c, 0, -s, u, 1),
      capOuter: vertex(cx + c * outer, top, cz + s * outer, 0, 1, 0, u, 1),
      capInner: vertex(cx + c * inner, top, cz + s * inner, 0, 1, 0, u, 1),
    };
    if (last) {
      index.push(last.outerFoot, last.outerTop, v.outerFoot, last.outerTop, v.outerTop, v.outerFoot);   // facing out
      index.push(last.innerFoot, v.innerFoot, last.innerTop, last.innerTop, v.innerFoot, v.innerTop);   // facing in
      index.push(last.capOuter, last.capInner, v.capOuter, last.capInner, v.capInner, v.capOuter);      // facing up
    }
    last = v;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

// The barriers of a match's build phase: a solid wall in each team's colour
// around its base, BASE_RADIUS metres out. The other teams can't get
// through (keepOut); your own team's lets you through. When the build phase
// ends they sink into the ground.
export class Barriers {
  // bases: every team's ({ x, z }) in TEAMS order; team: yours (its index).
  constructor(scene, terrain, bases, team, seaLevel) {
    this.scene = scene;
    this.bases = bases;
    this.team = team;
    this.up = true;
    this.sinking = 0;   // 0..1 while they sink away
    this.meshes = bases.map((base, i) => {
      const material = patchMaterial(new THREE.MeshLambertMaterial({ color: TEAMS[i].color }), {
        key: 'barrier', snowMin: 0.8,
        custom: { vertexHead: VERTEX_HEAD, begin: BEGIN, fragmentHead: FRAGMENT_HEAD, color: COLOR },
      });
      const mesh = new THREE.Mesh(ring(terrain, base, seaLevel), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
  }

  // Pushes pos (and vel) back out of any other team's base while the
  // barriers are up. Returns the team whose barrier you ran into, or -1.
  keepOut(pos, vel) {
    let hit = -1;
    if (!this.up) return hit;
    this.bases.forEach((b, i) => {
      if (i === this.team) return;
      const dx = pos.x - b.x, dz = pos.z - b.z, d = Math.hypot(dx, dz);
      if (d >= KEEP_OUT || d < 1e-6) return;
      const nx = dx / d, nz = dz / d;
      pos.x = b.x + nx * KEEP_OUT;
      pos.z = b.z + nz * KEEP_OUT;
      const inward = vel.x * nx + vel.z * nz;
      if (inward < 0) {
        vel.x -= nx * inward;
        vel.z -= nz * inward;
      }
      hit = i;
    });
    return hit;
  }

  // The build phase is over: everyone can pass, and the walls sink away.
  open() {
    this.up = false;
  }

  update(dt) {
    if (this.up || !this.meshes.length) return;
    this.sinking = Math.min(1, this.sinking + dt / DROP);
    for (const mesh of this.meshes) mesh.position.y = -(HEIGHT + BELOW) * this.sinking ** 2;
    if (this.sinking < 1) return;
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.meshes = [];
  }
}
