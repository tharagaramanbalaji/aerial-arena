import * as THREE from 'three';
import { CAR_CONFIG, Team, TransformSnapshot } from '@aerial-arena/shared';

export interface CarVisual {
  root: THREE.Group;
  update(t: TransformSnapshot, isBoosting: boolean, steerInput: number): void;
  destroy(): void;
}

export function createCarMesh(team: Team): CarVisual {
  const root = new THREE.Group();

  // Team Colors
  const primaryColor = team === 'blue' ? 0x1d4ed8 : 0xd97706; // Blue vs Orange/Amber
  const accentColor = team === 'blue' ? 0x38bdf8 : 0xfb923c;  // Cyan vs Warm Orange
  const glowColor = team === 'blue' ? 0x0284c7 : 0xea580c;

  // Materials
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: primaryColor,
    metalness: 0.75,
    roughness: 0.25,
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    metalness: 0.5,
    roughness: 0.3,
  });

  const darkTrimMaterial = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.7,
  });

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    metalness: 0.1,
    roughness: 0.1,
    transmission: 0.6,
    transparent: true,
    opacity: 0.85,
  });

  const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfef08a }); // Light yellow
  const taillightMaterial = new THREE.MeshBasicMaterial({ color: 0xef4444 }); // Bright red
  const boosterGlowMaterial = new THREE.MeshBasicMaterial({ color: accentColor });

  // 1. Lower Chassis Base (3.4m long, 1.8m wide, 0.45m high)
  const chassisGeom = new THREE.BoxGeometry(1.7, 0.45, 3.4);
  const chassis = new THREE.Mesh(chassisGeom, bodyMaterial);
  chassis.position.y = 0.35;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  root.add(chassis);

  // Front wedge hood
  const hoodGeom = new THREE.BoxGeometry(1.5, 0.25, 1.1);
  const hood = new THREE.Mesh(hoodGeom, bodyMaterial);
  hood.position.set(0, 0.42, 1.1);
  hood.rotation.x = 0.15;
  hood.castShadow = true;
  root.add(hood);

  // 2. Cabin & Windshield (1.4m wide, 0.45m high, 1.6m long)
  const cabinGeom = new THREE.BoxGeometry(1.35, 0.42, 1.5);
  const cabin = new THREE.Mesh(cabinGeom, glassMaterial);
  cabin.position.set(0, 0.75, -0.2);
  cabin.castShadow = true;
  root.add(cabin);

  // Roof plate
  const roofGeom = new THREE.BoxGeometry(1.2, 0.08, 1.2);
  const roof = new THREE.Mesh(roofGeom, accentMaterial);
  roof.position.set(0, 0.98, -0.2);
  roof.castShadow = true;
  root.add(roof);

  // 3. Rear Spoiler
  const spoilerStrutGeom = new THREE.BoxGeometry(0.1, 0.3, 0.1);
  const leftStrut = new THREE.Mesh(spoilerStrutGeom, darkTrimMaterial);
  leftStrut.position.set(-0.55, 0.7, -1.5);
  root.add(leftStrut);
  const rightStrut = new THREE.Mesh(spoilerStrutGeom, darkTrimMaterial);
  rightStrut.position.set(0.55, 0.7, -1.5);
  root.add(rightStrut);

  const wingGeom = new THREE.BoxGeometry(1.6, 0.06, 0.35);
  const wing = new THREE.Mesh(wingGeom, accentMaterial);
  wing.position.set(0, 0.85, -1.5);
  wing.rotation.x = -0.08;
  wing.castShadow = true;
  root.add(wing);

  // 4. Headlights (Front: +Z)
  const lightGeom = new THREE.BoxGeometry(0.25, 0.12, 0.06);
  const leftHeadlight = new THREE.Mesh(lightGeom, headlightMaterial);
  leftHeadlight.position.set(-0.6, 0.38, 1.71);
  root.add(leftHeadlight);

  const rightHeadlight = new THREE.Mesh(lightGeom, headlightMaterial);
  rightHeadlight.position.set(0.6, 0.38, 1.71);
  root.add(rightHeadlight);

  // 5. Taillights (Rear: -Z)
  const tailGeom = new THREE.BoxGeometry(0.3, 0.1, 0.06);
  const leftTail = new THREE.Mesh(tailGeom, taillightMaterial);
  leftTail.position.set(-0.6, 0.45, -1.71);
  root.add(leftTail);

  const rightTail = new THREE.Mesh(tailGeom, taillightMaterial);
  rightTail.position.set(0.6, 0.45, -1.71);
  root.add(rightTail);

  // 6. Dual Booster Nozzles
  const nozzleGeom = new THREE.CylinderGeometry(0.14, 0.18, 0.25, 12);
  const leftNozzle = new THREE.Mesh(nozzleGeom, darkTrimMaterial);
  leftNozzle.rotation.x = Math.PI / 2;
  leftNozzle.position.set(-0.25, 0.38, -1.75);
  root.add(leftNozzle);

  const rightNozzle = new THREE.Mesh(nozzleGeom, darkTrimMaterial);
  rightNozzle.rotation.x = Math.PI / 2;
  rightNozzle.position.set(0.25, 0.38, -1.75);
  root.add(rightNozzle);

  // Booster Plume Meshes (scaled when boosting)
  const plumeGeom = new THREE.ConeGeometry(0.2, 1.2, 12);
  plumeGeom.rotateX(-Math.PI / 2);
  plumeGeom.translate(0, 0, -0.6);

  const leftPlume = new THREE.Mesh(plumeGeom, boosterGlowMaterial);
  leftPlume.position.set(-0.25, 0.38, -1.8);
  leftPlume.visible = false;
  root.add(leftPlume);

  const rightPlume = new THREE.Mesh(plumeGeom, boosterGlowMaterial);
  rightPlume.position.set(0.25, 0.38, -1.8);
  rightPlume.visible = false;
  root.add(rightPlume);

  // 7. Wheels (Front Left, Front Right, Rear Left, Rear Right)
  const wheelGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 16);
  wheelGeom.rotateZ(Math.PI / 2);

  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.8, roughness: 0.2 });

  const createWheel = () => {
    const wheelGroup = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeom, tireMaterial);
    tire.castShadow = true;
    wheelGroup.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.29, 12).rotateZ(Math.PI / 2), rimMaterial);
    wheelGroup.add(rim);
    return wheelGroup;
  };

  const frontLeftWheel = createWheel();
  frontLeftWheel.position.set(-0.95, 0.35, 1.05);
  root.add(frontLeftWheel);

  const frontRightWheel = createWheel();
  frontRightWheel.position.set(0.95, 0.35, 1.05);
  root.add(frontRightWheel);

  const rearLeftWheel = createWheel();
  rearLeftWheel.position.set(-0.95, 0.35, -1.05);
  root.add(rearLeftWheel);

  const rearRightWheel = createWheel();
  rearRightWheel.position.set(0.95, 0.35, -1.05);
  root.add(rearRightWheel);

  const wheels = [frontLeftWheel, frontRightWheel, rearLeftWheel, rearRightWheel];

  let wheelRotation = 0;

  const update = (t: TransformSnapshot, isBoosting: boolean, steerInput: number) => {
    root.position.set(t.x, t.y, t.z);
    root.quaternion.set(t.qx, t.qy, t.qz, t.qw);

    // Wheels spin based on speed
    const speed = Math.hypot(t.vx, t.vz);
    wheelRotation += speed * 0.03;
    for (const w of wheels) {
      w.children[0].rotation.x = wheelRotation;
    }

    // Front wheels steer
    const maxSteerAngle = 0.5;
    const currentSteer = -steerInput * maxSteerAngle;
    frontLeftWheel.rotation.y = currentSteer;
    frontRightWheel.rotation.y = currentSteer;

    // Boost plumes
    leftPlume.visible = isBoosting;
    rightPlume.visible = isBoosting;
    if (isBoosting) {
      const flicker = 0.85 + Math.random() * 0.3;
      leftPlume.scale.set(flicker, flicker, flicker);
      rightPlume.scale.set(flicker, flicker, flicker);
    }
  };

  const destroy = () => {
    // Dispose geometries and materials
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
  };

  return { root, update, destroy };
}
