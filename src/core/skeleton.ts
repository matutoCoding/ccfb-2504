import * as THREE from 'three';
import type { Skeleton, SkeletonNode } from './types';

export interface RestData {
  /** 静止世界位置 */
  worldPos: THREE.Vector3[];
  /** 静止局部旋转（节点 -> 父） */
  localQuat: THREE.Quaternion[];
  /** 静止世界旋转 */
  worldQuat: THREE.Quaternion[];
  /** 静止局部矩阵 */
  localMatrix: THREE.Matrix4[];
  /** 静止世界矩阵 */
  worldMatrix: THREE.Matrix4[];
  /** inverse(bindWorld)，蒙皮用 */
  bindInverse: THREE.Matrix4[];
  /** 根序（父在子前） */
  order: number[];
  /** 每个节点的枝轴方向（单位向量，静止），根为 +Y */
  axis: THREE.Vector3[];
  /** 平行移动标架：法向/副法向（静止） */
  normal: THREE.Vector3[];
  binormal: THREE.Vector3[];
}

const UP = new THREE.Vector3(0, 1, 0);

/** 根序遍历（保证父先于子） */
export function topoOrder(sk: Skeleton): number[] {
  const order: number[] = [];
  const roots = sk.nodes.filter((n) => n.parent < 0).map((n) => n.id);
  const stack = [...roots];
  while (stack.length) {
    const id = stack.shift()!;
    order.push(id);
    stack.push(...sk.nodes[id].children);
  }
  return order;
}

export function nodeWorldPos(sk: Skeleton, id: number, out = new THREE.Vector3()): THREE.Vector3 {
  const n = sk.nodes[id];
  out.fromArray(n.pos);
  if (n.parent >= 0) out.add(nodeWorldPos(sk, n.parent));
  return out;
}

/** 计算全部静止姿态数据 */
export function computeRest(sk: Skeleton): RestData {
  const n = sk.nodes.length;
  const worldPos = Array.from({ length: n }, () => new THREE.Vector3());
  const localQuat = Array.from({ length: n }, () => new THREE.Quaternion());
  const worldQuat = Array.from({ length: n }, () => new THREE.Quaternion());
  const localMatrix = Array.from({ length: n }, () => new THREE.Matrix4());
  const worldMatrix = Array.from({ length: n }, () => new THREE.Matrix4());
  const bindInverse = Array.from({ length: n }, () => new THREE.Matrix4());
  const axis = Array.from({ length: n }, () => new THREE.Vector3(0, 1, 0));
  const normal = Array.from({ length: n }, () => new THREE.Vector3(1, 0, 0));
  const binormal = Array.from({ length: n }, () => new THREE.Vector3(0, 0, 1));
  const order = topoOrder(sk);

  for (const id of order) {
    const node = sk.nodes[id];
    const lp = new THREE.Vector3().fromArray(node.pos);
    worldPos[id].copy(lp);
    if (node.parent >= 0) worldPos[id].add(worldPos[node.parent]);

    // 枝轴：优先沿主干孩子方向（避免根节点的多个向四周的根孩子把主干带偏）；
    // 无主干孩子时取所有孩子的平均方向；叶节点沿用自身局部方向
    let dir: THREE.Vector3;
    const trunkKid = node.children.find((c) => sk.nodes[c].type === 'trunk');
    if (trunkKid !== undefined) {
      dir = new THREE.Vector3().fromArray(sk.nodes[trunkKid].pos).normalize();
    } else if (node.children.length) {
      dir = new THREE.Vector3();
      for (const c of node.children) dir.add(new THREE.Vector3().fromArray(sk.nodes[c].pos));
      dir.normalize();
    } else if (node.parent >= 0) {
      dir = lp.clone().normalize();
    } else {
      dir = UP.clone();
    }
    if (dir.lengthSq() < 1e-8) dir.copy(UP);
    axis[id].copy(dir);

    const lq = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    localQuat[id].copy(lq);

    if (node.parent >= 0) {
      worldQuat[id].copy(worldQuat[node.parent]).multiply(lq);
      // 平行移动：把父标架沿本枝轴投影，避免扭转累积
      const pn = normal[node.parent].clone();
      const pbn = binormal[node.parent].clone();
      pn.addScaledVector(dir, -pn.dot(dir)).normalize();
      pbn.crossVectors(dir, pn).normalize();
      normal[id].copy(pn);
      binormal[id].copy(pbn);
    } else {
      worldQuat[id].copy(lq);
      // 根的初始标架：取任意垂直向量
      const ref = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      normal[id].crossVectors(ref, dir).normalize();
      binormal[id].crossVectors(dir, normal[id]).normalize();
    }

    localMatrix[id].compose(lp, lq, new THREE.Vector3(1, 1, 1));
    if (node.parent >= 0) worldMatrix[id].multiplyMatrices(worldMatrix[node.parent], localMatrix[id]);
    else worldMatrix[id].copy(localMatrix[id]);
    worldMatrix[id].decompose(worldPos[id], worldQuat[id], new THREE.Vector3());
    bindInverse[id].copy(worldMatrix[id]).invert();
  }
  return { worldPos, localQuat, worldQuat, localMatrix, worldMatrix, bindInverse, order, axis, normal, binormal };
}

/** 从某节点向上的祖先链（含自身） */
export function ancestorChain(sk: Skeleton, id: number): number[] {
  const chain: number[] = [];
  let cur = id;
  while (cur >= 0) {
    chain.push(cur);
    cur = sk.nodes[cur].parent;
  }
  return chain;
}

/** 子树全部节点 */
export function subtree(sk: Skeleton, id: number): number[] {
  const out: number[] = [];
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    out.push(x);
    stack.push(...sk.nodes[x].children);
  }
  return out;
}

export function isDescendant(sk: Skeleton, ancestor: number, maybeChild: number): boolean {
  let cur = maybeChild;
  while (cur >= 0) {
    if (cur === ancestor) return true;
    cur = sk.nodes[cur].parent;
  }
  return false;
}

export function addNode(
  sk: Skeleton,
  parent: number,
  pos: [number, number, number],
  radius: number,
  type: SkeletonNode['type'],
): number {
  const id = sk.nodes.length;
  sk.nodes.push({ id, parent, pos, radius, type, children: [] });
  if (parent >= 0) sk.nodes[parent].children.push(id);
  return id;
}

export function removeNode(sk: Skeleton, id: number): void {
  const n = sk.nodes[id];
  if (n.parent >= 0) {
    const p = sk.nodes[n.parent];
    p.children = p.children.filter((c) => c !== id);
  }
  // 递归摘子树
  const drop = subtree(sk, id);
  for (const d of drop) {
    sk.nodes[d] = { ...sk.nodes[d], parent: -999, children: [] };
  }
  sk.nodes = sk.nodes.filter((x) => x.parent !== -999);
}

/** 节点处有效粗度（年度生长后） */
export function grownRadius(base: number, growthRate: number, years: number): number {
  return base * (1 + growthRate * years);
}
