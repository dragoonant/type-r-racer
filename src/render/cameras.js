// Camera rig: cockpit, bonnet, bumper and chase views, plus look-around.
import * as THREE from 'three';

export const CAMERA_MODES = ['cockpit', 'chase', 'bonnet', 'bumper'];
export const CAMERA_LABELS = { cockpit: 'Cockpit', chase: 'Chase', bonnet: 'Bonnet', bumper: 'Bumper' };

const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera, model) {
    this.camera = camera; this.model = model;
    this.mode = 'cockpit';
    this.heading = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
    this.head = new THREE.Vector3(); // cockpit head offset from g-forces
    this.look = 0;
    this.fov = 60;
    this.snap = true;
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._t = new THREE.Vector3(); this._m = new THREE.Matrix4();
  }

  next() { this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]; this.snap = true; return this.mode; }
  set(mode) { if (CAMERA_MODES.includes(mode)) { this.mode = mode; this.snap = true; } }

  update(dt, car, input) {
    const cam = this.camera, group = this.model.group, spec = car.spec;
    const q = this._q.set(car.qx, car.qy, car.qz, car.qw);
    const fwd = this._f.set(0, 0, -1).applyQuaternion(q);
    const speed = Math.hypot(car.vx, car.vy, car.vz);
    const ground = -spec.cgHeight, zNose = -(spec.a + spec.frontOverhang);
    this.look += ((input ? input.lookX : 0) - this.look) * Math.min(1, dt * 8);
    const back = input && input.lookBack;
    let targetFov = 60;

    if (this.mode === 'chase') {
      // Follow the direction of travel more than the nose, so slides are visible.
      const want = this._v.set(fwd.x, 0, fwd.z);
      if (speed > 6) { want.x = want.x * 0.55 + (car.vx / speed) * 0.45; want.z = want.z * 0.55 + (car.vz / speed) * 0.45; }
      want.normalize();
      if (this.snap) this.heading.copy(want);
      else this.heading.lerp(want, Math.min(1, dt * 5.5)).normalize();
      const dist = 5.6 + Math.min(speed, 80) * 0.016, height = 1.75;
      const dir = this._t.copy(this.heading);
      if (back) dir.multiplyScalar(-1);
      else if (Math.abs(this.look) > 0.01) dir.applyAxisAngle(UP, -this.look * 1.4);
      const target = this._v.set(car.px - dir.x * dist, car.py + height, car.pz - dir.z * dist);
      if (this.snap) this.pos.copy(target); else this.pos.lerp(target, Math.min(1, dt * 9));
      // Rigid in distance so the car never stretches away, soft in height.
      cam.position.set(target.x, this.pos.y, target.z);
      cam.up.copy(UP);
      cam.lookAt(car.px + dir.x * 2.2, car.py + 0.55, car.pz + dir.z * 2.2);
      targetFov = 58 + Math.min(speed, 80) * 0.16;
      cam.near = 0.3;
    } else {
      let local;
      if (this.mode === 'cockpit') {
        // The head leans a little against acceleration.
        const hx = -car.gLat * 0.012, hz = car.gLong * 0.018, hy = 0;
        this.head.x += (hx - this.head.x) * Math.min(1, dt * 6); this.head.z += (hz - this.head.z) * Math.min(1, dt * 6); this.head.y = hy;
        local = this._v.copy(this.model.eye).add(this.head);
        targetFov = 58 + Math.min(speed, 80) * 0.06;
        cam.near = 0.06;
      } else if (this.mode === 'bonnet') {
        local = this._v.set(0, ground + 1.08, zNose + 1.25);
        targetFov = 62 + Math.min(speed, 80) * 0.08;
        cam.near = 0.15;
      } else {
        local = this._v.set(0, ground + 0.6, zNose - 0.05);
        targetFov = 66 + Math.min(speed, 80) * 0.1;
        cam.near = 0.15;
      }
      if (back) local.set(0, ground + 1.0, zNose + spec.bodyLength + 0.1);
      cam.position.copy(local).applyQuaternion(q).add(this._t.set(car.px, car.py, car.pz));
      cam.quaternion.copy(q);
      // Glance toward where the car is being steered, plus manual look.
      let yaw = back ? Math.PI : -this.look * 1.25;
      if (!back && this.mode === 'cockpit') yaw += -car.steerOut * 0.35;
      if (yaw !== 0) cam.quaternion.multiply(this._q.setFromAxisAngle(UP, yaw));
      if (this.mode === 'cockpit' && !back) cam.quaternion.multiply(this._q.setFromAxisAngle(this._t.set(1, 0, 0), -0.035));
    }
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 3);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; }
    cam.updateProjectionMatrix();
    this.snap = false;
    // Exterior pillar trim would sit right in front of the driver's eyes.
    if (this.model.exteriorOnly) this.model.exteriorOnly.visible = this.mode !== 'cockpit' || !!back;
    group.visible = true;
  }
}
