import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type AtmosphereMode = 'night';

export class ImGefildeScene {
  public mode: AtmosphereMode = 'night';
  public parkRoot = new THREE.Group();

  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private floodLights: THREE.SpotLight[] = [];
  private floodGlowSprites: THREE.Sprite[] = [];
  private starField: THREE.Points;
  private skyDome: THREE.Mesh;
  private nightCityBackdrop: THREE.Mesh;
  private skyUniforms: {
    uMode: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uTime: { value: number };
  };

  private pmremGenerator: THREE.PMREMGenerator;
  private nightEnvMap: THREE.Texture | null = null;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
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

    // 2. Deep Starry Night Sky Dome Mapped with Uploaded Night Sky Texture (`/textures/night_sky_bg.png`)
    const texLoader = new THREE.TextureLoader();
    const nightSkyTex = texLoader.load('/textures/night_sky_bg.png');
    nightSkyTex.colorSpace = THREE.SRGBColorSpace;
    nightSkyTex.wrapS = THREE.MirroredRepeatWrapping;
    nightSkyTex.wrapT = THREE.MirroredRepeatWrapping;
    nightSkyTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

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
        uniform sampler2D uSkyTex;
        varying vec3 vWorldPos;
        varying vec2 vUv;

        void main() {
          vec3 dir = normalize(vWorldPos);
          float elev = max(0.0, dir.y);

          // Sample the uploaded starry night sky image across the dome using spherical azimuth & elevation
          float az = atan(dir.z, dir.x) / (2.0 * 3.14159265) + 0.5;
          vec2 skyUv = vec2(az * 2.0, clamp(elev * 1.45 + 0.05, 0.02, 0.98));
          vec3 texCol = texture2D(uSkyTex, skyUv).rgb * 1.35;

          vec3 nightGround = vec3(0.008, 0.015, 0.028);
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

    // 4. Starry Night Field above the Munich Cityscape
    const starCount = 1600;
    const starPos = new Float32Array(starCount * 3);
    const starCol = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.18 + Math.random() * 0.82);
      const r = 135;
      starPos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const brightness = 0.65 + Math.random() * 0.35;
      starCol[i * 3 + 0] = brightness * 0.92;
      starCol[i * 3 + 1] = brightness * 0.96;
      starCol[i * 3 + 2] = brightness;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.65,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
    });
    this.starField = new THREE.Points(starGeo, starMat);
    this.starField.visible = true;
    this.scene.add(this.starField);

    // 5. Tall Pole Floodlights (6 poles around the Im Gefilde park perimeter)
    const poleCoords: [number, number, number, number][] = [
      [-12.5, -19.5, -2.0, -12.0],
      [8.5, -20.5, 1.5, -13.0],
      [13.8, -6.5, 2.5, -2.0],
      [13.2, 9.5, 2.0, 5.0],
      [-13.2, 6.5, -2.5, 3.0],
      [-10.5, 18.5, -2.2, 13.8],
    ];

    const glowTex = this.createFloodlightGlowTexture();
    poleCoords.forEach(([px, pz, tx, tz]) => {
      const spot = new THREE.SpotLight(0xf6faff, 15.0, 58, Math.PI * 0.42, 0.65, 1.5);
      spot.position.set(px, 13.5, pz);
      spot.target.position.set(tx, 0.4, tz);
      spot.castShadow = false;
      spot.visible = true;
      this.scene.add(spot);
      this.scene.add(spot.target);
      this.floodLights.push(spot);

      const spriteMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xeaf6ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(px, 13.4, pz);
      sprite.scale.set(5.2, 5.2, 1);
      sprite.visible = true;
      this.scene.add(sprite);
      this.floodGlowSprites.push(sprite);
    });

    this.nightEnvMap = this.buildNightIBL();
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

  public async load(): Promise<void> {
    const loader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    // Load the floor-flattened, wall-preserving Multi-Video 3D Gaussian Splatting model (`/models/skatepark_multi.glb`)
    // AND explicitly load the extracted 4K color texture (`/textures/skatepark_multi_tex0.jpg`) so it is
    // 100% guaranteed to bind even after rapid hot-reloads!
    const [multiGltf, parkColorTex] = await Promise.all([
      loader.loadAsync('/models/skatepark_multi.glb?v=4'),
      texLoader.loadAsync('/textures/skatepark_multi_tex0.jpg'),
    ]);

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
        mesh.material = new THREE.MeshStandardMaterial({
          map: parkColorTex,
          color: 0xffffff,
          roughness: 0.78,
          metalness: 0.02,
          envMapIntensity: 0.85,
          side: THREE.DoubleSide,
        });
      }
    });
    this.parkRoot.add(multiGltf.scene);

    // Subtle dark night ground plane well beneath the scan perimeter (-1.2m) so it never overlaps low pockets
    const outerGroundGeo = new THREE.CircleGeometry(90, 64);
    outerGroundGeo.rotateX(-Math.PI / 2);
    const outerGroundMat = new THREE.MeshStandardMaterial({
      color: 0x0c1018,
      roughness: 0.96,
      metalness: 0.02,
    });
    const outerGround = new THREE.Mesh(outerGroundGeo, outerGroundMat);
    outerGround.position.set(0, -1.2, 0);
    outerGround.receiveShadow = true;
    this.parkRoot.add(outerGround);
  }

  public update(timeSec: number): void {
    this.skyUniforms.uTime.value = timeSec;
  }

  public toggleAtmosphere(): AtmosphereMode {
    this.setAtmosphereMode('night');
    return this.mode;
  }

  public setAtmosphereMode(_mode: AtmosphereMode = 'night'): void {
    this.mode = 'night';
    this.skyUniforms.uMode.value = 1.0;
    this.scene.environment = this.nightEnvMap;
    this.scene.fog = new THREE.FogExp2(0x050b16, 0.0028);
    this.hemiLight.color.setHex(0xb8d0f8);
    this.hemiLight.groundColor.setHex(0x282d38);
    this.hemiLight.intensity = 0.95;
    // Overhead stadium floodlight shadow key
    this.sunLight.color.setHex(0xfff8ee);
    this.sunLight.position.set(14, 22, -10);
    this.sunLight.intensity = 1.35;
    this.sunLight.castShadow = true;
    this.fillLight.intensity = 0.38;
    this.starField.visible = true;
    this.nightCityBackdrop.visible = false;

    this.floodLights.forEach((spot) => {
      spot.intensity = 15.0;
      spot.visible = true;
    });
    this.floodGlowSprites.forEach((sp) => {
      sp.visible = true;
    });
  }

  private createFloodlightGlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.25, 'rgba(210, 240, 255, 0.78)');
    grad.addColorStop(0.6, 'rgba(120, 190, 255, 0.22)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }
}
