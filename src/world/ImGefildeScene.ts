import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ParkSurface } from '../physics/ParkSurface';
import { resolveAssetUrl } from '../utils/assetUrl';
import { SunLensFlare } from './SunLensFlare';

export type AtmosphereMode = 'night' | 'golden_hour';

export class ImGefildeScene {
  // Exact world direction of the visible sunset sun in `textures/airport_golden_hour_bg.jpg`
  // (inverse-mapped from skyDome shader: az ≈ 0.8074, elev ≈ 5.9° above horizon)
  private static readonly GOLDEN_SKY_SUN_DIR = new THREE.Vector3(-0.35069, 0.10367, 0.93065).normalize();
  private static readonly SKY_DOME_SUN_DIST = 148;

  public mode: AtmosphereMode = 'night';
  public parkRoot = new THREE.Group();
  private activeParkGroup = new THREE.Group();
  private parkLoadToken = 0;
  private activeParkMaterials: THREE.MeshStandardMaterial[] = [];
  private activeOuterGroundMat: THREE.MeshStandardMaterial | null = null;
  private currentParkId: string = 'im_gefilde';
  private currentQuality: 'high' | 'medium' | 'low' = 'high';

  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private floodLights: THREE.SpotLight[] = [];
  private skyDome: THREE.Mesh;
  private nightCityBackdrop: THREE.Mesh;
  private sunLensFlare: SunLensFlare;
  private skyUniforms: {
    uMode: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uTime: { value: number };
  };

  private pmremGenerator: THREE.PMREMGenerator;
  private nightEnvMap: THREE.Texture | null = null;
  private goldenEnvMap: THREE.Texture | null = null;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.activeParkGroup.name = 'activeParkGroup';
    this.parkRoot.add(this.activeParkGroup);
    this.scene.add(this.parkRoot);
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();

    // 1. Nighttime Stadium Floodlight + Moon/Sky Bounce + Fill Lighting
    this.hemiLight = new THREE.HemisphereLight(0x213e69, 0x121720, 0.72);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xeef6ff, 1.75);
    this.sunLight.position.set(14, 22, -10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 85;
    const d = 26;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.015;
    this.scene.add(this.sunLight);

    // Subtle cool night bounce fill from opposite azimuth so shadows have realistic ambient detail
    this.fillLight = new THREE.DirectionalLight(0x5278b8, 0.32);
    this.fillLight.position.set(-20, 15, 16);
    this.scene.add(this.fillLight);

    // 2. Night Sky Dome mapped with the alpine night photo (`textures/night_sky_alps.jpg`)
    const texLoader = new THREE.TextureLoader();
    const nightSkyTex = texLoader.load(resolveAssetUrl('textures/night_sky_alps.jpg?v=2'));
    nightSkyTex.colorSpace = THREE.SRGBColorSpace;
    nightSkyTex.wrapS = THREE.MirroredRepeatWrapping;
    nightSkyTex.wrapT = THREE.MirroredRepeatWrapping;
    nightSkyTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    nightSkyTex.generateMipmaps = false;
    nightSkyTex.minFilter = THREE.LinearFilter;
    nightSkyTex.magFilter = THREE.LinearFilter;

    const goldenSkyTex = texLoader.load(resolveAssetUrl('textures/airport_golden_hour_bg.jpg?v=1'));
    goldenSkyTex.colorSpace = THREE.SRGBColorSpace;
    goldenSkyTex.wrapS = THREE.RepeatWrapping;
    goldenSkyTex.wrapT = THREE.ClampToEdgeWrapping;
    goldenSkyTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    goldenSkyTex.generateMipmaps = false;
    goldenSkyTex.minFilter = THREE.LinearFilter;
    goldenSkyTex.magFilter = THREE.LinearFilter;

    this.skyUniforms = {
      uMode: { value: 1.0 },
      uSunDir: { value: this.sunLight.position.clone().normalize() },
      uTime: { value: 0.0 },
    };

    const skyGeo = new THREE.SphereGeometry(150, 48, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        ...this.skyUniforms,
        uSkyTex: { value: nightSkyTex },
        uGoldenSkyTex: { value: goldenSkyTex },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uMode;
        uniform sampler2D uSkyTex;
        uniform sampler2D uGoldenSkyTex;
        varying vec3 vWorldPos;
        varying vec2 vUv;

        void main() {
          vec3 dir = normalize(vWorldPos);
          float az = atan(dir.z, dir.x) / (2.0 * 3.14159265) + 0.5;

          if (uMode < 0.5) {
            // Golden Hour 360 equirectangular upper-hemisphere sky + distant tree line
            float elevNorm = clamp(asin(clamp(dir.y, -0.02, 1.0)) / (0.5 * 3.14159265), 0.0, 1.0);
            vec2 skyUv = vec2(az, clamp(0.015 + elevNorm * 0.98, 0.005, 0.995));
            vec3 texCol = texture2D(uGoldenSkyTex, skyUv).rgb;
            vec3 goldenGround = vec3(0.055, 0.042, 0.036);
            float horizonBlend = smoothstep(-0.04, 0.02, dir.y);
            vec3 col = mix(goldenGround, texCol, horizonBlend);
            gl_FragColor = vec4(col, 1.0);
            return;
          }

          float elev = max(0.0, dir.y);
          // Sample the portrait night photo around the dome: 4 mirrored copies (90 deg each) keep its
          // proportions; the image bottom (mountains & fir trees) sits right on the horizon.
          vec2 skyUv = vec2(az * 4.0, clamp(elev * 1.15 + 0.02, 0.01, 0.99));
          vec3 texCol = texture2D(uSkyTex, skyUv).rgb * 1.2;

          vec3 nightGround = vec3(0.004, 0.008, 0.014);
          float horizonBlend = smoothstep(-0.04, 0.06, dir.y);
          vec3 col = mix(nightGround, texCol, horizonBlend);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);

    // Keep a dummy hidden mesh reference for compatibility
    this.nightCityBackdrop = new THREE.Mesh();
    this.nightCityBackdrop.visible = false;

    // 3. Perimeter Floodlights illuminating the skatepark concrete (no visible sky glow sprites or stars)
    const poleCoords: [number, number, number, number][] = [
      [-12.5, -19.5, -2.0, -12.0],
      [8.5, -20.5, 1.5, -13.0],
      [13.8, -6.5, 2.5, -2.0],
      [13.2, 9.5, 2.0, 5.0],
      [-13.2, 6.5, -2.5, 3.0],
      [-10.5, 18.5, -2.2, 13.8],
    ];

    poleCoords.forEach(([px, pz, tx, tz]) => {
      const spot = new THREE.SpotLight(0xffe8cc, 16.5, 58, Math.PI * 0.42, 0.65, 1.5);
      spot.position.set(px, 13.5, pz);
      spot.target.position.set(tx, 0.4, tz);
      spot.castShadow = false;
      spot.visible = true;
      this.scene.add(spot);
      this.scene.add(spot.target);
      this.floodLights.push(spot);
    });

    this.nightEnvMap = this.buildNightIBL();
    this.goldenEnvMap = this.buildGoldenIBL();

    this.sunLensFlare = new SunLensFlare(this.scene);
    this.sunLensFlare.setSunWorldPosition(
      ImGefildeScene.GOLDEN_SKY_SUN_DIR.clone().multiplyScalar(ImGefildeScene.SKY_DOME_SUN_DIST)
    );

    this.setAtmosphereMode('night');
  }

  private buildNightIBL(): THREE.Texture {
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(20, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec3 sky = mix(vec3(0.08, 0.14, 0.25), vec3(0.01, 0.02, 0.05), max(0.0, vDir.y));
          vec3 ground = vec3(0.12, 0.14, 0.18);
          vec3 col = vDir.y >= 0.0 ? sky : ground;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    envScene.add(new THREE.Mesh(geo, mat));
    const rt = this.pmremGenerator.fromScene(envScene, 0.03);
    geo.dispose();
    mat.dispose();
    return rt.texture;
  }

  private buildGoldenIBL(): THREE.Texture {
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(20, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          // Rich warm sunset horizon fading into deep twilight zenith & shadow ground for contrasty IBL
          vec3 sky = mix(vec3(0.46, 0.24, 0.11), vec3(0.08, 0.13, 0.26), pow(max(0.0, vDir.y), 0.75));
          vec3 ground = vec3(0.06, 0.06, 0.09);
          vec3 col = vDir.y >= 0.0 ? sky : ground;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    envScene.add(new THREE.Mesh(geo, mat));
    const rt = this.pmremGenerator.fromScene(envScene, 0.03);
    geo.dispose();
    mat.dispose();
    return rt.texture;
  }

  private disposeMaterialTextures(mat: THREE.Material): void {
    const std = mat as THREE.MeshStandardMaterial;
    std.map?.dispose();
    std.normalMap?.dispose();
    std.roughnessMap?.dispose();
    std.metalnessMap?.dispose();
    std.aoMap?.dispose();
    std.emissiveMap?.dispose();
  }

  private disposeObjectTree(root: THREE.Object3D): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        for (const m of mesh.material) {
          this.disposeMaterialTextures(m);
          m.dispose();
        }
      } else if (mesh.material) {
        this.disposeMaterialTextures(mesh.material);
        mesh.material.dispose();
      }
    });
  }

  private clearActivePark(): void {
    this.activeParkMaterials = [];
    this.activeOuterGroundMat = null;

    while (this.activeParkGroup.children.length > 0) {
      const child = this.activeParkGroup.children[0];
      this.activeParkGroup.remove(child);
      this.disposeObjectTree(child);
    }

    // Defensive cleanup in case any non-activeParkGroup children were ever attached to parkRoot
    for (let i = this.parkRoot.children.length - 1; i >= 0; i--) {
      const child = this.parkRoot.children[i];
      if (child !== this.activeParkGroup) {
        this.parkRoot.remove(child);
        this.disposeObjectTree(child);
      }
    }
  }

  public async load(parkId: string = 'im_gefilde'): Promise<boolean> {
    const token = ++this.parkLoadToken;
    const loader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    // Immediately clear & dispose any existing park meshes before starting async loads
    this.clearActivePark();

    const parkMaterials: THREE.MeshStandardMaterial[] = [];
    let loadedParkScene: THREE.Object3D;

    if (parkId === 'aschheim') {
      // pumptrack_aschheim.glb belongs strictly to 'aschheim' and is guarded by parkLoadToken
      const aschheimGltf = await loader.loadAsync(resolveAssetUrl('models/pumptrack_aschheim.glb?v=1'));
      if (token !== this.parkLoadToken) {
        this.disposeObjectTree(aschheimGltf.scene);
        return false;
      }
      aschheimGltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
        }
      });
      loadedParkScene = aschheimGltf.scene;
    } else if (parkId === 'airport_skatepark') {
      const [airportGltf, airportColorTex] = await Promise.all([
        loader.loadAsync(resolveAssetUrl('models/airport_skatepark_game.glb?v=2')),
        texLoader.loadAsync(resolveAssetUrl('textures/airport_skatepark_tex0.jpg?v=3')),
      ]);
      if (token !== this.parkLoadToken) {
        this.disposeObjectTree(airportGltf.scene);
        airportColorTex.dispose();
        return false;
      }

      airportColorTex.flipY = false;
      airportColorTex.colorSpace = THREE.SRGBColorSpace;
      airportColorTex.anisotropy = maxAniso;
      airportColorTex.needsUpdate = true;

      airportGltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          const mat = new THREE.MeshStandardMaterial({
            map: airportColorTex,
            color: 0xffffff,
            roughness: 0.78,
            metalness: 0.02,
            envMapIntensity: 0.85,
            side: THREE.FrontSide,
          });
          mesh.material = mat;
          parkMaterials.push(mat);
        }
      });
      loadedParkScene = airportGltf.scene;
    } else {
      // Load the floor-flattened, wall-preserving Multi-Video 3D Gaussian Splatting model (`models/skatepark_multi.glb`)
      // AND explicitly load the extracted 4K color texture (`textures/skatepark_multi_tex0.jpg`) so it is
      // 100% guaranteed to bind even after rapid hot-reloads!
      const [multiGltf, parkColorTex] = await Promise.all([
        loader.loadAsync(resolveAssetUrl('models/skatepark_multi.glb?v=4')),
        texLoader.loadAsync(resolveAssetUrl('textures/skatepark_multi_tex0.jpg?v=2')),
      ]);
      if (token !== this.parkLoadToken) {
        this.disposeObjectTree(multiGltf.scene);
        parkColorTex.dispose();
        return false;
      }

      parkColorTex.flipY = false; // glTF UV convention
      parkColorTex.colorSpace = THREE.SRGBColorSpace;
      parkColorTex.anisotropy = maxAniso;
      parkColorTex.needsUpdate = true;

      // Exact real-world Procrustes alignment matching `im_gefilde_lidar.json`:
      const S = 23.1442;
      multiGltf.scene.scale.set(S, S, S);
      multiGltf.scene.rotation.set(0, 2.7887, 0);
      multiGltf.scene.position.set(2.548, -1.007, 0.437);

      multiGltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          const mat = new THREE.MeshStandardMaterial({
            map: parkColorTex,
            color: 0xffffff,
            roughness: 0.78,
            metalness: 0.02,
            envMapIntensity: 0.85,
            side: THREE.FrontSide,
          });
          mesh.material = mat;
          parkMaterials.push(mat);
        }
      });
      loadedParkScene = multiGltf.scene;
    }

    if (token !== this.parkLoadToken) {
      this.disposeObjectTree(loadedParkScene);
      return false;
    }

    // Ensure activeParkGroup is strictly empty before attaching the new park
    this.clearActivePark();
    this.currentParkId = parkId;
    this.activeParkMaterials = parkMaterials;
    this.activeParkGroup.add(loadedParkScene);

    const isGolden = parkId === 'airport_skatepark';

    // Subtle ground plane well beneath the scan perimeter (-1.5m) so it never overlaps low pockets
    const outerGroundGeo = new THREE.CircleGeometry(90, 64);
    outerGroundGeo.rotateX(-Math.PI / 2);
    const outerGroundMat = new THREE.MeshStandardMaterial({
      color: isGolden ? 0x16120e : 0x0c1018,
      roughness: 0.96,
      metalness: 0.02,
    });
    const outerGround = new THREE.Mesh(outerGroundGeo, outerGroundMat);
    outerGround.position.set(0, -1.5, 0);
    outerGround.receiveShadow = true;
    this.activeOuterGroundMat = outerGroundMat;
    this.activeParkGroup.add(outerGround);

    this.setAtmosphereMode(isGolden ? 'golden_hour' : 'night');
    return true;
  }

  public update(timeSec: number): void {
    this.skyUniforms.uTime.value = timeSec;
  }

  public updateLensFlare(
    camera: THREE.Camera,
    dt: number,
    timeSec: number,
    parkSurface?: ParkSurface
  ): void {
    this.sunLensFlare.update(camera, dt, timeSec, parkSurface);
  }

  public toggleAtmosphere(): AtmosphereMode {
    this.setAtmosphereMode(this.mode === 'night' ? 'golden_hour' : 'night');
    return this.mode;
  }

  private applyParkMaterialMood(isGolden: boolean): void {
    for (const mat of this.activeParkMaterials) {
      if (isGolden) {
        mat.color.setHex(0xf4ebe2);
        mat.roughness = 0.84;
        mat.envMapIntensity = 0.72;
      } else {
        mat.color.setHex(0xffffff);
        mat.roughness = 0.72;
        mat.envMapIntensity = 0.84;
      }
    }
    if (this.activeOuterGroundMat) {
      this.activeOuterGroundMat.color.setHex(isGolden ? 0x16120e : 0x0c1018);
    }
  }

  private applyLightingForCurrentState(): void {
    const isGolden = this.mode === 'golden_hour';
    const q = this.currentQuality;

    if (q === 'high') {
      this.sunLight.castShadow = true;
      if (this.sunLight.shadow.mapSize.x !== 2048) {
        this.sunLight.shadow.mapSize.set(2048, 2048);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null;
      }
      this.hemiLight.intensity = isGolden ? 0.72 : 0.78;
      this.sunLight.intensity = isGolden ? 2.75 : 1.95;
      this.fillLight.intensity = isGolden ? 0.48 : 0.56;
      this.floodLights.forEach((spot) => {
        spot.intensity = isGolden ? 0.0 : 18.5;
        spot.visible = !isGolden;
      });
    } else if (q === 'medium') {
      this.sunLight.castShadow = true;
      if (this.sunLight.shadow.mapSize.x !== 1024) {
        this.sunLight.shadow.mapSize.set(1024, 1024);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null;
      }
      this.hemiLight.intensity = isGolden ? 0.76 : 0.88;
      this.sunLight.intensity = isGolden ? 2.8 : 2.05;
      this.fillLight.intensity = isGolden ? 0.5 : 0.6;
      this.floodLights.forEach((spot, idx) => {
        spot.visible = !isGolden && (idx === 0 || idx === 2);
        spot.intensity = isGolden ? 0.0 : 21.5;
      });
    } else {
      // 'low' (Performance mode: dynamic shadows & heavy spotlights off, boost ambient fill)
      this.sunLight.castShadow = false;
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
      this.hemiLight.intensity = isGolden ? 0.9 : 1.1;
      this.sunLight.intensity = isGolden ? 2.75 : 2.2;
      this.fillLight.intensity = isGolden ? 0.58 : 0.72;
      this.floodLights.forEach((spot) => {
        spot.visible = false;
      });
    }
  }

  public setAtmosphereMode(mode: AtmosphereMode = 'night'): void {
    this.mode = mode;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    if (mode === 'golden_hour') {
      // Warm, well-readable Golden Hour exposure tailored per park while preserving contrast
      this.renderer.toneMappingExposure =
        this.currentParkId === 'airport_skatepark'
          ? 1.06
          : this.currentParkId === 'im_gefilde'
            ? 1.02
            : 1.04;
      this.skyUniforms.uMode.value = 0.0;
      this.scene.environment = this.goldenEnvMap;
      // Warm sunset horizon haze blending with Golden Hour sky & lens flare
      this.scene.fog = new THREE.FogExp2(0xb87648, 0.0022);
      // Deep cool dusk sky/ground shadow fill for rich bowl transition contrast
      this.hemiLight.color.setHex(0x3a4d78);
      this.hemiLight.groundColor.setHex(0x1d2236);
      // Warm low-angle sunset key light aligned with Golden Hour sun azimuth
      this.sunLight.color.setHex(0xff9c4a);
      this.sunLight.position.set(-11.5, 9.2, 30.5);
      this.fillLight.color.setHex(0x2a3552);
      this.fillLight.position.set(12, 8, -22);
      this.nightCityBackdrop.visible = false;
      this.sunLensFlare.setEnabled(true);
      this.applyParkMaterialMood(true);
      this.applyLightingForCurrentState();
      return;
    }

    // Night mode: cinematic warm-floodlight vs cool-moonlight contrast with clean ACESFilmic depth
    this.renderer.toneMappingExposure = 1.08;
    this.skyUniforms.uMode.value = 1.0;
    this.scene.environment = this.nightEnvMap;
    this.scene.fog = new THREE.FogExp2(0x0b1428, 0.0026);
    this.hemiLight.color.setHex(0x223b6c);
    this.hemiLight.groundColor.setHex(0x0e1424);
    // Crisp warm-white / subtle sodium-gold overhead floodlight shadow key
    this.sunLight.color.setHex(0xffe2bd);
    this.sunLight.position.set(14, 22, -10);
    // Cool electric-blue moonlight rim from opposite azimuth
    this.fillLight.color.setHex(0x4ea8ff);
    this.fillLight.position.set(-20, 15, 16);
    this.nightCityBackdrop.visible = false;
    this.sunLensFlare.setEnabled(false);
    this.applyParkMaterialMood(false);
    this.applyLightingForCurrentState();
  }

  public dispose(): void {
    this.clearActivePark();
    this.nightEnvMap?.dispose();
    this.goldenEnvMap?.dispose();
    this.pmremGenerator.dispose();
    this.sunLensFlare.dispose();
  }

  public setQuality(quality: 'high' | 'medium' | 'low'): void {
    this.currentQuality = quality;
    this.applyLightingForCurrentState();
  }
}
