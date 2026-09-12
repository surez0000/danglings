import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  OrthographicCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DPR_CAP, HANG_ANCHOR_FRAC, SEAT_ANCHOR_FRAC, type CompanionAttach } from "./types";
import type { BirdPose } from "./birdBehavior";

export type { BirdPose };

/* This module statically imports three + loaders and is ONLY ever reached via
   dynamic import (from BirdCompanion), so Vite splits it into its own chunk and
   charm-only users never parse three.js. */

export type SceneDims = { canvasW: number; canvasH: number; modelPx: number };

export type CompanionSceneOpts = SceneDims & {
  url: string;
  attach: CompanionAttach;
};

export type BirdScene = {
  /* Load a (new) model and retarget the frustum/pivot. The renderer, lights and
     environment persist — swapping a companion or color variant must NOT
     rebuild the GL world: a full rebuild (renderer + PMREM + full shader
     recompile) stalls the main thread ~1s, and with the picker holding the
     whole overlay window interactive, that stall eats every click on the
     screen. Latest-wins: concurrent calls resolve, only the newest applies. */
  configure(opts: CompanionSceneOpts): Promise<void>;
  setPose(p: BirdPose): void;
  render(): void;
  setSize(dims: SceneDims, dpr: number): void;
  dispose(): void;
};

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function buildRenderer(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): WebGLRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(dpr, DPR_CAP));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  /* Filmic tone mapping gives the toy-like contrast and color punch that flat
     NoToneMapping lacks under IBL; slight exposure lift keeps mids bright. */
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  return renderer;
}

/* The model is normalized to height 1 with feet at world y=0. The ortho window
   is derived so the attach point (feet for seat mode, rope-top y=1 for hang
   mode) lands at the same canvas fraction the CSS placement uses. */
function applyFrustum(camera: OrthographicCamera, attach: CompanionAttach, dims: SceneDims) {
  const worldH = dims.canvasH / dims.modelPx;
  const attachY = attach === "seat" ? 0 : 1;
  const frac = attach === "seat" ? SEAT_ANCHOR_FRAC : HANG_ANCHOR_FRAC;
  const worldTop = attachY + frac * worldH;
  const halfH = worldH / 2;
  const halfW = halfH * (dims.canvasW / dims.canvasH);
  const centerY = worldTop - halfH;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.position.set(0, centerY, 10);
  camera.lookAt(0, centerY, 0);
  camera.updateProjectionMatrix();
}

function forEachMaterial(root: Object3D, fn: (m: Material) => void) {
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      const mat = obj.material as Material | Material[];
      if (Array.isArray(mat)) mat.forEach(fn);
      else fn(mat);
    }
  });
}

function disposeRoot(root: Object3D) {
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      const mat = obj.material as Material | Material[];
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        // Material.dispose() does not free its textures.
        for (const value of Object.values(m)) {
          if (value && typeof value === "object" && "isTexture" in value) {
            (value as { dispose(): void }).dispose();
          }
        }
        m.dispose();
      }
    }
  });
}

export async function createBirdScene(canvas: HTMLCanvasElement): Promise<BirdScene> {
  let dims: SceneDims = { canvasW: 2, canvasH: 2, modelPx: 1 };
  let attach: CompanionAttach = "seat";
  let pivotY = 0;
  let dpr = window.devicePixelRatio || 1;
  let renderer = buildRenderer(canvas, dims.canvasW, dims.canvasH, dpr);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 30);

  /* Image-based environment lighting: PBR materials (especially anything with
     metalness) render dark and muddy under punctual lights alone. Regenerated
     only when the GL context is rebuilt. */
  let envTexture: Texture | null = null;
  const applyEnvironment = () => {
    envTexture?.dispose();
    const pmrem = new PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = envTexture;
  };
  applyEnvironment();
  scene.environmentIntensity = 0.55;

  /* Contrast comes from directionality: a restrained environment for base fill,
     a strong warm key for form shading, and a cool low rim to pop the
     silhouette. No shadows — the companion hangs mid-air. */
  scene.add(new HemisphereLight(0xbfd8ff, 0x8a7a66, 0.35));
  const sun = new DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(1.8, 2.4, 2);
  scene.add(sun);
  const rim = new DirectionalLight(0xa8c8ff, 0.7);
  rim.position.set(-2, 0.6, -2.5);
  scene.add(rim);

  /* Pose rotations pivot around the attach point (birdGroup.position.y); the
     model inside is offset so a hang model swings from its rope top rather
     than its feet. */
  const birdGroup = new Group();
  scene.add(birdGroup);
  let currentModel: Object3D | null = null;
  let pose: BirdPose = { yaw: 0, pitch: 0, roll: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

  let disposed = false;
  let configureToken = 0;

  const applyPose = () => {
    birdGroup.rotation.set(pose.pitch, pose.yaw, pose.roll);
    birdGroup.position.y = pivotY + pose.offsetY;
    birdGroup.scale.set(pose.scaleX, pose.scaleY, pose.scaleX);
  };

  /* WKWebView loses the GL context on GPU switches / memory pressure. Keep the
     canvas alive (preventDefault), then rebuild the renderer on restore — the
     scene graph survives, only GL resources are recreated. */
  const onContextLost = (e: Event) => e.preventDefault();
  const onContextRestored = () => {
    if (disposed) return;
    renderer.dispose();
    renderer = buildRenderer(canvas, dims.canvasW, dims.canvasH, dpr);
    applyEnvironment();
    if (currentModel) {
      forEachMaterial(currentModel, (m) => {
        m.needsUpdate = true;
      });
    }
    renderer.render(scene, camera);
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  return {
    async configure(opts: CompanionSceneOpts) {
      const token = ++configureToken;
      await MeshoptDecoder.ready;
      const gltf = await loader.loadAsync(opts.url);
      if (disposed || token !== configureToken) {
        // A newer configure superseded this one while the model was loading.
        disposeRoot(gltf.scene);
        return;
      }

      /* Normalize: uniform-scale to bbox height 1.0, feet (min y) at the
         origin, x/z centered — the frustum math assumes exactly this. */
      const model = gltf.scene;
      const box = new Box3().setFromObject(model);
      const extent = new Vector3();
      box.getSize(extent);
      model.scale.setScalar(1 / (extent.y || 1));
      model.updateMatrixWorld(true);
      box.setFromObject(model);
      const center = new Vector3();
      box.getCenter(center);
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;

      attach = opts.attach;
      pivotY = attach === "seat" ? 0 : 1;
      model.position.y -= pivotY;

      if (currentModel) {
        birdGroup.remove(currentModel);
        disposeRoot(currentModel);
      }
      currentModel = model;
      birdGroup.add(model);

      dims = { canvasW: opts.canvasW, canvasH: opts.canvasH, modelPx: opts.modelPx };
      renderer.setSize(dims.canvasW, dims.canvasH, false);
      applyFrustum(camera, attach, dims);
      applyPose();
      renderer.render(scene, camera);
    },
    setPose(p: BirdPose) {
      pose = p;
      applyPose();
    },
    render() {
      renderer.render(scene, camera);
    },
    setSize(nextDims: SceneDims, nextDpr: number) {
      dims = nextDims;
      dpr = nextDpr;
      renderer.setPixelRatio(Math.min(dpr, DPR_CAP));
      renderer.setSize(dims.canvasW, dims.canvasH, false);
      applyFrustum(camera, attach, dims);
    },
    dispose() {
      disposed = true;
      configureToken++;
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (currentModel) disposeRoot(currentModel);
      envTexture?.dispose();
      renderer.dispose();
    },
  };
}
