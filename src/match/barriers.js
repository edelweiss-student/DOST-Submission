import * as THREE from 'three';
import { TEAMS, BASE_RADIUS } from './teams.js';

const HEIGHT = 7;        // metres a barrier stands above the ground (or the sea)
const BELOW = 1.5;       // and reaches below it, so no gap shows on slopes
const SEGMENTS = 160;    // around each one, about 2 m apiece
const DROP = 2.5;        // seconds it takes to sink away when the build phase ends

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying float vDistance;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vDistance = distance( world.xyz, cameraPosition );
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

// u: metres around the ring; v: 0 below the ground to 1 at the top (the
// ground is at GROUND_V).
const fragmentShader = /* glsl */ `
#define GROUND_V ${(BELOW / (BELOW + HEIGHT)).toFixed(4)}
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uDrop;
varying vec2 vUv;
varying float vDistance;
void main() {
  // A glowing line along the ground, a tinted wall fading out above head
  // height, seams every few metres and bands rising up it. Fainter far off.
  float fade = ( 1.0 - smoothstep( 0.45, 1.0, vUv.y ) ) * smoothstep( 0.0, 0.04, vUv.y );
  float line = 1.0 - smoothstep( 0.0, 0.03, abs( vUv.y - GROUND_V - 0.012 ) );
  float seams = smoothstep( 0.86, 1.0, abs( sin( vUv.x * 0.75 ) ) );
  float bands = 0.5 + 0.5 * sin( vUv.y * 30.0 - uTime * 1.6 );
  float near = mix( 0.4, 1.0, 1.0 - smoothstep( 90.0, 260.0, vDistance ) );
  float alpha = ( ( 0.3 + 0.12 * bands + 0.3 * seams ) * fade + 0.55 * line ) * near * uStrength * ( 1.0 - uDrop );
  gl_FragColor = vec4( uColor * ( 1.0 + 0.4 * seams + 0.7 * line ), min( alpha, 0.9 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// A ring of wall around a base, following the ground (or the sea, where
// it's lower), from under the ground to HEIGHT above it.
function ring(terrain, { x: cx, z: cz }, seaLevel) {
  const positions = [], uvs = [], index = [];
  for (let k = 0; k <= SEGMENTS; k++) {
    const a = (k / SEGMENTS) * Math.PI * 2;
    const x = cx + Math.cos(a) * BASE_RADIUS, z = cz + Math.sin(a) * BASE_RADIUS;
    const ground = Math.max(terrain.heightAt(x, z), seaLevel);
    positions.push(x, ground - BELOW, z, x, ground + HEIGHT, z);
    uvs.push(a * BASE_RADIUS, 0, a * BASE_RADIUS, 1);
    if (k < SEGMENTS) index.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

// The barriers of a match's build phase: a shimmering wall in each team's
// colour around its base, BASE_RADIUS metres out. The other teams can't get
// through (keepOut); your own team's is there to see, and lets you through.
// When the build phase ends they sink away.
export class Barriers {
  // bases: every team's ({ x, z }) in TEAMS order; team: yours (its index).
  constructor(scene, terrain, bases, team, seaLevel) {
    this.scene = scene;
    this.bases = bases;
    this.team = team;
    this.up = true;
    this.time = { value: 0 };
    this.drop = { value: 0 };
    this.meshes = bases.map((base, i) => {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(TEAMS[i].color) },
          uStrength: { value: i === team ? 0.55 : 1 },
          uTime: this.time,
          uDrop: this.drop,
        },
        vertexShader, fragmentShader,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ring(terrain, base, seaLevel), material);
      scene.add(mesh);
      return mesh;
    });
    this.dropping = false;
  }

  // Pushes pos (and vel) back out of any other team's base while the
  // barriers are up. Returns the team whose barrier you ran into, or -1.
  keepOut(pos, vel) {
    let hit = -1;
    if (!this.up) return hit;
    this.bases.forEach((b, i) => {
      if (i === this.team) return;
      const dx = pos.x - b.x, dz = pos.z - b.z, d = Math.hypot(dx, dz);
      if (d >= BASE_RADIUS || d < 1e-6) return;
      const nx = dx / d, nz = dz / d;
      pos.x = b.x + nx * BASE_RADIUS;
      pos.z = b.z + nz * BASE_RADIUS;
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
    this.dropping = true;
  }

  update(dt) {
    this.time.value += dt;
    if (!this.dropping) return;
    this.drop.value = Math.min(1, this.drop.value + dt / DROP);
    for (const mesh of this.meshes) mesh.position.y = -HEIGHT * this.drop.value ** 2;
    if (this.drop.value < 1) return;
    this.dropping = false;
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.meshes = [];
  }
}
