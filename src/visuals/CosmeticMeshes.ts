// [3D] Procedural low-poly meshes for Alpha cosmetic slots (hat, glasses, back, hand).
// Spec: docs/11_cityupgrade.md §4.1.A.
import * as THREE from 'three';

function flatMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.72, metalness: 0.05 });
}

export function buildCosmeticMesh(rewardId: string): THREE.Group | null {
  const g = new THREE.Group();
  g.userData.noVisionHaze = true;

  switch (rewardId) {
    case 'cos_traffic_cone': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.36), flatMat(0xff6b2b));
      base.position.y = 0.04;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 6), flatMat(0xff6b2b));
      cone.position.y = 0.22;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.08, 6), flatMat(0xf4f4f0));
      stripe.position.y = 0.2;
      g.add(base, cone, stripe);
      return g;
    }
    case 'cos_chef_hat': {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8), flatMat(0xf4f0e6));
      band.position.y = 0.08;
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), flatMat(0xfaf8f2));
      puff.position.y = 0.22;
      g.add(band, puff);
      return g;
    }
    case 'cos_beach_visor': {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 8), flatMat(0x2ec4b6));
      band.position.y = 0.06;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.2), flatMat(0xffd166));
      brim.position.set(0, 0.05, 0.14);
      brim.rotation.x = 0.2;
      g.add(band, brim);
      return g;
    }
    case 'cos_oversized_shades': {
      const frameMat = flatMat(0x1b2124);
      const lensMat = flatMat(0x222831);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.04), lensMat);
      l.position.set(-0.09, 0.02, 0.02);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.04), lensMat);
      r.position.set(0.09, 0.02, 0.02);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), frameMat);
      bridge.position.set(0, 0.03, 0.02);
      g.add(l, r, bridge);
      return g;
    }
    case 'cos_neon_shades': {
      const neonMat = flatMat(0xff3e8a);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.04), neonMat);
      bar.position.set(0, 0.02, 0.02);
      g.add(bar);
      return g;
    }
    case 'cos_flamingo_float': {
      const pink = flatMat(0xff5e99);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.07, 6, 10), pink);
      ring.rotation.x = Math.PI / 2;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.28, 6), pink);
      neck.position.set(0, 0.15, 0.2);
      neck.rotation.x = -0.35;
      const beak = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.09), flatMat(0x222222));
      beak.position.set(0, 0.28, 0.28);
      g.add(ring, neck, beak);
      return g;
    }
    case 'cos_boombox': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.16), flatMat(0x2d3240));
      const spkL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8), flatMat(0xf2c14e));
      spkL.rotation.x = Math.PI / 2;
      spkL.position.set(-0.12, 0, -0.09);
      const spkR = spkL.clone();
      spkR.position.x = 0.12;
      g.add(body, spkL, spkR);
      return g;
    }
    case 'cos_selfie_stick': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.65, 6), flatMat(0xb8c2cc));
      pole.position.set(0, 0.24, 0.16);
      pole.rotation.x = 0.7;
      const phone = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.18, 0.025), flatMat(0x181c24));
      phone.position.set(0, 0.48, 0.36);
      phone.rotation.x = -0.35;
      g.add(pole, phone);
      return g;
    }
    default:
      return null;
  }
}
