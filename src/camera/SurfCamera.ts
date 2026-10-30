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

  constructor() {
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 250);
    this.camera.position.copy(this.currentPos);
  }

  /** Punch the camera in toward the skater for a SNAP. */
  public triggerSnapZoom(duration = 1.3): void {
    this.snapZoomTimer = duration;
  }

  public setAspectRatio(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    // Slightly wider vertical FOV in 9:16 Instagram Reel mode so the board & bowl walls stay framed
    const baseFov = this.aspectMode === '9:16' ? 72 : 60;
    this.camera.fov = baseFov;
    this.camera.updateProjectionMatrix();
  }

  public cycleCameraStyle(): CameraStyle {
    const order: CameraStyle[] = ['follow', 'filmer', 'mural'];
    const idx = (order.indexOf(this.cameraStyle) + 1) % order.length;
    this.cameraStyle = order[idx];
    return this.cameraStyle;
  }

  public update(dt: number, ctrl: SurfskateController): void {
    const clampedDt = Math.min(dt, 0.05);

    // SNAP zoom envelope: quick punch-in, hold, smooth release
    this.snapZoomTimer = Math.max(0, this.snapZoomTimer - clampedDt);
    const zoomTarget = this.snapZoomTimer > 0.35 ? 1 : this.snapZoomTimer / 0.35;
    this.snapZoom += (zoomTarget - this.snapZoom) * Math.min(1, (zoomTarget > this.snapZoom ? 10 : 4) * clampedDt);
    const zoomDistScale = 1 - 0.38 * this.snapZoom;

    // Shortest-angle interpolation for heading (snappy tracking so turns feel immediate!)
    let diff = ctrl.heading - this.smoothHeading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.smoothHeading += diff * Math.min(1, 11.5 * clampedDt);

    const forward = new THREE.Vector3(-Math.sin(this.smoothHeading), 0, -Math.cos(this.smoothHeading));
    const right = new THREE.Vector3(Math.cos(this.smoothHeading), 0, -Math.sin(this.smoothHeading));

    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();

    if (this.cameraStyle === 'follow') {
      // Dynamic THPS / Surf Flow Chase Cam
      const dist = (this.aspectMode === '9:16' ? 4.3 : 3.85) * zoomDistScale;
      const height = (this.aspectMode === '9:16' ? 1.95 : 1.75) * (1 - 0.25 * this.snapZoom);
      const carveSideOffset = Math.sin(ctrl.leanAngle) * 0.65;

      targetPos
        .copy(ctrl.position)
        .addScaledVector(forward, -dist)
        .addScaledVector(right, carveSideOffset)
        .add(new THREE.Vector3(0, height + Math.max(0, ctrl.position.y * 0.2), 0));

      targetLook
        .copy(ctrl.position)
        .addScaledVector(forward, 2.2)
        .add(new THREE.Vector3(0, 0.85, 0));
    } else if (this.cameraStyle === 'filmer') {
      // Low-angle Fisheye Instagram Filmer Cam riding along the pocket
      const dist = (this.aspectMode === '9:16' ? 2.65 : 2.35) * zoomDistScale;
      const side = Math.cos(performance.now() * 0.0004) * 1.15 + 0.55;
      targetPos
        .copy(ctrl.position)
        .addScaledVector(forward, -dist)
        .addScaledVector(right, side)
        .add(new THREE.Vector3(0, 0.72, 0));

      targetLook.copy(ctrl.position).add(new THREE.Vector3(0, 0.72, 0));
    } else {
      // Sunset Palm-Tree Mural Showcase Angle (frames the skater with the East Sunset Palm Mural behind)
      targetPos.set(11.8, 1.45, 3.8 + Math.sin(performance.now() * 0.0005) * 1.4);
      targetLook.copy(ctrl.position).lerp(new THREE.Vector3(20.5, 1.55, 4.6), 0.38);
    }

    // Prevent camera from clipping below the concrete surface
    const groundY = ctrl.currentSurface.height + 0.42;
    if (targetPos.y < groundY) targetPos.y = groundY;

    this.currentPos.lerp(targetPos, Math.min(1, 14.0 * clampedDt));
    this.currentLookAt.lerp(targetLook, Math.min(1, 18.0 * clampedDt));

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
