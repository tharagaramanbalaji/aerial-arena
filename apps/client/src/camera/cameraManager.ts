import * as THREE from 'three';
import { TransformSnapshot, quatRotateVector } from '@aerial-arena/shared';

export type CameraMode = 'ball_cam' | 'car_cam';

export class CameraManager {
  public mode: CameraMode = 'ball_cam';
  public camera: THREE.PerspectiveCamera;

  private currentPos = new THREE.Vector3(0, 5, -45);
  private currentLookAt = new THREE.Vector3(0, 2, 0);

  // Settings
  public distance = 8.8;
  public height = 3.2;
  public fov = 85;

  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.2, 500);
    this.camera.position.copy(this.currentPos);
  }

  public toggleMode(): CameraMode {
    this.mode = this.mode === 'ball_cam' ? 'car_cam' : 'ball_cam';
    return this.mode;
  }

  public setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public update(
    carTransform: TransformSnapshot,
    ballTransform: TransformSnapshot,
    dt: number
  ): void {
    const carPos = new THREE.Vector3(carTransform.x, carTransform.y, carTransform.z);
    const ballPos = new THREE.Vector3(ballTransform.x, ballTransform.y, ballTransform.z);

    // Car forward and up in world
    const fwdLocal = quatRotateVector(
      { x: carTransform.qx, y: carTransform.qy, z: carTransform.qz, w: carTransform.qw },
      { x: 0, y: 0, z: 1 }
    );
    const carFwd = new THREE.Vector3(fwdLocal.x, fwdLocal.y, fwdLocal.z);

    let targetPos = new THREE.Vector3();
    let targetLookAt = new THREE.Vector3();

    if (this.mode === 'car_cam') {
      // CAR CAM: Behind the car along car's horizontal heading
      // Stable horizon: project heading onto XZ plane
      let heading = new THREE.Vector3(carFwd.x, 0, carFwd.z);
      if (heading.lengthSq() < 0.01) {
        heading.set(0, 0, 1);
      } else {
        heading.normalize();
      }

      targetPos.copy(carPos)
        .sub(heading.clone().multiplyScalar(this.distance))
        .add(new THREE.Vector3(0, this.height, 0));

      targetLookAt.copy(carPos)
        .add(heading.clone().multiplyScalar(10.0))
        .add(new THREE.Vector3(0, 1.2, 0));
    } else {
      // BALL CAM: Vector from ball to car defines camera position behind car
      const ballToCar = new THREE.Vector3().subVectors(carPos, ballPos);
      let dir = new THREE.Vector3(ballToCar.x, 0, ballToCar.z);

      if (dir.lengthSq() < 0.05) {
        dir.copy(carFwd).negate();
      } else {
        dir.normalize();
      }

      // Position camera behind the car looking toward the ball
      targetPos.copy(carPos)
        .add(dir.clone().multiplyScalar(this.distance))
        .add(new THREE.Vector3(0, this.height, 0));

      // Keep target slightly above ball and car
      targetLookAt.copy(ballPos).add(new THREE.Vector3(0, 0.8, 0));
    }

    // Clamp camera within arena boundaries (X: ±33, Y: 0.8 to 21, Z: ±49)
    targetPos.x = THREE.MathUtils.clamp(targetPos.x, -32.5, 32.5);
    targetPos.y = THREE.MathUtils.clamp(targetPos.y, 0.8, 20.5);
    targetPos.z = THREE.MathUtils.clamp(targetPos.z, -48.5, 48.5);

    // Smooth position and target damping
    const lerpSpeed = Math.min(1.0, 14.0 * dt);
    this.currentPos.lerp(targetPos, lerpSpeed);
    this.currentLookAt.lerp(targetLookAt, Math.min(1.0, 18.0 * dt));

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}
