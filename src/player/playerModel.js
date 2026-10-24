import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A player, low-poly: a survivor built from chunky, flat-shaded blocks,
// coloured per vertex. The shirt, its sleeves and a headband are in the
// team's colour, over neutral clothes, boots and a canvas backpack, under a
// salakot (the Philippines' traditional woven hat).
//
// It's one skinned mesh (one draw call) on a small skeleton, so arms and
// legs swing at the shoulders and hips and bend at the elbows and knees.
// About 1.85 m tall (2 m with the hat) with its eyes at 1.7 m, like the
// first-person camera.
// It stands on y = 0 and faces -Z, the way the camera looks at yaw 0, so a
// player's yaw turns it to face where they look.

const SKIN = '#c4946b', HAIR = '#3a2a1f', EYES = '#1c1917';
const TROUSERS = '#4b5157', BOOTS = '#5a3a25', BELT = '#2b2622', PACK = '#7b6a4c', ROLL = '#5d6a50';
const SALAKOT = '#c8a464', SALAKOT_TOP = '#8a6a3a';

// The joints: parent, and where each sits standing still (m).
const JOINTS = {
  hips: [null, 0, 0.94, 0],
  spine: ['hips', 0, 1.02, 0],
  head: ['spine', 0, 1.53, 0],
  upperArmL: ['spine', -0.27, 1.44, 0],
  forearmL: ['upperArmL', -0.27, 1.12, 0],
  upperArmR: ['spine', 0.27, 1.44, 0],
  forearmR: ['upperArmR', 0.27, 1.12, 0],
  thighL: ['hips', -0.1, 0.92, 0],
  shinL: ['thighL', -0.1, 0.5, 0],
  thighR: ['hips', 0.1, 0.92, 0],
  shinR: ['thighR', 0.1, 0.5, 0],
};
const BONE = Object.fromEntries(Object.keys(JOINTS).map((name, i) => [name, i]));

// The blocks: [joint, colour ('team' for the team's), size [w, h, d], centre
// [x, y, z], and how much wider the top is than the bottom (below 1,
// narrower), across and front to back]. Left is -X. A 'cone' instead of
// the last is a ten-sided cone, its size [radius at the bottom, height,
// radius at the top].
const BLOCKS = [
  // Legs and boots
  ...[-1, 1].flatMap((side) => {
    const s = side < 0 ? 'L' : 'R', x = 0.1 * side;
    return [
      [`thigh${s}`, TROUSERS, [0.15, 0.44, 0.16], [x, 0.72, 0], [1.1, 1.05]],
      [`shin${s}`, TROUSERS, [0.12, 0.42, 0.13], [x, 0.33, 0], [1.12, 1.08]],
      [`shin${s}`, BOOTS, [0.14, 0.13, 0.25], [x, 0.065, -0.035], [0.95, 0.9]],
    ];
  }),
  // Hips, belt, the shirt (wider at the shoulders), backpack and bedroll
  ['hips', TROUSERS, [0.35, 0.17, 0.21], [0, 0.95, 0], [1, 1]],
  ['hips', BELT, [0.37, 0.05, 0.23], [0, 1.03, 0], [1, 1]],
  ['spine', 'team', [0.35, 0.47, 0.22], [0, 1.28, 0], [1.22, 1.06]],
  ['spine', PACK, [0.3, 0.34, 0.12], [0, 1.27, 0.17], [0.92, 1]],
  ['spine', ROLL, [0.34, 0.09, 0.11], [0, 1.47, 0.17], [1, 1]],
  // Neck, head, hair, headband and eyes
  ['head', SKIN, [0.1, 0.08, 0.1], [0, 1.55, 0], [1, 1]],
  ['head', SKIN, [0.24, 0.27, 0.25], [0, 1.69, 0], [1.08, 1.04]],
  ['head', HAIR, [0.265, 0.09, 0.275], [0, 1.835, 0.005], [0.9, 0.9]],
  ['head', HAIR, [0.265, 0.2, 0.06], [0, 1.72, 0.115], [1, 1]],
  ['head', 'team', [0.27, 0.045, 0.28], [0, 1.775, 0], [1, 1]],
  ['head', EYES, [0.04, 0.035, 0.01], [-0.055, 1.7, -0.126], [1, 1]],
  ['head', EYES, [0.04, 0.035, 0.01], [0.055, 1.7, -0.126], [1, 1]],
  // The salakot, over the hair and above the headband, with its knob on top
  ['head', SALAKOT, [0.29, 0.13, 0.04], [0, 1.895, 0], 'cone'],
  ['head', SALAKOT_TOP, [0.045, 0.04, 0.02], [0, 1.975, 0], 'cone'],
  // Arms: sleeves to the elbow, then skin
  ...[-1, 1].flatMap((side) => {
    const s = side < 0 ? 'L' : 'R', x = 0.27 * side;
    return [
      [`upperArm${s}`, 'team', [0.11, 0.33, 0.12], [x, 1.285, 0], [1.08, 1.06]],
      [`forearm${s}`, SKIN, [0.085, 0.28, 0.09], [x, 0.99, 0], [1.1, 1.08]],
      [`forearm${s}`, SKIN, [0.095, 0.1, 0.085], [x, 0.81, -0.005], [1, 1]],
    ];
  }),
];

const linear = (hex) => new THREE.Color(hex);

// One block: a box with its top widened (or narrowed), or a cone,
// coloured, and bound whole to one joint.
function block([joint, color, size, [x, y, z], shape], teamColor) {
  let g;
  if (shape === 'cone') {
    const [bottom, h, top] = size;
    g = new THREE.CylinderGeometry(top, bottom, h, 10).toNonIndexed();
  } else {
    const [w, h, d] = size, [topX, topZ] = shape;
    g = new THREE.BoxGeometry(w, h, d);
    const box = g.attributes.position;
    for (let i = 0; i < box.count; i++) {
      if (box.getY(i) > 0) box.setXYZ(i, box.getX(i) * topX, box.getY(i), box.getZ(i) * topZ);
    }
    g = g.toNonIndexed();   // like the cones, so they all merge
  }
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  g.translate(x, y, z);
  g.computeVertexNormals();   // each face has its own corners, so it stays flat-shaded
  const c = linear(color === 'team' ? teamColor : color);
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: p.count }, () => [c.r, c.g, c.b]).flat(), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({ length: p.count }, () => [BONE[joint], 0, 0, 0]).flat(), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: p.count }, () => [1, 0, 0, 0]).flat(), 4));
  return g;
}

export class PlayerModel {
  // color: the team's colour (any THREE.Color input). material: defaults to
  // a plain flat-shaded one; the world can pass one patched for its fog and
  // weather (world/materials.js).
  constructor(color = '#cccccc', { material = new THREE.MeshLambertMaterial({ vertexColors: true }) } = {}) {
    const parts = BLOCKS.map((b) => block(b, color));
    // Which vertices are in the team's colour, so it can change.
    this.teamRanges = [];
    let start = 0;
    BLOCKS.forEach((b, i) => {
      const count = parts[i].attributes.position.count;
      if (b[1] === 'team') this.teamRanges.push([start, count]);
      start += count;
    });
    this.geometry = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());

    // The skeleton, standing still as built.
    this.bones = {};
    for (const [name, [parent, x, y, z]] of Object.entries(JOINTS)) {
      const bone = new THREE.Bone();
      bone.name = name;
      const [, px, py, pz] = parent ? JOINTS[parent] : [null, 0, 0, 0];
      bone.position.set(x - px, y - py, z - pz);
      if (parent) this.bones[parent].add(bone);
      this.bones[name] = bone;
    }
    this.rest = this.bones.hips.position.y;
    this.mesh = new THREE.SkinnedMesh(this.geometry, material);
    this.mesh.add(this.bones.hips);
    this.mesh.bind(new THREE.Skeleton(Object.values(this.bones)));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;   // its limbs move outside the bounds it was built with
    this.object = new THREE.Group();
    this.object.add(this.mesh);
    this.phase = Math.random() * 10;
    this.time = Math.random() * 10;
  }

  // Changes the team colour (a team switch).
  setColor(color) {
    const c = linear(color), attr = this.geometry.attributes.color;
    for (const [start, count] of this.teamRanges) {
      for (let i = start; i < start + count; i++) attr.setXYZ(i, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  // dt in seconds; speed in m/s. Walks in step with its speed, swinging its
  // arms against its legs, and stands and breathes, looking about, when
  // it's still.
  update(dt, speed = 0) {
    const b = this.bones;
    const walk = Math.min(1, speed / 3.5), still = 1 - walk;
    this.phase += dt * (2 + speed * 1.8);
    this.time += dt;
    const s = Math.sin(this.phase), c = Math.cos(this.phase), t = this.time;
    // Legs swing forward (+X rotation) and the knee bends on the way through.
    b.thighL.rotation.x = s * 0.6 * walk;
    b.thighR.rotation.x = -s * 0.6 * walk;
    b.shinL.rotation.x = -Math.max(0, c) * 0.9 * walk;
    b.shinR.rotation.x = -Math.max(0, -c) * 0.9 * walk;
    // Arms against the legs, a little out from the body, elbows bent.
    b.upperArmL.rotation.set(-s * 0.5 * walk, 0, -0.07 - 0.02 * Math.sin(t * 1.7) * still);
    b.upperArmR.rotation.set(s * 0.5 * walk, 0, 0.07 + 0.02 * Math.sin(t * 1.7) * still);
    b.forearmL.rotation.x = 0.12 + 0.3 * walk;
    b.forearmR.rotation.x = 0.12 + 0.3 * walk;
    // The body bobs and twists with each step and leans into the walk;
    // standing, it breathes and looks about.
    b.hips.position.y = this.rest + 0.025 * Math.cos(2 * this.phase) * walk;
    b.spine.rotation.set(-0.06 * walk - 0.015 * Math.sin(t * 1.7) * still, 0.12 * s * walk, 0);
    b.head.rotation.set(0.04 * walk, 0.25 * Math.sin(t * 0.37) * still, 0);
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
