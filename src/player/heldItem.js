import * as THREE from 'three';
import { isTool, toolGeometry } from '../items/models.js';
import { patchMaterial } from '../world/materials.js';
import { LOG_LENGTH, LOG_RADIUS, PLANK, logGeometry, boardGeometry } from '../world/wood.js';
import { CARRY } from '../world/timber.js';

// How each tool sits in your hand: its size, and where the grip is (m,
// from the eye), so a big head doesn't fill the view and a short knife
// still shows.
const GRIP = {
  knife: { scale: 1, y: -0.36, z: -0.5 },
  axe: { scale: 0.7, y: -0.48, z: -0.6 },
  pickaxe: { scale: 0.58, y: -0.47, z: -0.6 },
  spear: { scale: 1, y: -0.3, z: -0.28 },
};

// How each tool swings. duration in seconds; hit: when in the swing the
// tool lands (0..1), which is when its work is done.
// A strike (knife, pickaxe) jabs down and forward from where it's held.
const STRIKE = { duration: 0.29, hit: 0.5 };
// A chop (the axe) swings level from right to left. Your hands stay low on
// the right and move in a little, while the axe turns in them, so the head
// sweeps across the view from the right edge and bites in edge first right
// at the crosshair, jolts with the blow, then pulls back.
const CHOP = {
  duration: 0.5, hit: 0.45,
  // Where the grip is (from the eye) and how far the axe has turned (to the
  // left, about the vertical): wound back, and at the hit.
  grip: [new THREE.Vector3(0.36, -0.22, -0.5), new THREE.Vector3(0.17, -0.09, -0.42)],
  turn: [-0.85, 0.12],
  recoil: 0.09,   // how far the blow jolts it back (radians)
  // Held out: the handle forward and a little up, the edge (the head's +X)
  // facing left, the way the swing goes, and the blade flat, so at eye
  // level it's seen edge on.
  hold: (() => {
    const lift = 0.25;
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, Math.sin(lift), -Math.cos(lift)),
      new THREE.Vector3(0, -Math.cos(lift), -Math.sin(lift)),
    ));
  })(),
};
// A thrust (the spear, striking in a match) jabs straight ahead and back.
const THRUST = { duration: 0.32, hit: 0.42 };
const SWINGS = { knife: STRIKE, axe: CHOP, pickaxe: STRIKE, spear: THRUST };
const UP = new THREE.Vector3(0, 1, 0);
const ease = (t) => t * t * (3 - 2 * t);

// What's in your hands, at the lower right of the view: the selected tool,
// which bobs as you walk and swings when you use it, or the wood you're
// carrying instead (logs on your shoulder, planks under your arm). The
// spear is held pointing ahead, and drawn back over your shoulder to throw.
// wood: the wood materials (world/wood.js), shared with the logs and
// planks lying in the world.
export function createHeldItem(scene, camera, wood) {
  scene.add(camera);   // things attached to the camera are only drawn if it's in the scene
  const hand = new THREE.Group();
  camera.add(hand);
  const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'held-item', snowMin: 0.95 });
  const models = {};
  let shown = null;
  let swing = null, bob = 0;   // swing: { style, t (0..1), onHit, landed }
  let drawn = 0;               // how far the spear is drawn back to throw (0..1)
  const spearTurn = new THREE.Euler(0, 0, 0, 'YXZ');

  // Poses of the hand: where the grip is and how the tool is turned.
  const rest = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const euler = new THREE.Euler(), turn = new THREE.Quaternion();
  // The axe mid-chop: the grip t of the way from wound back to the hit,
  // and turned to angle.
  const chopAt = (t, angle) => {
    pose.pos.lerpVectors(CHOP.grip[0], CHOP.grip[1], t);
    turn.setFromAxisAngle(UP, angle);
    pose.quat.copy(turn).multiply(CHOP.hold);
    return pose;
  };
  const set = ({ pos, quat }) => {
    hand.position.copy(pos);
    hand.quaternion.copy(quat);
  };
  const blend = (from, to, t) => {
    hand.position.lerpVectors(from.pos, to.pos, t);
    hand.quaternion.slerpQuaternions(from.quat, to.quat, t);
  };
  // u: how far through the swing (0..1).
  function chop(u) {
    const [back, at] = CHOP.turn, windUp = 0.28, bitten = 0.6;
    if (u < windUp) {
      blend(rest, chopAt(0, back), ease(u / windUp));
    } else if (u < CHOP.hit) {
      const t = (u - windUp) / (CHOP.hit - windUp);
      set(chopAt(t, back + (at - back) * t * t));   // gathering speed into the hit
    } else if (u < bitten) {
      const t = (u - CHOP.hit) / (bitten - CHOP.hit);
      set(chopAt(1, at - CHOP.recoil * Math.sin(t * Math.PI) * (1 - t)));   // the jolt of the blow
    } else {
      blend(chopAt(1, at), rest, ease((u - bitten) / (1 - bitten)));
    }
  }
  function strike(u) {
    const s = Math.sin(u * Math.PI);   // out and back
    hand.position.set(rest.pos.x + s * 0.04, rest.pos.y, rest.pos.z - s * 0.08);
    hand.quaternion.setFromEuler(euler.set(-0.45 - s * 1.1, 0.35, 0.45));
  }
  function thrust(u) {
    const s = Math.sin(u * Math.PI);   // out and back
    hand.position.set(rest.pos.x - s * 0.08, rest.pos.y + s * 0.04, rest.pos.z - s * 0.4);
    hand.quaternion.copy(rest.quat);
  }

  // Carried wood: instanced like the wood in the world, so it shares its shaders.
  const arms = new THREE.Group();
  camera.add(arms);
  const logGeo = logGeometry(), boardGeo = boardGeometry();
  const logs = {};
  const logMesh = (bark) => {
    if (!logs[bark]) {
      logs[bark] = new THREE.InstancedMesh(logGeo, [wood.bark[bark], wood.endGrain, wood.endGrain], CARRY.log);
      logs[bark].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CARRY.log * 3).fill(1), 3);
      logs[bark].count = 0;
      logs[bark].frustumCulled = false;
      arms.add(logs[bark]);
    }
    return logs[bark];
  };
  const planks = new THREE.InstancedMesh(boardGeo, wood.plank, CARRY.plank);
  planks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CARRY.plank * 3).fill(1), 3);
  planks.count = 0;
  planks.frustumCulled = false;
  arms.add(planks);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX'), p = new THREE.Vector3(), s = new THREE.Vector3();
  let carriedKey = '';

  // Logs lie on your right shoulder pointing ahead; planks are stacked under your arm.
  function showCarried(carried) {
    const key = carried.map((c) => c.kind + (c.bark ?? '')).join();
    if (key === carriedKey) return;
    carriedKey = key;
    for (const mesh of Object.values(logs)) mesh.count = 0;
    planks.count = 0;
    carried.forEach((c, i) => {
      if (c.kind === 'log') {
        const r = LOG_RADIUS[c.bark] * 0.75;
        const mesh = logMesh(c.bark);
        e.set(0, Math.PI / 2 + 0.05 - i * 0.03, -0.05);
        mesh.setMatrixAt(mesh.count++, m.compose(p.set(0.52 + i * 0.26, -0.4 + i * 0.05, -0.2), q.setFromEuler(e), s.set(LOG_LENGTH, r, r)));
        mesh.instanceMatrix.needsUpdate = true;
      } else {
        e.set(0, Math.PI / 2 + 0.1, -0.04);
        planks.setMatrixAt(planks.count++, m.compose(p.set(0.4, -0.45 - i * (PLANK.thick + 0.005), -0.35), q.setFromEuler(e), s.set(PLANK.length, PLANK.thick, PLANK.width)));
        planks.instanceMatrix.needsUpdate = true;
      }
    });
  }

  return {
    // Swings the tool in hand; onHit() is called as it lands.
    swing(onHit) {
      swing = { style: SWINGS[shown] ?? STRIKE, t: 0, onHit, landed: false };
    },

    // Mid-swing: too soon to swing again.
    get busy() { return !!swing && swing.t < 0.85; },

    // The spear drawn back to throw, 0 (at rest) to 1 (as far as it goes).
    draw(level) { drawn = level; },

    // stack: the selected hotbar stack; speed: how fast you're moving (m/s);
    // carried: the logs or planks in your arms ([{ kind, bark }]), which
    // take the place of the tool.
    update(dt, stack, speed, carried = []) {
      showCarried(carried);
      const id = !carried.length && stack && isTool(stack.id) ? stack.id : null;
      if (id !== shown) {
        if (shown) models[shown].visible = false;
        if (id) {
          models[id] ??= hand.add(new THREE.Mesh(toolGeometry(id), material)).children.at(-1);
          models[id].visible = true;
        }
        shown = id;
      }
      const moving = Math.min(1, speed / 4);
      bob += dt * (2 + speed * 1.4);
      arms.position.set(0, Math.sin(bob * 2) * 0.02 * moving, 0);
      const style = swing?.style;
      if (swing) {
        swing.t = Math.min(1, swing.t + dt / style.duration);
        if (!swing.landed && swing.t >= style.hit) {
          swing.landed = true;
          swing.onHit?.();
        }
      }
      const u = swing?.t ?? 0;
      if (u >= 1) swing = null;
      if (!id) return;
      // At rest: low on the right, bobbing as you walk.
      const grip = GRIP[id];
      hand.scale.setScalar(grip.scale);
      const sway = Math.sin(bob * 2) * 0.012 * moving;
      if (id === 'spear') {
        // Pointing ahead, a little in towards the crosshair; drawn back, it
        // rises over your shoulder, its point lifting.
        rest.pos.set(0.3 + drawn * 0.06, grip.y + drawn * 0.22 + sway, grip.z + drawn * 0.3);
        rest.quat.setFromEuler(spearTurn.set(-Math.PI / 2 + 0.1 + drawn * 0.14, 0.12 - drawn * 0.06, 0));
      } else {
        rest.pos.set(0.34, grip.y + sway, grip.z);
        rest.quat.setFromEuler(euler.set(-0.45, 0.35, 0.45 + Math.sin(bob) * 0.02 * moving));
      }
      if (style === CHOP && u < 1) chop(u);
      else if (style === THRUST && u < 1) thrust(u);
      else if (style && u < 1) strike(u);
      else set(rest);
    },
  };
}
