import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// The atlas needs a canvas; the skinned Alpha only needs its material shell here.
vi.mock('../src/visuals/zombieTextures', () => ({
  getZombieAtlas: () => ({ map: new THREE.Texture(), normalMap: new THREE.Texture() }),
}));

import { createAlphaCharacter } from '../src/graphics/characters/CharacterFactory';
import { HUMANOID_BONES } from '../src/graphics/characters/characterTypes';
import { alphaProfile } from '../src/visuals/zombieProfiles';
import { BODY_SHAPES, poseToBoneMatrices } from '../src/graphics/characters/humanoidRig';
import { createPose } from '../src/visuals/zombieRig';

describe('createAlphaCharacter (VP2-T009b)', () => {
  const alpha = createAlphaCharacter(alphaProfile().look);
  const ident = new THREE.Matrix4();

  it('is a 21-bone SkinnedMesh within the Alpha triangle budget', () => {
    expect(alpha.skeleton.bones.length).toBe(HUMANOID_BONES.length);
    expect(alpha.mesh.isSkinnedMesh).toBe(true);
    const tris = alpha.mesh.geometry.index!.count / 3;
    expect(tris).toBeLessThanOrEqual(7000);
    expect(alpha.helper.visible).toBe(false);
    expect(alpha.root.userData.skeletonHelper).toBe(alpha.helper);
    expect(alpha.root.userData.noVisionHaze).toBe(true);
    for (const slot of ['hat', 'glasses', 'back', 'hand'] as const) expect(alpha.slots[slot].parent).toBeTruthy();
  });

  it('writes the procedural pose into the real bones', () => {
    const pose = createPose();
    pose.armLPitch = -1.2;
    alpha.setPose(pose, ident);
    const before = alpha.skeleton.bones[HUMANOID_BONES.indexOf('upperArmL')].quaternion.clone();
    pose.armLPitch = 0;
    alpha.setPose(pose, ident);
    expect(alpha.skeleton.bones[HUMANOID_BONES.indexOf('upperArmL')].quaternion.angleTo(before)).toBeGreaterThan(0.5);
  });

  it('real bone world matrices equal the shared FK (same skin as the horde)', () => {
    const pose = createPose();
    Object.assign(pose, { armRPitch: -0.9, elbowR: 0.7, spineYaw: 0.3, thighLPitch: 0.5, kneeL: 0.6, neckPitch: 0.2, rootRoll: 0.05 });
    alpha.setPose(pose, ident);
    alpha.root.updateMatrixWorld(true);
    const mats = new Float32Array(21 * 16);
    poseToBoneMatrices(pose, BODY_SHAPES.alpha, ident.elements, mats);
    for (let i = 0; i < 21; i++) {
      const m = new THREE.Matrix4().fromArray(mats, i * 16);
      for (let e = 0; e < 16; e++) expect(alpha.skeleton.bones[i].matrixWorld.elements[e]).toBeCloseTo(m.elements[e], 4);
    }
  });

  it('celebrate layers a clip over the pose by action weight and fades out', () => {
    const pose = createPose();
    alpha.setPose(pose, ident);
    const arm = alpha.skeleton.bones[HUMANOID_BONES.indexOf('upperArmR')];
    const hips = alpha.skeleton.bones[HUMANOID_BONES.indexOf('hips')];
    const rest = arm.quaternion.clone(), restY = hips.position.y;
    alpha.play('celebrate');
    let maxAngle = 0, maxHop = 0;
    for (let i = 0; i < 60; i++) {
      alpha.update(1 / 60);
      alpha.setPose(pose, ident);
      maxAngle = Math.max(maxAngle, arm.quaternion.angleTo(rest));
      maxHop = Math.max(maxHop, Math.abs(hips.position.y - restY));
    }
    expect(alpha.isClipActive()).toBe(true);
    expect(maxAngle).toBeGreaterThan(0.5);
    expect(maxHop).toBeGreaterThan(0.005);
    alpha.stop();
    for (let i = 0; i < 30; i++) alpha.update(1 / 60);
    alpha.setPose(pose, ident);
    expect(arm.quaternion.angleTo(rest)).toBeLessThan(1e-3);
    expect(alpha.isClipActive()).toBe(false);
  });

  it('disposes cleanly', () => {
    expect(() => alpha.dispose()).not.toThrow();
  });
});
