import * as THREE from 'three';
import { BALL_CONFIG, TransformSnapshot } from '@aerial-arena/shared';

export interface BallVisual {
  root: THREE.Group;
  update(t: TransformSnapshot): void;
  destroy(): void;
}

export function createBallMesh(): BallVisual {
  const root = new THREE.Group();

  // 1. Core Ball Sphere
  const geom = new THREE.IcosahedronGeometry(BALL_CONFIG.radius, 3);

  const ballMaterial = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    metalness: 0.6,
    roughness: 0.3,
  });

  const wireframeGeom = new THREE.IcosahedronGeometry(BALL_CONFIG.radius * 1.002, 1);
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    wireframe: true,
  });

  const ballMesh = new THREE.Mesh(geom, ballMaterial);
  ballMesh.castShadow = true;
  root.add(ballMesh);

  const wireMesh = new THREE.Mesh(wireframeGeom, wireMaterial);
  ballMesh.add(wireMesh);

  // 2. Ground Locator / Shadow Ring
  // Projected on the floor directly beneath the ball so altitude is immediately readable
  const ringGeom = new THREE.RingGeometry(BALL_CONFIG.radius * 0.8, BALL_CONFIG.radius * 1.05, 32);
  ringGeom.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  const groundRing = new THREE.Mesh(ringGeom, ringMaterial);
  groundRing.position.y = 0.05;
  root.add(groundRing);

  const update = (t: TransformSnapshot) => {
    // Ball translation and spin
    ballMesh.position.set(t.x, t.y, t.z);
    ballMesh.quaternion.set(t.qx, t.qy, t.qz, t.qw);

    // Ground locator ring stays directly on floor beneath ball
    groundRing.position.x = t.x;
    groundRing.position.z = t.z;

    // Scale ring and dim opacity based on height
    const height = Math.max(0, t.y - BALL_CONFIG.radius);
    const scale = 1.0 + Math.min(2.0, height * 0.15);
    groundRing.scale.set(scale, 1, scale);
    ringMaterial.opacity = Math.max(0.2, 0.75 - height * 0.025);
  };

  const destroy = () => {
    geom.dispose();
    wireframeGeom.dispose();
    ringGeom.dispose();
    ballMaterial.dispose();
    wireMaterial.dispose();
    ringMaterial.dispose();
  };

  return { root, update, destroy };
}
