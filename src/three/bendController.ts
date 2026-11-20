import * as THREE from 'three';
import type { BonsaiScene } from './bonsaiScene';
import { SPECIES, gaugeMm, recommendGauge } from '../core/species';
import { ancestorChain } from '../core/skeleton';
import { chainBendRadius } from '../core/pose';
import { checkBendRadius } from '../core/simulation';

export interface BendStatus {
  nodeId: number;
  actualR: number;
  minR: number;
  ok: boolean;
  recommendedGauge: number;
}

/**
 * 拖枝交互：
 * - 点中骨架节点 -> 以该节点到根的链为弯枝区
 * - 鼠标位移转世界空间最短弧旋转，按余弦权重摊到链上各关节（无滚动、不扭麻花）
 * - 实时算当前曲率半径，低于树种安全阈值即标红
 */
export class BendController {
  private dragging = false;
  private grabbed = -1;
  private chain: number[] = [];
  private weights: number[] = [];
  private plane = new THREE.Plane();
  private hit = new THREE.Vector3();
  private startHit = new THREE.Vector3();
  private pivot = new THREE.Vector3();
  private ndc = new THREE.Vector2();
  onStatus?: (s: BendStatus | null) => void;
  onFirstPick?: (nodeId: number) => void;

  constructor(private scene: BonsaiScene, private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
  }

  private toNDC(e: PointerEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return this.ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private down = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const id = this.scene.pickNode(this.toNDC(e));
    if (id < 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.grabbed = id;
    this.onFirstPick?.(id);
    this.chain = ancestorChain(this.scene.tree.skeleton, id);
    // 余弦权重：越靠近抓取点越吃旋转，根部几乎不动
    const n = this.chain.length;
    this.weights = this.chain.map((_, i) => {
      const x = 1 - i / n; // 抓取点=1，根=0
      return x * x;
    });
    const sum = this.weights.reduce((a, b) => a + b, 0) || 1;
    this.weights = this.weights.map((w) => w / sum);

    this.pivot.copy(this.scene.pose.worldPos[this.chain[this.chain.length - 1]]);
    const grabW = this.scene.pose.worldPos[id];
    // 拖拽平面：过抓取点、面向相机
    this.plane.setFromNormalAndCoplanarPoint(
      this.scene.camera.getWorldDirection(new THREE.Vector3()).negate(),
      grabW,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.toNDC(e), this.scene.camera);
    ray.ray.intersectPlane(this.plane, this.hit);
    this.startHit.copy(this.hit);
    this.scene.controls.enabled = false;
    this.scene.setBendCheckNode(id);
  };

  private move = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.toNDC(e), this.scene.camera);
    if (!ray.ray.intersectPlane(this.plane, this.hit)) return;

    const a = this.startHit.clone().sub(this.pivot).normalize();
    const b = this.hit.clone().sub(this.pivot).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(a, b);
    // 每帧从静止编辑量起步：记录上一帧增量做差分
    this.applyIncremental(delta);
    this.startHit.copy(this.hit);
    this.emitStatus();
  };

  private lastDelta = new THREE.Quaternion();

  private applyIncremental(delta: THREE.Quaternion): void {
    // delta 是相对初始抓取方向的累计旋转；本帧增量 = delta × 上一帧 delta 的逆
    const inc = delta.clone().multiply(this.lastDelta.clone().invert());
    this.lastDelta.copy(delta);
    this.scene.pose.applyBend(this.chain, this.weights, inc);
  }

  private up = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.lastDelta.identity();
    this.scene.controls.enabled = true;
    this.scene.setBendCheckNode(-1);
    // 固化编辑姿态到方案
    const plan = this.scene.plan;
    plan.editRot = this.scene.pose.saveEdits();
    void this.scene;
    this.onStatus?.(null);
  };

  private emitStatus(): void {
    const { radius } = chainBendRadius(this.scene.pose, this.chain);
    const check = checkBendRadius(this.scene.tree, this.chain, radius === Infinity ? 1e9 : radius);
    const thickestNode = this.chain.reduce((m, id) =>
      this.scene.tree.skeleton.nodes[id].radius > this.scene.tree.skeleton.nodes[m].radius ? id : m,
    this.chain[0]);
    const mat = this.scene.plan.wires[0]?.spec.material ?? 'aluminum';
    this.onStatus?.({
      nodeId: this.grabbed,
      actualR: radius,
      minR: check.minRadius,
      ok: check.ok,
      recommendedGauge: recommendGauge(this.scene.tree.skeleton.nodes[thickestNode].radius, mat),
    });
  }
}

/** 构造一条缠丝 span（骨架页/蟠扎页共用） */
export function buildSpanFromChain(
  chainIds: number[],
  opts: { reverseAt: number[]; forkPath?: number[]; direction: 1 | -1; phase: number; anchor: number },
) {
  const path = [...chainIds].reverse(); // 根->梢
  return {
    anchorNode: opts.anchor,
    path,
    endNode: path[path.length - 1],
    reverseAt: opts.reverseAt,
    forkPath: opts.forkPath,
    direction: opts.direction,
    phase: opts.phase,
  };
}

export function gaugeInfo(gauge: number): string {
  return `${gauge} 号 / Ø${gaugeMm(gauge)}mm`;
}

export function speciesFlexibilityHint(speciesId: keyof typeof SPECIES): string {
  const sp = SPECIES[speciesId];
  return `最小弯曲半径 ≈ ${sp.flexibility} × 枝径`;
}
