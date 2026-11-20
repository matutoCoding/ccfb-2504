import * as THREE from 'three';
import type { FoliageKind, Plan, Skeleton } from '../core/types';
import type { RestData } from '../core/skeleton';
import { subtree } from '../core/skeleton';
import type { PoseState } from '../core/pose';

export interface FoliageAnchor {
  nodeId: number;
  /** 节点局部空间锚点 */
  local: THREE.Vector3;
  scale: number;
  rot: THREE.Quaternion;
  kind: FoliageKind;
  /** 所属枝片（祖先中最近的 branch 节点） */
  padId: number;
}

/** 可种子化随机，保证重建网格后叶簇位置稳定 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 在小枝末端周围生成叶簇锚点 */
export function generateAnchors(
  sk: Skeleton,
  rest: RestData,
  kind: FoliageKind,
  density: number,
  seed = 7,
): FoliageAnchor[] {
  const rng = mulberry32(seed);
  const anchors: FoliageAnchor[] = [];
  for (const id of rest.order) {
    const node = sk.nodes[id];
    if (node.type === 'root' || node.type === 'buttress' || node.type === 'dead') continue;
    const isTip = node.children.filter((c) => sk.nodes[c].type !== 'root').length === 0;
    const isTwig = node.type === 'twig' || isTip;
    if (!isTwig) continue;
    const clusters = Math.max(1, Math.round(density * (kind === 'pine' ? 2 : 3)));
    // 找枝片归属
    let pad = id;
    let cur = id;
    while (cur >= 0 && sk.nodes[cur].type !== 'branch') cur = sk.nodes[cur].parent;
    if (cur >= 0) pad = cur;
    for (let k = 0; k < clusters; k++) {
      const r = node.radius * (0.6 + rng() * 1.6);
      const a = rng() * Math.PI * 2;
      const y = (rng() - 0.3) * r;
      anchors.push({
        nodeId: id,
        local: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        scale: 0.8 + rng() * 0.5,
        rot: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rng() * 0.6, rng() * Math.PI * 2, rng() * 0.6),
        ),
        kind,
        padId: pad,
      });
    }
  }
  return anchors;
}

/** 四种叶型的实例化基础几何 */
export function makeFoliageGeometry(kind: FoliageKind): THREE.BufferGeometry {
  switch (kind) {
    case 'pine': {
      // 五针松：放射针簇，5 根一组的细锥
      const g = new THREE.ConeGeometry(0.06, 0.55, 5, 1);
      g.translate(0, 0.27, 0);
      return g;
    }
    case 'juniper': {
      // 真柏鳞叶：扁鳞片状小团
      const g = new THREE.IcosahedronGeometry(0.16, 0);
      g.scale(1.3, 0.55, 1.3);
      return g;
    }
    case 'elm': {
      // 榆树小叶：椭圆薄片
      const g = new THREE.SphereGeometry(0.14, 6, 4);
      g.scale(1.4, 0.5, 1);
      return g;
    }
    case 'bougainvillea': {
      // 三角梅：叶+彩色苞片
      const g = new THREE.SphereGeometry(0.16, 6, 4);
      g.scale(1.2, 0.7, 1);
      return g;
    }
  }
}

export class FoliageSystem {
  mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private hiddenPads = new Set<number>();
  private hiddenNodes = new Set<number>();
  readonly anchors: FoliageAnchor[];
  /** 花/苞片色（三角梅） */
  bloomColor = new THREE.Color(0xd6486f);

  constructor(anchors: FoliageAnchor[], kind: FoliageKind, color: number) {
    this.anchors = anchors;
    const geo = makeFoliageGeometry(kind);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0,
    });
    if (kind === 'bougainvillea') {
      mat.vertexColors = false;
      mat.color = new THREE.Color(0x3f7a3a);
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, anchors.length));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    if (kind === 'bougainvillea') this.initBloomColors();
  }

  private initBloomColors(): void {
    const c = new THREE.Color();
    for (let i = 0; i < this.anchors.length; i++) {
      // 约 35% 实例染成苞片色
      c.set(i % 3 === 0 ? this.bloomColor.getHex() : 0x3f7a3a);
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 枝片整体疏叶 */
  defoliatePad(sk: Skeleton, padId: number, on: boolean): void {
    const nodes = new Set(subtree(sk, padId));
    for (const a of this.anchors) {
      if (nodes.has(a.nodeId)) {
        if (on) this.hiddenPads.add(a.nodeId);
        else this.hiddenPads.delete(a.nodeId);
      }
    }
  }

  setPrunedNodes(ids: Iterable<number>): void {
    this.hiddenNodes = new Set(ids);
  }

  /** 每帧：锚点局部矩阵 × 节点当前世界矩阵，弯枝时叶簇跟随 */
  update(pose: PoseState, plan: Plan): void {
    const densityScale = plan.foliageDensity ?? 1;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      const hidden = this.hiddenPads.has(a.nodeId) || this.hiddenNodes.has(a.nodeId);
      if (hidden) {
        this.dummy.position.set(0, -9999, 0);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      const m = pose.worldMatrix[a.nodeId];
      this.dummy.position.copy(a.local).applyMatrix4(m);
      this.dummy.quaternion.copy(pose.worldQuat[a.nodeId]).multiply(a.rot);
      this.dummy.scale.setScalar(a.scale * densityScale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
