// [3D] Display-referred post-processing (docs/8_visual_polish.md §6; ARCHITECTURE §VP-0/VP-3).
//
// Why display-referred: the EW vision haze is mixed in output (sRGB) space after tone mapping and must match the sky
// exactly. A linear EffectComposer chain would tone-map/convert it twice. So the scene renders to the canvas exactly
// as before (MSAA, ACES, sRGB, haze), then this pass copies the framebuffer and draws one fullscreen quad on top:
// colour grade (warm Miami lift, contrast, saturation, vignette) + optional selective bloom fed only by bright,
// *saturated* pixels (emissive VFX, glowing eyes, muzzle flashes) so sunlit white pavement never blooms.
// Grade applies to sky and haze alike, so they still match each other.
import * as THREE from 'three';
import type { GraphicsSettings, QualityProfile } from '../performance/GraphicsQuality';

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 pick(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx > 1e-4 ? (mx - mn) / mx : 0.0;
  return c * smoothstep(0.8, 0.97, mx) * smoothstep(0.3, 0.6, sat);
}
void main() {
  // 4-tap box downsample while extracting (half-res target)
  vec3 c = pick(vUv + uTexel * vec2(-0.5, -0.5)) + pick(vUv + uTexel * vec2(0.5, -0.5))
         + pick(vUv + uTexel * vec2(-0.5, 0.5)) + pick(vUv + uTexel * vec2(0.5, 0.5));
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  c += texture2D(tSrc, vUv + uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tSrc, vUv - uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tSrc, vUv + uDir * 3.230769).rgb * 0.070270;
  c += texture2D(tSrc, vUv - uDir * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uGrade;
uniform float uVignette;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  // warm Miami grade (display space, gentle): lift shadows warm, cool the deepest blacks less, mild S-curve
  vec3 g = c;
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l), g, 1.07);                                   // saturation
  g = (g - 0.5) * 1.045 + 0.5;                                 // contrast
  g += vec3(0.018, 0.010, -0.006) * (1.0 - l);                 // warm lift in the shadows
  g *= vec3(1.012, 1.0, 0.985);                                // warm white balance
  c = mix(c, g, uGrade);
  c += texture2D(tBloom, vUv).rgb * uBloom;
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.35, 0.85, dot(d, d) * 2.0);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export class PostProcessingPipeline {
  private enabled = false;
  private bloomOn = false;
  private gradeOn = false;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly brightMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private sceneTex: THREE.FramebufferTexture | null = null;
  private bloomA: THREE.WebGLRenderTarget | null = null;
  private bloomB: THREE.WebGLRenderTarget | null = null;
  private readonly blackTex: THREE.DataTexture;
  private bufW = 0;
  private bufH = 0;
  private failed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    const common = { vertexShader: FULLSCREEN_VERT, depthTest: false, depthWrite: false, toneMapped: false };
    this.brightMat = new THREE.ShaderMaterial({ ...common, fragmentShader: BRIGHT_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } } });
    this.blurMat = new THREE.ShaderMaterial({ ...common, fragmentShader: BLUR_FRAG,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } } });
    this.blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blackTex.needsUpdate = true;
    this.compositeMat = new THREE.ShaderMaterial({ ...common, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: null }, tBloom: { value: this.blackTex },
        uBloom: { value: 0 }, uGrade: { value: 1 }, uVignette: { value: 0.12 },
      } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  get active(): boolean {
    return this.enabled && !this.failed;
  }

  setQuality(p: QualityProfile, s: GraphicsSettings): void {
    this.enabled = p.postfx && (p.grading || p.bloom);
    this.bloomOn = p.bloom;
    this.gradeOn = p.grading;
    this.compositeMat.uniforms.uGrade.value = this.gradeOn ? 1 : 0;
    // Reduced motion: dimmer glow (fewer flashes), no vignette pumping (static anyway)
    this.compositeMat.uniforms.uBloom.value = this.bloomOn ? (s.reducedMotion ? 0.35 : 0.65) : 0;
    this.compositeMat.uniforms.uVignette.value = this.gradeOn ? 0.12 : 0;
    if (!this.enabled) this.releaseTargets();
  }

  /** CSS size + DPR (drawing buffer = size × dpr). */
  setSize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (w === this.bufW && h === this.bufH) return;
    this.bufW = w;
    this.bufH = h;
    this.releaseTargets();
  }

  private ensureTargets(): void {
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (buf.x !== this.bufW || buf.y !== this.bufH) {
      this.bufW = buf.x;
      this.bufH = buf.y;
      this.releaseTargets();
    }
    if (!this.sceneTex) {
      this.sceneTex = new THREE.FramebufferTexture(this.bufW, this.bufH);
      this.sceneTex.minFilter = THREE.LinearFilter;
      this.sceneTex.magFilter = THREE.LinearFilter;
    }
    if (this.bloomOn && !this.bloomA) {
      const bw = Math.max(1, this.bufW >> 2);
      const bh = Math.max(1, this.bufH >> 2);
      const opts = { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType } as const;
      this.bloomA = new THREE.WebGLRenderTarget(bw, bh, opts);
      this.bloomB = new THREE.WebGLRenderTarget(bw, bh, opts);
    }
  }

  private releaseTargets(): void {
    this.sceneTex?.dispose();
    this.sceneTex = null;
    this.bloomA?.dispose();
    this.bloomB?.dispose();
    this.bloomA = this.bloomB = null;
  }

  private drawQuad(mat: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /** Renders the frame. With post off (or after a GPU failure) it is exactly `renderer.render(scene, camera)`. */
  render(): void {
    this.renderer.render(this.scene, this.camera);
    if (!this.active) return;
    try {
      this.ensureTargets();
      const r = this.renderer;
      r.copyFramebufferToTexture(this.sceneTex!);
      const prevAutoClear = r.autoClear;
      const prevToneMapping = r.toneMapping;
      r.autoClear = false;
      r.toneMapping = THREE.NoToneMapping;
      let bloomTex: THREE.Texture = this.blackTex;
      if (this.bloomOn && this.bloomA && this.bloomB) {
        this.brightMat.uniforms.tSrc.value = this.sceneTex;
        (this.brightMat.uniforms.uTexel.value as THREE.Vector2).set(1 / this.bloomA.width, 1 / this.bloomA.height);
        this.drawQuad(this.brightMat, this.bloomA);
        const dir = this.blurMat.uniforms.uDir.value as THREE.Vector2;
        for (let pass = 0; pass < 2; pass++) {
          this.blurMat.uniforms.tSrc.value = this.bloomA.texture;
          dir.set(1 / this.bloomA.width, 0);
          this.drawQuad(this.blurMat, this.bloomB);
          this.blurMat.uniforms.tSrc.value = this.bloomB.texture;
          dir.set(0, 1 / this.bloomA.height);
          this.drawQuad(this.blurMat, this.bloomA);
        }
        bloomTex = this.bloomA.texture;
      }
      this.compositeMat.uniforms.tScene.value = this.sceneTex;
      this.compositeMat.uniforms.tBloom.value = bloomTex;
      this.drawQuad(this.compositeMat, null);
      r.autoClear = prevAutoClear;
      r.toneMapping = prevToneMapping;
    } catch (err) {
      // Never block the game on post: fall back to the plain render from now on.
      this.failed = true;
      this.releaseTargets();
      console.warn('[postfx] disabled after error', err);
    }
  }

  dispose(): void {
    this.releaseTargets();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
    this.quad.geometry.dispose();
    this.blackTex.dispose();
  }
}
