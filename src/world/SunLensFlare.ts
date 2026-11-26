import * as THREE from 'three';
import { ParkSurface } from '../physics/ParkSurface';

interface FlareElementSpec {
  texture: THREE.CanvasTexture;
  /** Base radius scale relative to min(viewportWidth, viewportHeight). */
  size: number;
  /** Position along the optical axis: 0 = sun, 1 = screen center, 2 = opposite side. */
  axisDist: number;
  color: THREE.Color;
  baseOpacity: number;
  stretchX?: number;
  rotateFactor?: number;
  isStarburst?: boolean;
  isAnamorphic?: boolean;
  isGhost?: boolean;
}

interface FlareElementInstance {
  spec: FlareElementSpec;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
}

const FLARE_VERTEX_SHADER = /* glsl */ `
  uniform vec2 uCenterNdc;
  uniform vec2 uScaleNdc;
  uniform float uRotation;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    float c = cos(uRotation);
    float s = sin(uRotation);
    vec2 rotated = vec2(
      position.x * c - position.y * s,
      position.x * s + position.y * c
    );
    gl_Position = vec4(rotated * uScaleNdc + uCenterNdc, 0.0, 1.0);
  }
`;

const FLARE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = tex.a * uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(tex.rgb * uColor, a);
  }
`;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function createCanvasTexture(
  width: number,
  height: number,
  paintPixel: (nx: number, ny: number, outRgba: [number, number, number, number]) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;
    const rgba: [number, number, number, number] = [0, 0, 0, 0];
    const invHalfW = 2 / width;
    const invHalfH = 2 / height;

    for (let y = 0; y < height; y++) {
      const ny = (y + 0.5) * invHalfH - 1;
      for (let x = 0; x < width; x++) {
        const nx = (x + 0.5) * invHalfW - 1;
        paintPixel(nx, ny, rgba);
        const idx = (y * width + x) * 4;
        data[idx] = Math.round(clamp01(rgba[0]) * 255);
        data[idx + 1] = Math.round(clamp01(rgba[1]) * 255);
        data[idx + 2] = Math.round(clamp01(rgba[2]) * 255);
        data[idx + 3] = Math.round(clamp01(rgba[3]) * 255);
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Crisp 512x512 procedural sun core + golden corona + 8-point aperture starburst spikes.
 */
function buildStarburstTexture(): THREE.CanvasTexture {
  return createCanvasTexture(512, 512, (nx, ny, out) => {
    const r = Math.hypot(nx, ny);
    const edgeFade = 1.0 - smoothstep(0.62, 0.98, r);
    if (edgeFade <= 0.0005) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return;
    }

    const theta = Math.atan2(ny, nx);

    // Warm golden-white solar core & soft exponential corona
    const core = Math.exp(-r * r * 68.0);
    const innerGlow = Math.exp(-r * 7.5) * 0.62;
    const outerCorona = Math.pow(Math.max(0, 1.0 - r), 3.2) * 0.24;

    // 4 primary long spikes (tilted 14 deg) + 4 secondary diagonal spikes (45 deg offset)
    const primaryCos = Math.abs(Math.cos(2.0 * (theta - 0.24)));
    const primarySpike = Math.pow(primaryCos, 44.0) * Math.exp(-r * 2.1) * 0.95;

    const secondaryCos = Math.abs(Math.cos(2.0 * (theta - 0.24 - Math.PI * 0.25)));
    const secondarySpike = Math.pow(secondaryCos, 58.0) * Math.exp(-r * 3.1) * 0.68;

    // Micro-scintillation rays for realistic multi-blade aperture shimmer
    const microRays =
      Math.pow(Math.abs(Math.cos(8.0 * theta + 0.4)), 16.0) * Math.exp(-r * 5.8) * 0.16;

    const intensity = clamp01(
      (core + innerGlow + outerCorona + primarySpike + secondarySpike + microRays) * edgeFade
    );

    // Rich white-gold core transitioning into warm amber/orange outer starburst tips
    const warmBlend = clamp01(r * 1.25);
    out[0] = 1.0;
    out[1] = 0.96 - warmBlend * 0.28;
    out[2] = 0.88 - warmBlend * 0.62;
    out[3] = intensity;
  });
}

/**
 * Smooth radial golden-amber bloom halo (zero visible quad boundaries).
 */
function buildSoftGlowTexture(): THREE.CanvasTexture {
  return createCanvasTexture(256, 256, (nx, ny, out) => {
    const r = Math.hypot(nx, ny);
    const edgeFade = 1.0 - smoothstep(0.55, 0.97, r);
    const glow = (Math.exp(-r * r * 6.0) * 0.72 + Math.pow(Math.max(0, 1.0 - r), 2.4) * 0.28) * edgeFade;
    out[0] = 1.0;
    out[1] = 0.84 - r * 0.16;
    out[2] = 0.56 - r * 0.24;
    out[3] = clamp01(glow);
  });
}

/**
 * Cinematic horizontal anamorphic lens streak: warm gold/amber center with soft cyan & magenta fringe.
 */
function buildAnamorphicTexture(): THREE.CanvasTexture {
  return createCanvasTexture(512, 128, (nx, ny, out) => {
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const horizFade = Math.exp(-Math.pow(ax * 1.55, 1.25)) * (1.0 - smoothstep(0.72, 0.99, ax));
    const vertRazor = Math.exp(-ny * ny * 85.0) * 0.85;
    const vertCore = Math.exp(-ny * ny * 26.0) * 0.52;
    const vertHalo = Math.exp(-ny * ny * 5.8) * 0.24;
    const edgeY = 1.0 - smoothstep(0.65, 0.96, ay);

    const alpha = clamp01((vertRazor + vertCore + vertHalo) * horizFade * edgeY);
    if (alpha <= 0.001) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return;
    }

    // Center: warm gold/amber; wings: soft cyan dispersion; outer vertical edge: subtle magenta fringe
    const wing = smoothstep(0.10, 0.52, ax);
    const outerFringe = smoothstep(0.14, 0.48, ay);

    const r = 1.0 * (1.0 - wing * 0.58) + outerFringe * 0.36;
    const g = 0.86 - outerFringe * 0.28 + wing * 0.08;
    const b = 0.54 + wing * 0.44 + outerFringe * 0.28;

    out[0] = clamp01(r);
    out[1] = clamp01(g);
    out[2] = clamp01(b);
    out[3] = alpha;
  });
}

/**
 * Soft hexagonal aperture bokeh with delicate spherical-aberration rim brightening.
 */
function buildHexBokehTexture(): THREE.CanvasTexture {
  const k0 = -0.866025404; // -sqrt(3)/2
  const k1 = 0.5;
  const k2 = 0.577350269; // 1/sqrt(3)
  const hexRadius = 0.68;

  return createCanvasTexture(256, 256, (nx, ny, out) => {
    // 2D signed distance to regular hexagon (rotated slightly for natural iris orientation)
    const rot = 0.26;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    let px = Math.abs(nx * c - ny * s);
    let py = Math.abs(nx * s + ny * c);

    const dotK = k0 * px + k1 * py;
    const reflect = 2.0 * Math.min(dotK, 0.0);
    px -= reflect * k0;
    py -= reflect * k1;
    px -= Math.max(-k2 * hexRadius, Math.min(k2 * hexRadius, px));
    py -= hexRadius;
    const sd = Math.hypot(px, py) * Math.sign(py);

    // Smooth interior fill + soft bright optical rim + silky outer feather
    const inside = 1.0 - smoothstep(-0.04, 0.11, sd);
    const rim = Math.exp(-Math.pow((sd + 0.04) / 0.085, 2.0)) * 0.45;
    const radialGuard = 1.0 - smoothstep(0.72, 0.96, Math.hypot(nx, ny));

    const alpha = clamp01((inside * 0.62 + rim) * radialGuard);
    out[0] = 1.0;
    out[1] = 0.97;
    out[2] = 0.93;
    out[3] = alpha;
  });
}

/**
 * Delicate chromatic optical lens ring (warm gold outer dispersion -> pale cyan inner fringe).
 */
function buildRingBokehTexture(): THREE.CanvasTexture {
  return createCanvasTexture(256, 256, (nx, ny, out) => {
    const r = Math.hypot(nx, ny);
    const band = Math.exp(-Math.pow((r - 0.66) / 0.11, 2.0));
    const innerSoft = Math.exp(-Math.pow((r - 0.48) / 0.16, 2.0)) * 0.22;
    const edgeGuard = 1.0 - smoothstep(0.76, 0.98, r);

    const alpha = clamp01((band + innerSoft) * edgeGuard);
    const spectral = clamp01((r - 0.52) / 0.28);

    out[0] = 0.65 + spectral * 0.35;
    out[1] = 0.85 - Math.abs(spectral - 0.5) * 0.22;
    out[2] = 1.0 - spectral * 0.42;
    out[3] = alpha;
  });
}

/**
 * Procedural GPU-friendly Golden Hour cinematic lens flare rig.
 *
 * Uses clip-space NDC-projected additive quads (zero framebuffer-copy stalls on mobile),
 * smoothly attenuates by camera alignment, viewport edges, horizon elevation, and
 * lightweight LiDAR heightmap occlusion, and disables completely in Night mode.
 */
export class SunLensFlare {
  public readonly group = new THREE.Group();

  private enabled = false;
  private sunWorldPos = new THREE.Vector3(-52, 11, 138);
  private smoothedIntensity = 0;

  private readonly quadGeo: THREE.PlaneGeometry;
  private readonly textures: THREE.CanvasTexture[];
  private readonly elements: FlareElementInstance[] = [];

  // Pre-allocated scratch vectors (zero per-frame heap allocations)
  private readonly tmpToSun = new THREE.Vector3();
  private readonly tmpCamForward = new THREE.Vector3();
  private readonly tmpNdc = new THREE.Vector3();

  private static readonly OCCLUSION_STEPS = [1.5, 3, 5, 7.5, 10.5, 14, 18, 22, 27, 33, 40, 48];

  constructor(parentScene: THREE.Scene) {
    this.group.name = 'SunLensFlareRig';
    this.group.visible = false;
    parentScene.add(this.group);

    this.quadGeo = new THREE.PlaneGeometry(2, 2);

    const starburstTex = buildStarburstTexture();
    const softGlowTex = buildSoftGlowTexture();
    const anamorphicTex = buildAnamorphicTexture();
    const hexBokehTex = buildHexBokehTexture();
    const ringBokehTex = buildRingBokehTexture();
    this.textures = [starburstTex, softGlowTex, anamorphicTex, hexBokehTex, ringBokehTex];

    const specs: FlareElementSpec[] = [
      // 1. Warm atmospheric solar bloom around sun disc
      {
        texture: softGlowTex,
        size: 0.52,
        axisDist: 0.0,
        color: new THREE.Color(0xffad58),
        baseOpacity: 0.34,
      },
      // 2. Crisp 8-point diffraction starburst + solar core
      {
        texture: starburstTex,
        size: 0.44,
        axisDist: 0.0,
        color: new THREE.Color(0xffe6a8),
        baseOpacity: 0.88,
        rotateFactor: 0.35,
        isStarburst: true,
      },
      // 3. Subtle cinematic horizontal anamorphic streak (warm gold + cyan/magenta wings)
      {
        texture: anamorphicTex,
        size: 0.075,
        stretchX: 8.6,
        axisDist: 0.0,
        color: new THREE.Color(0xffffff),
        baseOpacity: 0.58,
        isAnamorphic: true,
      },
      // 4. Delicate prismatic halo ring closely framing the sun
      {
        texture: ringBokehTex,
        size: 0.20,
        axisDist: 0.06,
        color: new THREE.Color(0xffd796),
        baseOpacity: 0.22,
      },
      // 5-10. Optical internal glass reflection bokeh ghosts along sun -> screen-center axis
      {
        texture: hexBokehTex,
        size: 0.068,
        axisDist: 0.34,
        color: new THREE.Color(0xffcc78),
        baseOpacity: 0.28,
        rotateFactor: 0.15,
        isGhost: true,
      },
      {
        texture: hexBokehTex,
        size: 0.105,
        axisDist: 0.66,
        color: new THREE.Color(0xffa452),
        baseOpacity: 0.22,
        rotateFactor: -0.18,
        isGhost: true,
      },
      {
        texture: hexBokehTex,
        size: 0.054,
        axisDist: 1.02,
        color: new THREE.Color(0x74d8ff),
        baseOpacity: 0.20,
        rotateFactor: 0.25,
        isGhost: true,
      },
      {
        texture: ringBokehTex,
        size: 0.145,
        axisDist: 1.36,
        color: new THREE.Color(0xff9ac2),
        baseOpacity: 0.22,
        isGhost: true,
      },
      {
        texture: hexBokehTex,
        size: 0.12,
        axisDist: 1.70,
        color: new THREE.Color(0xffda82),
        baseOpacity: 0.24,
        rotateFactor: 0.2,
        isGhost: true,
      },
      {
        texture: ringBokehTex,
        size: 0.19,
        axisDist: 2.06,
        color: new THREE.Color(0xffb668),
        baseOpacity: 0.18,
        isGhost: true,
      },
    ];

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: spec.texture },
          uColor: { value: spec.color.clone() },
          uOpacity: { value: 0 },
          uCenterNdc: { value: new THREE.Vector2() },
          uScaleNdc: { value: new THREE.Vector2() },
          uRotation: { value: 0 },
        },
        vertexShader: FLARE_VERTEX_SHADER,
        fragmentShader: FLARE_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });

      const mesh = new THREE.Mesh(this.quadGeo, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 999 + i;
      this.group.add(mesh);

      this.elements.push({ spec, mesh, material });
    }
  }

  public setSunWorldPosition(pos: THREE.Vector3): void {
    this.sunWorldPos.copy(pos);
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.smoothedIntensity = 0;
      this.group.visible = false;
    } else {
      // Fade in smoothly when switching into Golden Hour
      this.smoothedIntensity = 0;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public update(
    camera: THREE.Camera,
    dt: number,
    timeSec: number,
    parkSurface?: ParkSurface
  ): void {
    if (!this.enabled) {
      this.group.visible = false;
      return;
    }

    camera.updateMatrixWorld();

    this.tmpToSun.copy(this.sunWorldPos).sub(camera.position);
    const distToSun = this.tmpToSun.length();
    if (distToSun < 0.001) {
      this.group.visible = false;
      return;
    }
    this.tmpToSun.divideScalar(distToSun);

    camera.getWorldDirection(this.tmpCamForward);
    const dotForward = this.tmpCamForward.dot(this.tmpToSun);

    let targetIntensity = 0;
    let sunX = 0;
    let sunY = 0;
    let dirFade = 0;

    if (dotForward > 0.25) {
      this.tmpNdc.copy(this.sunWorldPos).project(camera);
      sunX = this.tmpNdc.x;
      sunY = this.tmpNdc.y;

      const maxAbsNdc = Math.max(Math.abs(sunX), Math.abs(sunY));
      const edgeFade = 1.0 - smoothstep(0.78, 1.42, maxAbsNdc);
      const horizonFade = smoothstep(-0.02, 0.045, this.tmpToSun.y);
      dirFade = smoothstep(0.38, 0.985, dotForward);
      const centerBloom = 0.62 + 0.38 * smoothstep(0.72, 0.995, dotForward);

      let occlusion = 1.0;
      if (parkSurface && edgeFade > 0.005 && dirFade > 0.005) {
        occlusion = this.computeParkOcclusion(camera.position, this.tmpToSun, parkSurface);
      }

      targetIntensity = dirFade * edgeFade * horizonFade * centerBloom * occlusion;
    }

    const clampedDt = Math.min(Math.max(dt, 0), 0.05);
    const fadeRate = targetIntensity > this.smoothedIntensity ? 14.0 : 10.0;
    const alphaLerp = 1.0 - Math.exp(-fadeRate * clampedDt);
    this.smoothedIntensity += (targetIntensity - this.smoothedIntensity) * alphaLerp;

    if (this.smoothedIntensity < 0.002) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    const aspect =
      camera instanceof THREE.PerspectiveCamera ? Math.max(0.25, camera.aspect) : 1.0;
    // Scale relative to shorter viewport dimension so flares remain circular & well-proportioned on 16:9 and 9:16
    const unitX = aspect >= 1.0 ? 1.0 / aspect : 1.0;
    const unitY = aspect >= 1.0 ? 1.0 : aspect;

    const sunEccentricity = Math.min(1.0, Math.hypot(sunX, sunY));
    const ghostScaleFactor = 0.72 + 0.28 * sunEccentricity;
    const starPulse = 1.0 + 0.03 * Math.sin(timeSec * 2.1);

    for (let i = 0; i < this.elements.length; i++) {
      const { spec, material } = this.elements[i];
      const uniforms = material.uniforms;

      const axisScale = 1.0 - spec.axisDist;
      uniforms.uCenterNdc.value.set(sunX * axisScale, sunY * axisScale);

      let elemOpacity = spec.baseOpacity * this.smoothedIntensity;
      let scaleMultiplier = 1.0;

      if (spec.isStarburst) {
        scaleMultiplier = (0.86 + 0.24 * dirFade) * starPulse;
        elemOpacity *= 0.78 + 0.22 * dirFade;
      } else if (spec.isAnamorphic) {
        scaleMultiplier = 0.85 + 0.25 * dirFade;
        elemOpacity *= 0.62 + 0.38 * dirFade;
      } else if (spec.isGhost) {
        elemOpacity *= ghostScaleFactor;
      }

      const sx = spec.size * (spec.stretchX ?? 1.0) * unitX * scaleMultiplier;
      const sy = spec.size * unitY * scaleMultiplier;
      uniforms.uScaleNdc.value.set(sx, sy);

      const rot = spec.rotateFactor
        ? (sunX * 0.85 - sunY * 0.45) * spec.rotateFactor + (spec.isStarburst ? timeSec * 0.04 : 0)
        : 0;
      uniforms.uRotation.value = rot;
      uniforms.uOpacity.value = elemOpacity;
    }
  }

  private computeParkOcclusion(
    camPos: THREE.Vector3,
    toSunDir: THREE.Vector3,
    parkSurface: ParkSurface
  ): number {
    const bounds = parkSurface.getBounds();
    let minClearance = 10.0;

    for (let i = 0; i < SunLensFlare.OCCLUSION_STEPS.length; i++) {
      const d = SunLensFlare.OCCLUSION_STEPS[i];
      const rx = camPos.x + toSunDir.x * d;
      const rz = camPos.z + toSunDir.z * d;

      if (
        bounds &&
        (rx < bounds.xMin || rx > bounds.xMax || rz < bounds.zMin || rz > bounds.zMax)
      ) {
        break;
      }

      const rayY = camPos.y + toSunDir.y * d;
      const groundH = parkSurface.evaluateHeight(rx, rz);
      const clearance = rayY - groundH;
      if (clearance < minClearance) {
        minClearance = clearance;
        if (minClearance <= -0.35) {
          return 0.0;
        }
      }
    }

    return smoothstep(-0.30, 0.28, minClearance);
  }

  public dispose(): void {
    this.group.removeFromParent();
    this.quadGeo.dispose();
    for (const el of this.elements) {
      el.material.dispose();
    }
    for (const tex of this.textures) {
      tex.dispose();
    }
    this.elements.length = 0;
    this.textures.length = 0;
  }
}
