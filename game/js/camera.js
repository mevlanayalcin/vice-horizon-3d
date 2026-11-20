// camera.js — the third-person camera rig. A chase camera that stretches and widens
// with speed, shakes on landings and drifts and lets the mouse orbit; an over-the-
// shoulder on-foot camera that tightens when aiming and stays out of walls; and the
// slow orbit over the bay behind the title screen.

import { clamp, lerp } from './config.js';

export function createCameraRig(world) {
  const camera = {
    pos: [80, 26, 430],
    target: [0, 8, 150],
    fov: 58,
    up: [0, 1, 0],
    right: [1, 0, 0],
    forward: [0, 0, -1],
  };
  const rig = { camera, yaw: Math.PI, pitch: 0.18, offsetYaw: 0, shake: 0 };

  function forwardOf(yaw) {
    return [Math.sin(yaw), Math.cos(yaw)];
  }

  /** Chase camera behind a car. */
  function followCar(car, dt, elapsed) {
    rig.offsetYaw = lerp(rig.offsetYaw, 0, clamp(dt * 1.4, 0, 1));
    const baseYaw = car.heading + rig.offsetYaw;
    const speedRatio = clamp(Math.abs(car.speed) / car.spec.maxSpeed, 0, 1);
    const dist = 7.0 + speedRatio * 2.2;
    const height = 3.2 + Math.sin(rig.pitch * 2.2) * 2.4;
    const desired = [car.x - Math.sin(baseYaw) * dist, car.y + height, car.z - Math.cos(baseYaw) * dist];
    const lead = 3.4 + speedRatio * 4;
    const target = [car.x + Math.sin(car.heading) * lead, car.y + 1.25, car.z + Math.cos(car.heading) * lead];
    const smooth = clamp(dt * (7 + speedRatio * 4), 0, 1);
    const aim = clamp(dt * 9, 0, 1);
    for (let i = 0; i < 3; i += 1) {
      camera.pos[i] = lerp(camera.pos[i], desired[i], smooth);
      camera.target[i] = lerp(camera.target[i], target[i], aim);
    }
    const shake = speedRatio * 0.035 + (car.airborne ? 0.06 : 0) + (car.drift > 3 ? 0.03 : 0);
    camera.pos[0] += Math.sin(elapsed * 31) * shake;
    camera.pos[1] += Math.cos(elapsed * 27) * shake * 0.6;
    camera.fov = 58 + speedRatio * 13 + (car.boosting ? 4 : 0);
    camera.up = [0, 1, 0];
  }

  /** Over-the-shoulder camera on foot; `aiming` pulls the lens in. */
  function followOnFoot(p, dt, elapsed, aiming) {
    const fwd = forwardOf(rig.yaw);
    const horizontal = Math.cos(rig.pitch);
    const dist = 5.2;
    const desired = [p.x - fwd[0] * dist * horizontal, p.y + 2.2 + Math.sin(rig.pitch) * 4.2, p.z - fwd[1] * dist * horizontal];
    let camX = desired[0], camZ = desired[2];
    if (world.insideBuilding(camX, camZ)) {
      const inner = world.collideCircle(camX, camZ, 0.6);
      if (inner.hit) { camX = inner.x; camZ = inner.z; }
    }
    const smooth = clamp(dt * 9, 0, 1);
    camera.pos[0] = lerp(camera.pos[0], camX, smooth);
    camera.pos[1] = lerp(camera.pos[1], desired[1], smooth);
    camera.pos[2] = lerp(camera.pos[2], camZ, smooth);
    const target = [p.x + fwd[0] * 4, p.y + 1.42, p.z + fwd[1] * 4];
    const aim = clamp(dt * 11, 0, 1);
    for (let i = 0; i < 3; i += 1) camera.target[i] = lerp(camera.target[i], target[i], aim);
    camera.fov = aiming ? 50 : 62;
    const bob = Math.hypot(p.velocityX, p.velocityZ) > 0.4 ? Math.sin(p.walkPhase * 2) * 0.035 : 0;
    camera.pos[1] += bob;
    rig.shake = lerp(rig.shake, 0, dt * 6);
    camera.pos[0] += Math.sin(elapsed * 41) * rig.shake;
    camera.pos[1] += Math.cos(elapsed * 37) * rig.shake * 0.7;
    camera.up = [0, 1, 0];
  }

  /** The slow drift over the bay behind the title menu. */
  /** The title flyover: a slow drift above Sunset Beach, looking down the coast into the sun. */
  function titleOrbit(t) {
    camera.pos[0] = 170 + Math.sin(t * 0.045) * 46;
    camera.pos[1] = 24 + Math.sin(t * 0.09) * 4;
    camera.pos[2] = 296 + Math.cos(t * 0.035) * 14;
    camera.target[0] = -190 + Math.sin(t * 0.03) * 40;
    camera.target[1] = 7;
    camera.target[2] = 412 + Math.cos(t * 0.04) * 18;
    camera.fov = 56;
  }

  return Object.assign(rig, { followCar, followOnFoot, titleOrbit });
}
