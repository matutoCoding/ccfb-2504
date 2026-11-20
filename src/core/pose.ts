import * as THREE from 'three';
import type { Plan, Skeleton } from './types';
import type { RestData } from './skeleton';

const IDENTITY = new THREE.Quaternion();

/**
 * 姿态状态：静止骨架 + 每节点编辑四元数（局部空间，左乘静止局部旋转）。
 * 每帧只做 O(n) 四元数/矩阵运算，3000 节点亚毫秒级。
 */
export class PoseState {
  readonly sk: Skeleton;
  readonly rest: RestData;
  readonly count: number;
  /** 当前编辑旋转（局部空间） */
  readonly editQuat: THREE.Quaternion[];
  /** 本帧姿态世界量 */
  readonly worldQuat: THREE.Quaternion[];
  readonly worldPos: THREE.Vector3[];
  readonly worldMatrix: THREE.Matrix4[];
  /** 蒙皮调色板 world * bindInverse */
  readonly skinPalette: THREE.Matrix4[];
  private _v = new THREE.Vector3();
  private _s = new THREE.Vector3(1, 1, 1);
  private _q = new THREE.Quaternion();

  constructor(sk: Skeleton, rest: RestData) {
    this.sk = sk;
    this.rest = rest;
    this.count = sk.nodes.length;
    this.editQuat = Array.from({ length: this.count }, () => new THREE.Quaternion());
    this.worldQuat = Array.from({ length: this.count }, () => new THREE.Quaternion());
    this.worldPos = Array.from({ length: this.count }, () => new THREE.Vector3());
    this.worldMatrix = Array.from({ length: this.count }, () => new THREE.Matrix4());
    this.skinPalette = Array.from({ length: this.count }, () => new THREE.Matrix4());
  }

  /** 从方案载入编辑姿态 */
  loadPlan(plan: Plan): void {
    for (let i = 0; i < this.count; i++) this.editQuat[i].identity();
    for (const [k, v] of Object.entries(plan.editRot)) {
      const id = Number(k);
      if (id < this.count) this.editQuat[id].fromArray(v);
    }
  }

  /** 序列化回方案 */
  saveEdits(): Record<number, [number, number, number, number]> {
    const out: Record<number, [number, number, number, number]> = {};
    for (let i = 0; i < this.count; i++) {
      const q = this.editQuat[i];
      if (1 - q.w > 1e-6 || q.x !== 0 || q.y !== 0 || q.z !== 0) {
        out[i] = [q.x, q.y, q.z, q.w];
      }
    }
    return out;
  }

  /** 每帧前向运动学 */
  update(): void {
    const { sk, rest } = this;
    for (const id of rest.order) {
      const node = sk.nodes[id];
      this._q.multiplyQuaternions(this.editQuat[id], rest.localQuat[id]);
      if (node.parent >= 0) {
        this.worldQuat[id].multiplyQuaternions(this.worldQuat[node.parent], this._q);
        this.worldPos[id]
          .copy(this.worldPos[node.parent])
          .add(this._v.fromArray(node.pos).applyQuaternion(this.worldQuat[node.parent]));
      } else {
        this.worldQuat[id].copy(this._q);
        this.worldPos[id].set(0, 0, 0);
      }
      this.worldMatrix[id].compose(this.worldPos[id], this.worldQuat[id], this._s);
      this.skinPalette[id].multiplyMatrices(this.worldMatrix[id], rest.bindInverse[id]);
    }
  }

  /**
   * 在关节上叠加一个世界空间的最短弧旋转（无滚动）。
   * d 为期望世界旋转，转换到该关节父级静止世界标架的局部编辑量后左乘。
   */
  applyWorldDelta(id: number, d: THREE.Quaternion): void {
    const parent = this.sk.nodes[id].parent;
    const parentRestWorldQ = parent >= 0 ? this.rest.worldQuat[parent] : IDENTITY;
    const local = this._q.copy(parentRestWorldQ).invert().multiply(d).multiply(parentRestWorldQ);
    this.editQuat[id].premultiply(local);
  }

  /** 弯枝：把世界空间旋转 d 按权重摊到 bendZone 的关节上 */
  applyBend(zone: number[], weights: number[], d: THREE.Quaternion): void {
    const tmp = new THREE.Quaternion();
    for (let i = 0; i < zone.length; i++) {
      if (weights[i] <= 0) continue;
      tmp.slerpQuaternions(IDENTITY, d, weights[i]);
      this.applyWorldDelta(zone[i], tmp);
    }
  }

  resetEdits(ids?: number[]): void {
    if (!ids) for (const q of this.editQuat) q.identity();
    else for (const id of ids) this.editQuat[id].identity();
  }

  /** 节点静止局部坐标 -> 当前世界坐标 */
  nodeLocalToWorld(id: number, local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.worldMatrix[id]);
  }
}

/**
 * 计算链上当前姿态的最小曲率半径（厘米）。
 * 用相邻枝轴夹角与段长估计 R ≈ 段长 / (2 sin(θ/2))。
 */
export function chainBendRadius(pose: PoseState, chain: number[]): { radius: number; atNode: number } {
  let worst = Infinity;
  let atNode = chain[0];
  for (let i = 1; i < chain.length - 1; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    const c = chain[i + 1];
    const d1 = pose.worldPos[b].clone().sub(pose.worldPos[a]);
    const d2 = pose.worldPos[c].clone().sub(pose.worldPos[b]);
    const l1 = d1.length();
    const l2 = d2.length();
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    d1.normalize();
    d2.normalize();
    const cos = THREE.MathUtils.clamp(d1.dot(d2), -1, 1);
    const theta = Math.acos(cos);
    if (theta < 1e-5) continue;
    const r = (l1 + l2) / (4 * Math.sin(theta / 2));
    if (r < worst) {
      worst = r;
      atNode = b;
    }
  }
  return { radius: worst, atNode };
}
