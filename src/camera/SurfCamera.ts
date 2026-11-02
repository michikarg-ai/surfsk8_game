import * as THREE from 'three';
import { SurfskateController } from '../physics/SurfskateController';

export type AspectMode = '16:9' | '9:16';
export type CameraStyle = 'follow' | 'filmer' | 'mural';

export class SurfCamera {
  public camera: THREE.PerspectiveCamera;
  public aspectMode: AspectMode = '16:9';
  public cameraStyle: CameraStyle = 'follow';

  private currentPos = new THREE.Vector3(19.0, 2.4, 5.2);
  private currentLookAt = new THREE.Vector3(12.0, 1.1, 3.2);
  private smoothHeading = 1.38;

  /** 0..1 zoom-in amount used for the SNAP slow-motion moment. */
  private snapZoom = 0;
  private snapZoomTimer = 0;

  /** Camera shake trauma timer & intensity for wipeouts / bails */
  private bailShakeTimer = 0;
  private bailShakeDuration = 0;
  private bailShakeIntensity = 0;

  /** Indy Grab cinematic side-orbit camera state */
  private indyOrbitBlend = 0;
  private indyOrbitAngle = 0;
  private indyOrbitTimer = 0;
  private indyOrbitDuration = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 250);
    this.camera.position.copy(this.currentPos);
  }

  /** Punch the camera in toward the skater for a SNAP. */
  public triggerSnapZoom(duration = 1.3): void {
    this.snapZoomTimer = duration;
  }

  /** Trigger cinematic side-orbit camera sweep for Indy Grab in mid-air. */
  public triggerIndyOrbit(duration = 1.5): void {
    this.indyOrbitDuration = duration;
    this.indyOrbitTimer = duration;
  }

  /** Trigger an impactful camera shake when wiping out / bailing. */
  public triggerBailShake(duration = 0.38, intensity = 0.22): void {
    this.bailShakeDuration = duration;
    this.bailShakeTimer = duration;
    this.bailShakeIntensity = intensity;
  }

  public setAspectRatio(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    // Slightly wider vertical FOV in 9:16 Instagram Reel mode so the board & bowl walls stay framed
    const baseFov = this.aspectMode === '9:16' ? 72 : 60;
    this.camera.fov = baseFov;
    this.camera.updateProjectionMatrix();
  }

  public setCameraStyle(style: CameraStyle): void {
    this.cameraStyle = style;
  }

  public cycleCameraStyle(): CameraStyle {
    const order: CameraStyle[] = ['follow', 'filmer', 'mural'];
    const idx = (order.indexOf(this.cameraStyle) + 1) % order.length;
    this.cameraStyle = order[idx];
    return this.cameraStyle;
  }

  /** Snap camera to a clean starting orientation behind the skater on reset. */
  public reset(ctrl: SurfskateController): void {
    this.snapZoom = 0;
    this.snapZoomTimer = 0;
    this.bailShakeTimer = 0;
    this.indyOrbitBlend = 0;
    this.indyOrbitAngle = 0;
    this.indyOrbitTimer = 0;
    this.smoothHeading = ctrl.heading;
    const forward = new THREE.Vector3(-Math.sin(this.smoothHeading), 0, -Math.cos(this.smoothHeading));
    const dist = this.aspectMode === '9:16' ? 4.3 : 3.85;
    const height = this.aspectMode === '9:16' ? 1.95 : 1.75;
    this.currentPos.copy(ctrl.position).addScaledVector(forward, -dist).add(new THREE.Vector3(0, height, 0));
    this.currentLookAt.copy(ctrl.position).addScaledVector(forward, 1.8).add(new THREE.Vector3(0, 0.85, 0));
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }

  public update(dt: number, ctrl: SurfskateController): void {
    const clampedDt = Math.min(dt, 0.05);

    // SNAP zoom envelope: quick punch-in, hold, smooth release
    this.snapZoomTimer = Math.max(0, this.snapZoomTimer - clampedDt);
    const zoomTarget = this.snapZoomTimer > 0.35 ? 1 : this.snapZoomTimer / 0.35;
    this.snapZoom += (zoomTarget - this.snapZoom) * Math.min(1, (zoomTarget > this.snapZoom ? 10 : 4) * clampedDt);
    const zoomDistScale = 1 - 0.38 * this.snapZoom;

    // Indy Grab cinematic side-orbit camera envelope
    // Active both BEFORE the trick scores (while skater is airborne and initiating the grab)
    // and DURING slow motion (when INDYGRAB scores and slowMoTimer holds)
    if (this.indyOrbitTimer > 0) {
      this.indyOrbitTimer = Math.max(0, this.indyOrbitTimer - clampedDt);
    }

    const isAirGrabbing = !ctrl.isGrounded && (ctrl.indyGrabActive || ctrl.indyGrabAmount > 0.05);
    const isIndyActive = isAirGrabbing || this.indyOrbitTimer > 0;

    let targetBlend = 0;
    let targetAngle = 0;

    if (!ctrl.isGrounded && isIndyActive) {
      if (this.indyOrbitTimer > 0) {
        // During slow-mo: hold full blend, continue smooth orbit sweep through the side profile
        targetBlend = 1.0;
        const slowMoProgress = 1.0 - this.indyOrbitTimer / Math.max(0.01, this.indyOrbitDuration);
        // Sweeps dynamically from ~45 deg (0.78 rad) up to ~65 deg (1.13 rad) during slow motion
        targetAngle = 0.78 + Math.min(1.0, slowMoProgress * 1.1) * 0.35;
      } else {
        // Before slow-mo (during airborne grab wind-up / hold):
        // Sweep camera smoothly into position as skater tucks and reaches for the rail
        targetBlend = Math.min(1.0, ctrl.indyGrabAmount * 1.1);
        const holdProgress = Math.min(1.0, (ctrl.indyGrabHold || 0) / 0.26);
        targetAngle = Math.max(0.35, holdProgress * 0.78);
      }
    } else {
      // Skater touched down or not grabbing: smoothly return camera behind the board
      targetBlend = 0;
      targetAngle = 0;
      this.indyOrbitTimer = 0;
    }

    const blendRate = targetBlend > this.indyOrbitBlend ? 9.0 : 7.0;
    this.indyOrbitBlend += (targetBlend - this.indyOrbitBlend) * Math.min(1, blendRate * clampedDt);

    const angleRate = targetAngle > this.indyOrbitAngle ? 8.0 : 9.0;
    this.indyOrbitAngle += (targetAngle - this.indyOrbitAngle) * Math.min(1, angleRate * clampedDt);

    // Shortest-angle interpolation for heading
    // Stable tracking during pumping: filter out high-frequency left-right wiggles,
    // but catch up quickly during SNAP tricks or sharp 180 kick turns.
    let diff = ctrl.heading - this.smoothHeading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    let headingRate = 2.8;
    if (ctrl.snapActive) {
      headingRate = 8.0;
    } else if (Math.abs(diff) > 1.2) {
      headingRate = Math.min(9.5, 2.8 + (Math.abs(diff) - 1.2) * 4.5);
    }
    this.smoothHeading += diff * Math.min(1, headingRate * clampedDt);

    const forward = new THREE.Vector3(-Math.sin(this.smoothHeading), 0, -Math.cos(this.smoothHeading));
    const right = new THREE.Vector3(Math.cos(this.smoothHeading), 0, -Math.sin(this.smoothHeading));

    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();

    if (this.cameraStyle === 'follow') {
      // Dynamic THPS / Surf Flow Chase Cam
      // Stable during pumping: no lateral sway offset from rapid deck lean,
      // letting the skater carve and pump fluidly inside the frame while camera stays steady.
      const orbitAngle = this.indyOrbitAngle * this.indyOrbitBlend;
      const dist =
        (this.aspectMode === '9:16' ? 4.3 : 3.85) * zoomDistScale * (1 - 0.16 * this.indyOrbitBlend);
      const height =
        (this.aspectMode === '9:16' ? 1.95 : 1.75) *
        (1 - 0.25 * this.snapZoom) *
        (1 - 0.32 * this.indyOrbitBlend) +
        Math.max(0, ctrl.position.y * (0.2 * (1 - 0.75 * this.indyOrbitBlend)));

      // Rotate camera offset from -forward towards +right (toe-side / frontside)
      // At orbitAngle = 0: exactly -forward (standard THPS rear chase cam)
      // At orbitAngle > 0: orbits around the skater toward their frontside / side profile
      const horizDir = forward
        .clone()
        .multiplyScalar(-Math.cos(orbitAngle))
        .addScaledVector(right, Math.sin(orbitAngle));

      targetPos
        .copy(ctrl.position)
        .addScaledVector(horizDir, dist)
        .add(new THREE.Vector3(0, height, 0));

      // Lock look-at target onto skater's chest & grabbed board during the orbit
      const lookDist = 1.8 * (1 - 0.82 * this.indyOrbitBlend);
      const lookHeight = 0.85 * (1 - 0.18 * this.indyOrbitBlend);

      targetLook
        .copy(ctrl.position)
        .addScaledVector(forward, lookDist)
        .add(new THREE.Vector3(0, lookHeight, 0));
    } else if (this.cameraStyle === 'filmer') {
      // Low-angle Fisheye Instagram Filmer Cam riding along the pocket
      const dist = (this.aspectMode === '9:16' ? 2.65 : 2.35) * zoomDistScale * (1 - 0.15 * this.indyOrbitBlend);
      const side = Math.cos(performance.now() * 0.0004) * 1.15 + 0.55 - 0.9 * this.indyOrbitBlend;
      targetPos
        .copy(ctrl.position)
        .addScaledVector(forward, -dist)
        .addScaledVector(right, side)
        .add(new THREE.Vector3(0, 0.72 * (1 - 0.25 * this.indyOrbitBlend), 0));

      targetLook.copy(ctrl.position).add(new THREE.Vector3(0, 0.65, 0));
    } else {
      // 3. Sunset Palm-Tree Mural Showcase Angle
      // Cinematic broadcast rail camera framing the skater with the East Sunset Palm Mural behind.
      // Dynamic dolly & minimum distance buffer ensures the skater is NEVER lost or clipped through.
      const railX = THREE.MathUtils.clamp(ctrl.position.x - 4.6, 6.0, 11.8);
      const railZ = THREE.MathUtils.clamp(ctrl.position.z + 0.6 + Math.sin(performance.now() * 0.0004) * 0.8, -1.0, 8.5);
      const baseHeight = Math.max(1.85, ctrl.position.y + (this.aspectMode === '9:16' ? 2.1 : 1.75));

      targetPos.set(railX, baseHeight, railZ);

      // Always focus cleanly on the skater's upper torso so they remain perfectly framed
      targetLook.copy(ctrl.position).add(new THREE.Vector3(0, 0.78, 0));

      // Enforce safe minimum distance buffer:
      // If the skater skates directly toward or past the camera rail, smoothly dolly back & crane up
      const toCam = targetPos.clone().sub(ctrl.position);
      const horizDist = Math.hypot(toCam.x, toCam.z);
      const minDist = this.aspectMode === '9:16' ? 4.4 : 3.8;

      if (horizDist < minDist) {
        const safeDir = horizDist > 0.01
          ? new THREE.Vector2(toCam.x, toCam.z).normalize()
          : new THREE.Vector2(-1, 0); // fallback: step back westward
        targetPos.x = ctrl.position.x + safeDir.x * minDist;
        targetPos.z = ctrl.position.z + safeDir.y * minDist;
        // Crane up smoothly when close to give a clean overhead/downward view of the bowl
        targetPos.y += (minDist - horizDist) * 0.55;
      }
    }

    // Prevent camera from clipping below the concrete surface
    const groundY = ctrl.currentSurface.height + 0.42;
    if (targetPos.y < groundY) targetPos.y = groundY;

    // Smooth position & look-at lerp for steady chase cam feel
    const posLerpRate = this.indyOrbitBlend > 0.05 ? 12.0 : this.cameraStyle === 'follow' ? 8.5 : 14.0;
    const lookLerpRate = this.indyOrbitBlend > 0.05 ? 14.0 : this.cameraStyle === 'follow' ? 10.0 : 18.0;
    this.currentPos.lerp(targetPos, Math.min(1, posLerpRate * clampedDt));
    this.currentLookAt.lerp(targetLook, Math.min(1, lookLerpRate * clampedDt));

    // Wipeout impact camera shake
    if (this.bailShakeTimer > 0) {
      this.bailShakeTimer = Math.max(0, this.bailShakeTimer - clampedDt);
      const shakeFactor = this.bailShakeTimer / Math.max(0.01, this.bailShakeDuration);
      const s = this.bailShakeIntensity * shakeFactor;
      const shakeX = (Math.random() - 0.5) * s * 2;
      const shakeY = (Math.random() - 0.5) * s * 1.5;
      const shakeZ = (Math.random() - 0.5) * s * 2;
      this.currentPos.add(new THREE.Vector3(shakeX, shakeY, shakeZ));
      this.currentLookAt.add(new THREE.Vector3(shakeX * 0.5, shakeY * 0.5, shakeZ * 0.5));
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);

    // Dynamic FOV boost with speed & Flow Meter (narrowed during a SNAP zoom)
    const baseFov = this.cameraStyle === 'filmer' ? 76 : this.aspectMode === '9:16' ? 70 : 60;
    const speedFovBoost = Math.min(12, ctrl.speed * 0.75);
    const targetFov = (baseFov + speedFovBoost) * (1 - 0.22 * this.snapZoom);
    if (Math.abs(targetFov - this.camera.fov) > 0.05) {
      const fovRate = this.snapZoom > 0.01 ? 14.0 : 6.0;
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, fovRate * clampedDt);
      this.camera.updateProjectionMatrix();
    }
  }
}
