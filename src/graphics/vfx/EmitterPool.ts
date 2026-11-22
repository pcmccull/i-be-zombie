import * as THREE from 'three';
import { canSpawn, EMITTERS, PARTICLE_CAPACITY, VfxTile, withinVision } from './vfxRules';
import type { VfxName, VfxPayload } from './vfxRules';

const vertexShader = `
  attribute vec3 aCenter;
  attribute float aTile;
  attribute vec3 aColour;
  attribute float aOpacity;
  attribute float aSize;
  attribute float aRotation;
  uniform vec3 cameraRight;
  uniform vec3 cameraUp;
  varying vec2 spriteUv;
  varying vec3 tint;
  varying float opacity;
  varying float groundHeight;
  void main() {
    float c = cos(aRotation), s = sin(aRotation);
    vec2 corner = mat2(c, s, -s, c) * position.xy * aSize;
    vec3 world = aCenter + cameraRight * corner.x + cameraUp * corner.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    spriteUv = (vec2(mod(aTile, 4.0), floor(aTile / 4.0)) + uv * 0.94 + 0.03) * 0.25;
    tint = aColour; opacity = aOpacity; groundHeight = world.y;
  }
`;
const fragmentShader = `
  uniform sampler2D atlas;
  uniform bool hasAtlas;
  varying vec2 spriteUv;
  varying vec3 tint;
  varying float opacity;
  varying float groundHeight;
  void main() {
    vec4 sprite = vec4(1.0);
    if (hasAtlas) sprite = texture2D(atlas, spriteUv);
    float a = sprite.a * opacity * smoothstep(0.0, 0.15, groundHeight);
    if (a < 0.003) discard;
    gl_FragColor = vec4(sprite.rgb * tint, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** One atlas shared by both blend meshes; no runtime assets or downloads. */
function buildAtlas(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (let tile = 0; tile <= VfxTile.Glint; tile++) {
    ctx.save();
    ctx.translate((tile % 4) * 64 + 32, (3 - Math.floor(tile / 4)) * 64 + 32);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tile === VfxTile.Dot || tile === VfxTile.Smoke) {
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 29);
      g.addColorStop(0, '#fff'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      if (tile === VfxTile.Smoke) {
        for (let j = 0; j <= 40; j++) {
          const a = j / 40 * Math.PI * 2, r = 24 + Math.sin(a * 5) * 4;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else ctx.arc(0, 0, 29, 0, Math.PI * 2);
      ctx.fill();
    } else if (tile === VfxTile.Star || tile === VfxTile.Glint) {
      const points = tile === VfxTile.Star ? 5 : 4;
      ctx.beginPath();
      for (let j = 0; j < points * 2; j++) {
        const a = j * Math.PI / points - Math.PI / 2, r = j % 2 ? 8 : 27;
        if (j === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    } else if (tile === VfxTile.Wisp) {
      ctx.beginPath();
      for (let j = 0; j < 65; j++) {
        const a = j * 0.12, r = 2 + j * 0.36;
        if (j === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
    } else if (tile === VfxTile.Shard) {
      ctx.beginPath(); ctx.moveTo(-21, -15); ctx.lineTo(11, -22); ctx.lineTo(25, 7); ctx.lineTo(-4, 20); ctx.closePath(); ctx.fill();
    } else if (tile === VfxTile.Streak) {
      const g = ctx.createLinearGradient(-29, 0, 29, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 29, 4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (tile === VfxTile.ArrowUp) {
      ctx.beginPath(); ctx.moveTo(-19, -2); ctx.lineTo(0, -24); ctx.lineTo(19, -2); ctx.lineTo(7, -2);
      ctx.lineTo(7, 24); ctx.lineTo(-7, 24); ctx.lineTo(-7, -2); ctx.closePath(); ctx.fill();
    } else if (tile === VfxTile.Leaf) {
      ctx.beginPath(); ctx.moveTo(-22, 22); ctx.quadraticCurveTo(-28, -23, 23, -24);
      ctx.quadraticCurveTo(26, 22, -22, 22); ctx.fill();
    } else if (tile === VfxTile.Ring) {
      ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 2;
  texture.name = 'VFX procedural 4x4 atlas';
  return texture;
}

class Batch {
  readonly geometry = new THREE.PlaneGeometry(1, 1);
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.InstancedMesh;
  readonly center = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
  readonly tile = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
  readonly colour = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
  readonly opacity = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
  readonly size = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
  readonly rotation = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
  readonly attributes: THREE.InstancedBufferAttribute[];
  count = 0;
  constructor(scene: THREE.Scene, atlas: THREE.Texture | null, additive: boolean) {
    this.attributes = [this.center, this.tile, this.colour, this.opacity, this.size, this.rotation];
    const names = ['aCenter', 'aTile', 'aColour', 'aOpacity', 'aSize', 'aRotation'];
    for (let i = 0; i < names.length; i++) this.geometry.setAttribute(names[i], this.attributes[i]);
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms: { atlas: { value: atlas }, hasAtlas: { value: !!atlas },
        cameraRight: { value: new THREE.Vector3(1, 0, 0) }, cameraUp: { value: new THREE.Vector3(0, 1, 0) } },
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.material.userData.noVisionHaze = true;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, PARTICLE_CAPACITY);
    this.mesh.name = additive ? 'VFX additive' : 'VFX alpha';
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.userData.noVisionHaze = true;
    this.mesh.renderOrder = additive ? 12 : 11;
    scene.add(this.mesh);
  }
  upload(camera: THREE.Camera): void {
    this.mesh.count = this.count;
    this.material.uniforms.cameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.material.uniforms.cameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    for (const a of this.attributes) {
      a.clearUpdateRanges();
      if (this.count > 0) { a.addUpdateRange(0, this.count * a.itemSize); a.needsUpdate = true; }
    }
  }
  dispose(): void {
    this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose();
  }
}

/** Dense SoA storage, shared 1280 particle ceiling across the two render batches. */
export class EmitterPool {
  private readonly atlas = buildAtlas();
  private readonly batches: readonly [Batch, Batch];
  private readonly data = Array.from({ length: 29 }, () => new Float32Array(PARTICLE_CAPACITY));
  // Every field participates in swap-remove. Render streams are separate compact arrays per blend mode.
  private readonly x = this.data[0]; private readonly y = this.data[1]; private readonly z = this.data[2];
  private readonly vx = this.data[3]; private readonly vy = this.data[4]; private readonly vz = this.data[5];
  private readonly age = this.data[6]; private readonly life = this.data[7]; private readonly gravity = this.data[8];
  private readonly drag = this.data[9]; private readonly startSize = this.data[10]; private readonly endSize = this.data[11];
  private readonly opacity = this.data[12]; private readonly rotation = this.data[13]; private readonly spin = this.data[14];
  private readonly tile = this.data[15]; private readonly blend = this.data[16]; private readonly bounce = this.data[17];
  private readonly red = this.data[18]; private readonly green = this.data[19]; private readonly blue = this.data[20];
  private readonly curve = this.data[21]; private readonly originX = this.data[22]; private readonly originZ = this.data[23];
  private readonly spiral = this.data[24]; private readonly ambient = this.data[25];
  private readonly endRed = this.data[26]; private readonly endGreen = this.data[27]; private readonly endBlue = this.data[28];
  private readonly color = new THREE.Color();
  private seed = 0x6b29a3d1;
  private live = 0;
  private cap = PARTICLE_CAPACITY;
  private disposed = false;

  constructor(scene: THREE.Scene) { this.batches = [new Batch(scene, this.atlas, false), new Batch(scene, this.atlas, true)]; }
  private random(): number {
    let n = this.seed; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; this.seed = n;
    return (n >>> 0) / 4294967296;
  }
  setCap(max: number): void {
    this.cap = Math.max(0, Math.min(PARTICLE_CAPACITY, Math.floor(max)));
    this.live = Math.min(this.live, this.cap);
    // Clear stale GPU instances immediately, including when quality is changed while paused.
    for (const b of this.batches) b.mesh.count = b.count = 0;
  }
  spawn(name: VfxName, p: VfxPayload, count: number, reduced: boolean, flash: number, leaderX: number, leaderZ: number, hiddenBeyond: number): void {
    if (this.disposed || !withinVision(p.x, p.z, leaderX, leaderZ, hiddenBeyond) || !canSpawn(this.live, count, this.cap)) return;
    const c = EMITTERS[name];
    const direction = Math.atan2(p.dirX ?? 0, p.dirZ ?? 1);
    for (let k = 0; k < count; k++) {
      const tile = name === 'ambient.mote' ? c.tiles[Math.floor(this.random() * c.tiles.length)] :
        name === 'zombie.footstep' && p.surface === 'grass' ? VfxTile.Leaf : c.tiles[k % c.tiles.length];
      // Reduced motion omits the white flash itself; colored stars retain scaled feedback.
      if (c.flash && tile === VfxTile.Dot && reduced) continue;
      const i = this.live++;
      const angle = this.random() * Math.PI * 2;
      const spread = c.motion === 'ring' ? p.radius ?? c.spread :
        name === 'human.dazed' ? (p.radius ?? c.spread) * (0.8 + this.random() * 0.2) : c.spread * this.random();
      const arc = c.motion === 'arc';
      const theta = arc ? direction - 0.9 + k / Math.max(1, count - 1) * 1.8 : angle;
      const speed = c.speed * (0.4 + this.random() * 0.6) * (reduced ? 0.6 : 1);
      this.x[i] = p.x + Math.sin(theta) * (arc ? 1.2 : spread);
      this.z[i] = p.z + Math.cos(theta) * (arc ? 1.2 : spread);
      this.y[i] = p.y ?? (name === 'zombie.footstep' ? 0.16 : 0.7);
      this.vx[i] = Math.sin(theta) * speed;
      this.vz[i] = Math.cos(theta) * speed;
      this.vy[i] = speed * (0.4 + this.random() * 0.7);
      if (c.motion === 'trail') {
        this.vx[i] = -Math.sin(direction) * speed; this.vz[i] = -Math.cos(direction) * speed;
        this.vy[i] *= 0.25;
      } else if (c.motion === 'ring' || c.motion === 'spiral') {
        this.vx[i] *= 0.2; this.vz[i] *= 0.2;
      } else if (c.motion === 'drift') {
        this.vy[i] = Math.sin(angle) * 0.08;
      }
      this.age[i] = 0;
      this.life[i] = c.lifetime[0] + this.random() * (c.lifetime[1] - c.lifetime[0]);
      if (tile === VfxTile.Streak && reduced) this.life[i] *= 0.65;
      const explosion = name === 'vehicle.explosion';
      if (c.flash && tile === VfxTile.Dot) this.life[i] = 0.12;
      if (explosion && tile === VfxTile.Glint) this.life[i] = 0.5 + this.random() * 0.7;
      this.gravity[i] = tile === VfxTile.Glint ? 3.5 : c.gravity;
      this.drag[i] = c.drag;
      const smoke = tile === VfxTile.Smoke && (explosion || name === 'barricade.destroyed');
      const sizeScale = smoke ? 2 : explosion && tile === VfxTile.Glint ? 0.12 : 1;
      this.startSize[i] = c.size[0] * sizeScale;
      this.endSize[i] = c.size[1] * sizeScale;
      if (name === 'ambient.mote' && tile === VfxTile.Smoke) { this.startSize[i] = 0.65; this.endSize[i] = 1.1; }
      if (name === 'zombie.footstep' && tile === VfxTile.Leaf) { this.startSize[i] = 0.09; this.endSize[i] = 0.035; }
      if (tile === VfxTile.Streak && reduced) { this.startSize[i] *= 0.65; this.endSize[i] *= 0.65; }
      this.opacity[i] = c.opacity * (c.flash && tile !== VfxTile.Smoke && tile !== VfxTile.Shard ? flash : 1);
      if (name === 'ambient.mote' && tile === VfxTile.Smoke) this.opacity[i] *= 0.45;
      this.rotation[i] = tile === VfxTile.ArrowUp ? 0 : angle;
      this.spin[i] = c.spin * (this.random() - 0.5) * (reduced ? 0.4 : 1);
      this.tile[i] = tile;
      this.blend[i] = c.blend === 'additive' || (c.blend === 'mixed' && tile !== VfxTile.Smoke && tile !== VfxTile.Shard) ? 1 : 0;
      this.bounce[i] = tile === VfxTile.Shard ? c.bounce : 0;
      let color = p.color ?? c.colors[k % c.colors.length];
      if (name === 'combat.hit' && tile === VfxTile.Dot) color = 0xfff8e8;
      if (name === 'horde.charge') color = tile === VfxTile.Streak ? 0xffffff : 0xc9b99a;
      if (name === 'bullet.impact' && tile === VfxTile.Glint) color = 0xffd68e;
      if (explosion) color = tile === VfxTile.Smoke ? 0x716b60 : tile === VfxTile.Dot ? 0xffe7b5 : 0xffb347;
      if (p.surface && tile === VfxTile.Shard) color = p.surface === 'wood' ? 0x9a7852 : p.surface === 'metal' ? 0x9da7af : 0xc9b99a;
      // Car effects own their shard colours (paint chips, glass, grit), not the ground's.
      if (name === 'vehicle.claw') color = tile === VfxTile.Shard ? p.color ?? 0xc9b99a : tile === VfxTile.Glint ? 0xffc46b : 0xfff3d5;
      else if (name === 'vehicle.glass') color = c.colors[k % c.colors.length];
      else if (name === 'vehicle.impact') color = tile === VfxTile.Dot ? 0xfff8e8 : tile === VfxTile.Shard ? 0x6b6f75 : p.color ?? c.colors[0];
      this.color.setHex(color);
      this.red[i] = this.color.r; this.green[i] = this.color.g; this.blue[i] = this.color.b;
      this.endRed[i] = this.color.r * 0.8; this.endGreen[i] = this.color.g * 0.9; this.endBlue[i] = this.color.b;
      this.curve[i] = c.opacityCurve === 'pop' ? 1 : c.opacityCurve === 'soft' ? 2 : 0;
      this.originX[i] = p.x; this.originZ[i] = p.z;
      this.spiral[i] = c.motion === 'spiral' ? 2.8 : 0;
      this.ambient[i] = name === 'ambient.mote' ? 1 : 0;
    }
  }
  private remove(i: number): void { const last = --this.live; for (const a of this.data) a[i] = a[last]; }
  trimAmbient(max: number, focusX: number, focusZ: number, radius: number): number {
    let count = 0;
    for (let i = 0; i < this.live;) {
      if (this.ambient[i]) {
        if (count >= max || (this.x[i] - focusX) ** 2 + (this.z[i] - focusZ) ** 2 > radius ** 2) { this.remove(i); continue; }
        count++;
      }
      i++;
    }
    return count;
  }
  update(dt: number, camera: THREE.Camera, leaderX: number, leaderZ: number, hiddenBeyond: number): void {
    if (this.disposed) return;
    for (const b of this.batches) b.count = 0;
    for (let i = 0; i < this.live;) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i] || !withinVision(this.originX[i], this.originZ[i], leaderX, leaderZ, hiddenBeyond) ||
        !withinVision(this.x[i], this.z[i], leaderX, leaderZ, hiddenBeyond)) { this.remove(i); continue; }
      const damping = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= damping; this.vz[i] *= damping;
      this.vy[i] = this.vy[i] * damping - this.gravity[i] * dt;
      const swirl = this.spiral[i] * dt, s = Math.sin(swirl), c = Math.cos(swirl);
      const dx = this.x[i] - this.originX[i], dz = this.z[i] - this.originZ[i];
      this.x[i] = this.originX[i] + dx * c - dz * s + this.vx[i] * dt;
      this.z[i] = this.originZ[i] + dx * s + dz * c + this.vz[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.y[i] < 0.06 && this.bounce[i] > 0) {
        this.y[i] = 0.06; this.vy[i] = Math.abs(this.vy[i]) * this.bounce[i]; this.vx[i] *= 0.7; this.vz[i] *= 0.7;
      }
      this.rotation[i] += this.spin[i] * dt;
      if (!withinVision(this.x[i], this.z[i], leaderX, leaderZ, hiddenBeyond)) { this.remove(i); continue; }
      const u = this.age[i] / this.life[i], remaining = 1 - u;
      const fade = this.curve[i] === 1 ? remaining * remaining : this.curve[i] === 2 ? Math.min(1, u * 8) * remaining : remaining;
      const b = this.batches[this.blend[i]], j = b.count++;
      b.center.setXYZ(j, this.x[i], this.y[i], this.z[i]); b.tile.setX(j, this.tile[i]);
      b.colour.setXYZ(j, this.red[i] + (this.endRed[i] - this.red[i]) * u,
        this.green[i] + (this.endGreen[i] - this.green[i]) * u, this.blue[i] + (this.endBlue[i] - this.blue[i]) * u);
      b.opacity.setX(j, this.opacity[i] * fade);
      b.size.setX(j, this.startSize[i] + (this.endSize[i] - this.startSize[i]) * u); b.rotation.setX(j, this.rotation[i]);
      i++;
    }
    for (const b of this.batches) b.upload(camera);
  }
  reset(): void { this.live = 0; this.seed = 0x6b29a3d1; for (const b of this.batches) b.mesh.count = b.count = 0; }
  dispose(): void {
    if (this.disposed) return;
    this.reset(); this.disposed = true;
    for (const b of this.batches) b.dispose();
    this.atlas?.dispose();
  }
  stats(): { live: number; capacity: number; drawCalls: number } {
    return { live: this.live, capacity: this.cap, drawCalls: this.batches.reduce((n, b) => n + (b.mesh.count > 0 ? 1 : 0), 0) };
  }
}
