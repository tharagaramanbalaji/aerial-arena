import * as THREE from 'three';
import { TransformSnapshot } from '@aerial-arena/shared';

/**
 * Car Cam ball indicator (as in RL): a neon chevron orbiting the car at wheel height,
 * pointing toward the ball horizontally. Fades out when the ball is close or Car Cam is off.
 */
export class BallIndicator {
  readonly root = new THREE.Group();
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly arrow: THREE.Mesh;
  private opacity = 0;
  private time = 0;

  constructor() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.34); // tip (points along +Y in shape space)
    shape.lineTo(0.3, -0.06);
    shape.lineTo(0.17, -0.06);
    shape.lineTo(0, 0.17);
    shape.lineTo(-0.17, -0.06);
    shape.lineTo(-0.3, -0.06);
    shape.closePath();
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2); // lie flat; tip now points along -Z
    geom.rotateY(Math.PI); // tip along +Z so yaw = atan2(dx, dz)
    this.mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.55, 0.12).multiplyScalar(2.2),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.arrow = new THREE.Mesh(geom, this.mat);
    this.arrow.renderOrder = 10;
    this.root.add(this.arrow);
    this.root.visible = false;
  }

  update(car: TransformSnapshot | null, ball: TransformSnapshot | null, enabled: boolean, dt: number): void {
    this.time += dt;
    let target = 0;
    if (enabled && car && ball) {
      const dx = ball.x - car.x;
      const dz = ball.z - car.z;
      const dist = Math.hypot(dx, dz);
      target = THREE.MathUtils.smoothstep(dist, 3, 8); // hide when the ball is right there
      const yaw = Math.atan2(dx, dz);
      const r = 1.55;
      this.arrow.position.set(car.x + Math.sin(yaw) * r, car.y - 0.12, car.z + Math.cos(yaw) * r);
      this.arrow.rotation.set(0, yaw, 0);
    }
    this.opacity += (target - this.opacity) * Math.min(1, dt * (target > this.opacity ? 8 : 16));
    this.mat.opacity = this.opacity * (0.75 + 0.25 * Math.sin(this.time * 5));
    this.root.visible = this.opacity > 0.01;
  }

  destroy(): void {
    this.arrow.geometry.dispose();
    this.mat.dispose();
  }
}
