import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Plan, TreeRecord } from '../core/types';
import { SPECIES } from '../core/species';
import { computeRest, type RestData } from '../core/skeleton';
import { PoseState, chainBendRadius } from '../core/pose';
import { radiiAtYear } from '../core/simulation';
import { TreeMeshBuilder, MAT_DEAD, MAT_LIVE, MAT_WOUND } from './meshBuilder';
import { WireMeshBuilder } from './wireBuilder';
import { FoliageSystem, generateAnchors } from './foliage';

export interface RebuildStats {
  vertices: number;
  triangles: number;
  contactGap: number;
  contactPen: number;
  ms: number;
}

const TMP_M = new THREE.Matrix4();

/** 一棵桩 + 一个方案的完整 three 场景 */
export class BonsaiScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  pose: PoseState;
  rest: RestData;
  tree: TreeRecord;
  plan: Plan;
  private treeMesh: THREE.SkinnedMesh | null = null;
  private wireMesh: THREE.SkinnedMesh | null = null;
  foliage: FoliageSystem | null = null;
  private skeleton: THREE.Skeleton | null = null;
  private dummyBones: THREE.Bone[] = [];
  private violationMarkers: THREE.Mesh[] = [];
  private potGroup: THREE.Group | null = null;
  private rimLight: THREE.DirectionalLight;
  private keyLight: THREE.DirectionalLight;
  private raf = 0;
  onViolation?: (text: string | null) => void;
  onFrame?: () => void;
  private bendCheckNode = -1;
  private ground: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement, tree: TreeRecord, plan: Plan) {
    this.tree = tree;
    this.plan = plan;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.camera.position.set(28, 22, 34);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 12, 0);

    this.scene.background = new THREE.Color(0x1c2128);
    this.scene.fog = new THREE.Fog(0x1c2128, 90, 220);

    this.keyLight = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.keyLight.position.set(24, 36, 18);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.keyLight);
    this.rimLight = new THREE.DirectionalLight(0x9fc0ff, 1.1);
    this.rimLight.position.set(-20, 16, -26);
    this.scene.add(this.rimLight);
    this.scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x3a2f24, 0.7));

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 48),
      new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.rest = computeRest(tree.skeleton);
    this.pose = new PoseState(tree.skeleton, this.rest);
    this.pose.loadPlan(plan);
  }

  /** 结构重建：修剪/舍利/年度生长/丝变化后调用 */
  rebuild(): RebuildStats {
    const t0 = performance.now();
    this.disposeTree();
    const radii = radiiAtYear(this.tree, this.plan);

    // 1) 树皮网格
    const builder = new TreeMeshBuilder(this.tree.skeleton, this.rest, this.plan, radii);
    const built = builder.build();

    // 2) 蒙皮骨架（一棵共享 Skeleton，bone 顺序严格按 rest.order）。
    // 游离 bone（不挂场景图）；绑定逆矩阵全部 identity，
    // 每帧直接把完整调色板 world×bindInverse 写进 bone.matrixWorld，
    // skeleton.update() 计算 matrixWorld × identity = 调色板本身。
    this.dummyBones = this.rest.order.map(() => new THREE.Bone());
    this.dummyBones.forEach((b) => {
      b.matrixAutoUpdate = false;
    });
    const inverses: THREE.Matrix4[] = this.rest.order.map(() => new THREE.Matrix4());
    this.skeleton = new THREE.Skeleton(this.dummyBones, inverses);
    const sp = SPECIES[this.tree.species];
    const barkMat = new THREE.MeshStandardMaterial({
      color: sp.barkColor,
      roughness: 0.92,
      metalness: 0,
    });
    const deadMat = new THREE.MeshStandardMaterial({
      color: 0xe8e2d4,
      roughness: 0.98,
      metalness: 0,
    });
    const woundMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 1 });
    const geo = built.geometry;
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(built.weights, 4));
    const boneIndexById = new Map<number, number>();
    this.rest.order.forEach((id, i) => boneIndexById.set(id, i));
    remapSkinIndex(built.skinIndex, boneIndexById);
    // skinIndex 在着色器里是 vec4，必须用归一化无符号整型属性
    const treeSkin = new Uint16Array(built.skinIndex.length);
    built.skinIndex.forEach((v, i) => (treeSkin[i] = v));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(treeSkin, 4));
    this.treeMesh = new THREE.SkinnedMesh(geo, [barkMat, deadMat, woundMat]);
    this.treeMesh.castShadow = true;
    this.treeMesh.receiveShadow = true;
    // 显式 identity 绑定矩阵：阻止 bind() 调 calculateInverses() 冲掉预设绑定逆矩阵；
    // mesh 位于场景原点，Attached 模式下 bindMatrixInverse 也是 identity，无额外变换
    this.treeMesh.bind(this.skeleton, new THREE.Matrix4());
    this.treeMesh.bindMode = THREE.AttachedBindMode;
    this.treeMesh.frustumCulled = false;
    this.scene.add(this.treeMesh);

    // 3) 缠丝
    const wireBuilt = new WireMeshBuilder(this.tree.skeleton, this.rest, built.edgeRadius).buildAll(
      this.plan.wires,
    );
    if (wireBuilt.geometry.getAttribute('position')?.count) {
      wireBuilt.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(wireBuilt.weights, 4));
      remapSkinIndex(wireBuilt.skinIndex, boneIndexById);
      const wireSkin = new Uint16Array(wireBuilt.skinIndex.length);
      wireBuilt.skinIndex.forEach((v, i) => (wireSkin[i] = v));
      wireBuilt.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(wireSkin, 4));
      const wireMat = new THREE.MeshStandardMaterial({
        color: this.plan.wires.find((w) => w.active)?.spec.material === 'copper' ? 0xb87333 : 0xcfd3d8,
        roughness: 0.35,
        metalness: 0.85,
      });
      this.wireMesh = new THREE.SkinnedMesh(wireBuilt.geometry, wireMat);
      this.wireMesh.bind(this.skeleton, new THREE.Matrix4());
      this.wireMesh.bindMode = THREE.AttachedBindMode;
      this.wireMesh.frustumCulled = false;
      this.scene.add(this.wireMesh);
      this.lastContact = { gap: wireBuilt.contact.maxGap, pen: wireBuilt.contact.maxPenetration };
    }

    // 4) 叶簇
    const anchors = generateAnchors(this.tree.skeleton, this.rest, sp.foliage, plan0(this.plan), 7);
    this.foliage = new FoliageSystem(anchors, sp.foliage, 0x4e7a3f);
    this.foliage.setPrunedNodes(Object.keys(this.plan.pruned).map(Number));
    for (const padId of this.plan.defoliated) this.foliage.defoliatePad(this.tree.skeleton, padId, true);
    this.scene.add(this.foliage.mesh);

    this.buildPot();
    this.pose.loadPlan(this.plan);
    this.pose.update();
    this.syncBones();
    this.foliage?.update(this.pose, this.plan);

    const stats: RebuildStats = {
      vertices: built.stats.vertices,
      triangles: built.stats.triangles,
      contactGap: this.lastContact?.gap ?? 0,
      contactPen: this.lastContact?.pen ?? 0,
      ms: performance.now() - t0,
    };
    this.lastStats = stats;
    return stats;
  }

  /** 最近一次结构重建的统计（接触诊断面板用） */
  lastStats: RebuildStats | null = null;

  private lastContact = { gap: 0, pen: 0 };

  private buildPot(): void {
    if (this.potGroup) {
      this.scene.remove(this.potGroup);
      this.potGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    const pot = this.plan.pot;
    if (pot.style === 'none') return;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: pot.color, roughness: 0.7, metalness: 0.1 });
    const w = pot.width;
    let potMesh: THREE.Mesh;
    if (pot.style === 'round') {
      potMesh = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.42, w * 0.32, 32, 1, true), mat);
    } else if (pot.style === 'cascade') {
      potMesh = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.34, w * 0.5, 32, 1, true), mat);
    } else if (pot.style === 'slab') {
      potMesh = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.1, w * 0.6), mat);
    } else {
      potMesh = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.34, w * 0.72), mat);
    }
    potMesh.position.y = -w * 0.17;
    potMesh.castShadow = true;
    potMesh.receiveShadow = true;
    g.add(potMesh);
    // 几架
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.15, 0.8, w * 0.85),
      new THREE.MeshStandardMaterial({ color: 0x4a3323, roughness: 0.8 }),
    );
    stand.position.y = -w * 0.34 - 0.6;
    stand.castShadow = true;
    g.add(stand);
    g.position.y = 0.2;
    this.potGroup = g;
    this.scene.add(g);
  }

  /**
   * 每帧把完整 FK 调色板（world × bindInverse）写进游离 bone 的 matrixWorld。
   * boneInverse 为 identity，skeleton.update() 原样保留该调色板供 GPU 蒙皮。
   */
  private syncBones(): void {
    if (!this.skeleton) return;
    for (let i = 0; i < this.rest.order.length; i++) {
      const id = this.rest.order[i];
      this.dummyBones[i].matrixWorld.copy(this.pose.skinPalette[id]);
    }
    this.skeleton.update();
  }

  start(): void {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.controls.update();
      this.pose.update();
      this.syncBones();
      this.foliage?.update(this.pose, this.plan);
      this.checkLiveBend();
      this.onFrame?.();
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setBendCheckNode(id: number): void {
    this.bendCheckNode = id;
  }

  private checkLiveBend(): void {
    if (this.bendCheckNode < 0 || !this.onViolation) return;
    const chain: number[] = [];
    let cur = this.bendCheckNode;
    while (cur >= 0) {
      chain.push(cur);
      cur = this.tree.skeleton.nodes[cur].parent;
    }
    const { radius } = chainBendRadius(this.pose, chain);
    const sp = SPECIES[this.tree.species];
    let thickest = 0;
    for (const id of chain) thickest = Math.max(thickest, this.tree.skeleton.nodes[id].radius * 2);
    const minR = sp.flexibility * thickest;
    if (radius < minR) {
      this.onViolation(`⚠ 弯曲半径 ${radius.toFixed(1)}cm < 最小安全半径 ${minR.toFixed(1)}cm，继续弯会劈裂`);
      this.flashViolation(chain, true);
    } else {
      this.onViolation(null);
      this.flashViolation(chain, false);
    }
  }

  private flashViolation(chain: number[], bad: boolean): void {
    // 用辅助球标记超标的关节
    if (bad && this.violationMarkers.length === 0) {
      for (const id of chain) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(this.tree.skeleton.nodes[id].radius * 1.05, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.55 }),
        );
        this.violationMarkers.push(m);
        this.scene.add(m);
      }
    }
    if (!bad && this.violationMarkers.length) {
      for (const m of this.violationMarkers) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
      this.violationMarkers = [];
    }
    for (const m of this.violationMarkers) {
      const id = chain[this.violationMarkers.indexOf(m)];
      if (id === undefined) continue;
      m.position.copy(this.pose.worldPos[id]);
    }
  }

  /** 侧光（观赏面检查用） */
  setRimLight(azimuthDeg: number, intensity: number): void {
    const a = THREE.MathUtils.degToRad(azimuthDeg);
    this.rimLight.position.set(Math.cos(a) * 30, 14, Math.sin(a) * 30);
    this.rimLight.intensity = intensity;
  }

  setFrontAzimuth(deg: number): void {
    this.plan.frontAzimuth = deg;
    const a = THREE.MathUtils.degToRad(deg);
    const r = Math.hypot(this.camera.position.x, this.camera.position.z);
    this.camera.position.set(Math.sin(a) * r, this.camera.position.y, Math.cos(a) * r);
    this.controls.update();
  }

  /** 剪影模式：背光 + 黑色树体 */
  setSilhouette(on: boolean): void {
    if (on) {
      this.scene.background = new THREE.Color(0xdfe6ee);
      this.keyLight.intensity = 0.4;
      this.rimLight.intensity = 2.6;
      this.treeMesh?.material instanceof Array &&
        this.treeMesh.material.forEach((m) => ((m as THREE.MeshStandardMaterial).color.set(0x111111)));
      this.foliage && ((this.foliage.mesh.material as THREE.MeshStandardMaterial).color.set(0x111111));
    } else {
      this.scene.background = new THREE.Color(0x1c2128);
      this.keyLight.intensity = 2.2;
      this.rimLight.intensity = 1.1;
      const sp = SPECIES[this.tree.species];
      if (this.treeMesh) {
        const mats = this.treeMesh.material as THREE.Material[];
        (mats[MAT_LIVE] as THREE.MeshStandardMaterial).color.set(sp.barkColor);
        (mats[MAT_DEAD] as THREE.MeshStandardMaterial).color.set(0xe8e2d4);
        (mats[MAT_WOUND] as THREE.MeshStandardMaterial).color.set(0x8a5a3c);
      }
      this.foliage && ((this.foliage.mesh.material as THREE.MeshStandardMaterial).color.set(0x4e7a3f));
    }
  }

  /** 诊断：当前姿态下丝-皮间隙（通过共享蒙皮的构造保证 ≈ 静止残差） */
  getContactReport() {
    return this.lastContact;
  }

  raycast(ndc: THREE.Vector2): THREE.Intersection[] {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    if (this.treeMesh) targets.push(this.treeMesh);
    if (this.wireMesh) targets.push(this.wireMesh);
    return ray.intersectObjects(targets, false);
  }

  /** 屏幕点 -> 最近骨架节点 */
  pickNode(ndc: THREE.Vector2): number {
    const hits = this.raycast(ndc);
    if (!hits.length) return -1;
    // 取命中点最近的骨架关节
    const p = hits[0].point;
    let best = -1;
    let bd = Infinity;
    for (const id of this.rest.order) {
      const d = this.pose.worldPos[id].distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  /** 当前主干倾角（相对垂直，度） */
  trunkTilt(): number {
    const root = this.rest.order[0];
    const top = this.findTrunkTip(root);
    const d = this.pose.worldPos[top].clone().sub(this.pose.worldPos[root]);
    return THREE.MathUtils.radToDeg(d.angleTo(new THREE.Vector3(0, 1, 0)));
  }

  private findTrunkTip(id: number): number {
    const kids = this.tree.skeleton.nodes[id].children.filter(
      (c) => this.tree.skeleton.nodes[c].type === 'trunk',
    );
    if (!kids.length) return id;
    return this.findTrunkTip(kids[0]);
  }

  /** 联动相机（多方案对比） */
  syncCameraFrom(other: BonsaiScene): void {
    this.camera.position.copy(other.camera.position);
    this.camera.quaternion.copy(other.camera.quaternion);
    this.controls.target.copy(other.controls.target);
    this.controls.update();
  }

  private disposeTree(): void {
    for (const m of [this.treeMesh, this.wireMesh]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((x) => x.dispose());
    }
    this.treeMesh = null;
    this.wireMesh = null;
    this.skeleton = null;
    this.foliage?.dispose();
    this.foliage = null;
    for (const m of this.violationMarkers) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.violationMarkers = [];
  }

  dispose(): void {
    this.stop();
    this.disposeTree();
    this.renderer.dispose();
    TMP_M.identity();
  }
}

function plan0(plan: Plan): number {
  return plan.foliageDensity || 1;
}

/** 几何里的节点 id 蒙皮索引 -> Skeleton 的 bone 序索引 */
function remapSkinIndex(arr: Uint32Array, map: Map<number, number>): void {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = map.get(arr[i]) ?? 0;
  }
}
