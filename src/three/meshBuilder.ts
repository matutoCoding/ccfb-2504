import * as THREE from 'three';
import type { DeadRegion, Plan, Skeleton, Wound } from '../core/types';
import type { RestData } from '../core/skeleton';
import { subtree } from '../core/skeleton';

export const MAT_LIVE = 0;
export const MAT_DEAD = 1;
export const MAT_WOUND = 2;

export interface BuiltMesh {
  geometry: THREE.BufferGeometry;
  /** 蒙皮权重（与 position 等长，每顶点最多 4 影响） */
  weights: Float32Array;
  skinIndex: Uint32Array;
  groups: { start: number; count: number; materialIndex: number }[];
  /** 静止空间任意骨架点的枝粗（供缠丝贴合查询），(t 沿边归一) */
  edgeRadius: (edgeId: number, t: number) => number;
  /** 勒痕槽数量（诊断用） */
  scarCount: number;
  stats: { vertices: number; triangles: number };
}

interface RingVertex {
  p: THREE.Vector3;
  w: { id: number; w: number }[];
  dead: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

/** 两方向向量的球面插值（Vector3 无 slerp） */
function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const qa = new THREE.Quaternion().setFromUnitVectors(UP, a);
  const qb = new THREE.Quaternion().setFromUnitVectors(UP, b);
  qa.slerp(qb, t);
  return out.copy(UP).applyQuaternion(qa).normalize();
}

function angularInWindow(a: number, s: number, e: number): boolean {
  if (e > s) return a >= s && a <= e;
  return a >= s || a <= e; // 跨 0
}

export class TreeMeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private weights: number[] = [];
  private skinIndex: number[] = [];
  private indices: number[] = [];
  private groupRanges: { start: number; count: number; materialIndex: number }[] = [];
  private edgeRadiusMap = new Map<number, (t: number) => number>();
  scarCount = 0;

  constructor(
    private sk: Skeleton,
    private rest: RestData,
    private plan: Plan,
    /** 节点当前有效粗度（年度生长后），按节点 id */
    private radii: number[],
  ) {}

  build(): BuiltMesh {
    const { sk, rest, plan } = this;
    const deadSet = this.collectDeadNodes();
    const shariWindows = this.collectShariWindows();
    this.scarCount = plan.scars.length;

    // 1) 每条边一根渐缩管（活皮/舍利分段）
    for (const id of rest.order) {
      const node = sk.nodes[id];
      if (node.parent < 0) continue;
      if (deadSet.has(id)) continue; // 神枝子树由死木管生成
      this.buildEdge(id, shariWindows, deadSet);
    }

    // 2) 死木管（神枝 + 舍利死面）
    for (const id of rest.order) {
      const node = sk.nodes[id];
      if (node.parent < 0) continue;
      if (deadSet.has(id)) this.buildDeadEdge(id);
    }

    // 3) 分叉焊接球：仅真正分叉点（≥2 活枝）与根盘处生成，单孩子节点由管直接贯通
    for (const id of rest.order) {
      const node = sk.nodes[id];
      const liveChildren = node.children.filter((c) => !deadSet.has(c));
      if (liveChildren.length < 2) continue;
      this.buildJunction(id, deadSet);
    }

    // 4) 根盘与板根
    this.buildRoots();

    // 5) 修剪伤口截面
    for (const w of plan.wounds) this.buildWoundCap(w);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setIndex(this.indices);
    for (const g of this.groupRanges) geometry.addGroup(g.start, g.count, g.materialIndex);
    geometry.computeVertexNormals();
    this.smoothNormals(geometry);
    geometry.computeBoundingSphere();

    return {
      geometry,
      weights: new Float32Array(this.weights),
      skinIndex: new Uint32Array(this.skinIndex),
      groups: this.groupRanges,
      edgeRadius: (edgeId, t) => this.edgeRadiusMap.get(edgeId)?.(t) ?? this.radii[edgeId] ?? 1,
      scarCount: this.scarCount,
      stats: {
        vertices: this.positions.length / 3,
        triangles: this.indices.length / 3,
      },
    };
  }

  // ---------- 数据收集 ----------

  private collectDeadNodes(): Set<number> {
    const set = new Set<number>();
    for (const d of this.plan.deadRegions) {
      if (d.kind === 'jin') {
        for (const x of subtree(this.sk, d.startNode)) set.add(x);
      }
    }
    return set;
  }

  private collectShariWindows(): Map<number, DeadRegion[]> {
    const map = new Map<number, DeadRegion[]>();
    for (const d of this.plan.deadRegions) {
      if (d.kind !== 'shari') continue;
      // 沿 start->end 祖先链上的每条边挂窗口
      let cur = d.endNode;
      while (cur >= 0) {
        const arr = map.get(cur) ?? [];
        arr.push(d);
        map.set(cur, arr);
        if (cur === d.startNode) break;
        cur = this.sk.nodes[cur].parent;
      }
    }
    return map;
  }

  // ---------- 管段 ----------

  /** 边上 t 位置的粗度：渐缩 + 勒痕槽 + 基部喇叭口 */
  private edgeRadiusAt(id: number, t: number, windows: Map<number, DeadRegion[]>): number {
    const node = this.sk.nodes[id];
    const r0 = this.radii[node.parent];
    const r1 = this.radii[id];
    let r = THREE.MathUtils.lerp(r0, r1, t);
    // 基部轻微喇叭口（靠近关节处藏缝），幅度小避免节状凸起
    r *= 1 + 0.05 * Math.exp(-t * 6);
    // 勒痕槽：螺旋相位匹配缠丝
    const scars = this.plan.scars.filter((s) => s.nodeId === id);
    for (const s of scars) {
      const phase = (s.phase + t * Math.PI * 6) % (Math.PI * 2);
      const d = Math.min(phase, Math.PI * 2 - phase);
      if (d < s.width / 2) {
        const k = 0.5 + 0.5 * Math.cos((d / (s.width / 2)) * Math.PI);
        r -= s.depth * (1 - s.heal) * k;
      }
    }
    this.scarCount += 0;
    return r;
  }

  /**
   * 生成一条边的管环。shari 窗口处环按角度切开：窗口内顶点归死木组，
   * 窗口边界加一对隆起水线顶点。
   */
  private buildEdge(id: number, windows: Map<number, DeadRegion[]>, deadSet: Set<number>): void {
    const { sk, rest } = this;
    const node = sk.nodes[id];
    const p0 = rest.worldPos[node.parent];
    const p1 = rest.worldPos[id];
    const len = p1.distanceTo(p0);
    const seg = Math.max(2, Math.round(len / 1.2));
    const radSeg = Math.max(8, Math.min(20, Math.round(this.radii[id] * 6)));
    const wins = windows.get(id) ?? [];

    const rings: RingVertex[][] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const c = p0.clone().lerp(p1, t);
      // 平行移动标架在 t 处：直接用两端标架 slerp
      const nrm = new THREE.Vector3();
      slerpDir(rest.normal[node.parent], rest.normal[id], t, nrm);
      const bnr = new THREE.Vector3().crossVectors(p1.clone().sub(p0).normalize(), nrm).normalize();
      const r = this.edgeRadiusAt(id, t, windows);
      const ring: RingVertex[] = [];

      for (let j = 0; j < radSeg; j++) {
        const a = (j / radSeg) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const radial = nrm.clone().multiplyScalar(ca).addScaledVector(bnr, sa).normalize();
        let dead = false;
        let ridge = 0;
        for (const win of wins) {
          if (angularInWindow(a, win.angleStart, win.angleEnd)) {
            dead = true;
          } else {
            // 水线：窗口边界外侧鼓起
            const dEdge = this.angularDistanceToWindow(a, win);
            if (dEdge < 0.18) ridge = Math.max(ridge, 0.35 * (1 - dEdge / 0.18));
          }
        }
        const p = c.clone().addScaledVector(radial, r * (1 + ridge));
        ring.push({
          p,
          w: [
            { id: node.parent, w: 1 - t },
            { id, w: t },
          ],
          dead,
        });
      }
      rings.push(ring);
    }

    // 写顶点/索引；shari 窗口内的面跳过，露出底层完整死木管
    const baseIndex = this.positions.length / 3;
    for (const ring of rings) for (const v of ring) this.pushVertex(v);
    const start = this.indices.length;
    let count = 0;
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < radSeg; j++) {
        const j2 = (j + 1) % radSeg;
        if (rings[i][j].dead || rings[i + 1][j].dead || rings[i][j2].dead || rings[i + 1][j2].dead) continue;
        const a = baseIndex + i * radSeg + j;
        const b = baseIndex + i * radSeg + j2;
        const c = baseIndex + (i + 1) * radSeg + j;
        const d = baseIndex + (i + 1) * radSeg + j2;
        this.indices.push(a, b, c, b, d, c);
        count += 6;
      }
    }
    if (count) this.groupRanges.push({ start, count, materialIndex: MAT_LIVE });
    this.edgeRadiusMap.set(id, (t) => this.edgeRadiusAt(id, t, windows));
  }

  /** 死木管（神枝/舍利背面）：带纵向木纹脊的灰色管 */
  private buildDeadEdge(id: number): void {
    const { sk, rest } = this;
    const node = sk.nodes[id];
    const p0 = rest.worldPos[node.parent];
    const p1 = rest.worldPos[id];
    const len = p1.distanceTo(p0);
    const seg = Math.max(2, Math.round(len / 1.5));
    const radSeg = 12;
    const baseIndex = this.positions.length / 3;
    const start = this.indices.length;

    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const c = p0.clone().lerp(p1, t);
      const nrm = new THREE.Vector3();
      slerpDir(rest.normal[node.parent], rest.normal[id], t, nrm);
      const bnr = new THREE.Vector3().crossVectors(p1.clone().sub(p0).normalize(), nrm).normalize();
      const r = THREE.MathUtils.lerp(this.radii[node.parent], this.radii[id], t) * 0.96;
      for (let j = 0; j < radSeg; j++) {
        const a = (j / radSeg) * Math.PI * 2;
        // 纵向木纹：固定角度的噪声脊，随 t 缓慢起伏
        const grain = 1 + 0.09 * Math.sin(j * 2.3 + id) + 0.04 * Math.sin(t * 14 + j);
        const rr = r * grain;
        const p = c
          .clone()
          .addScaledVector(nrm, Math.cos(a) * rr)
          .addScaledVector(bnr, Math.sin(a) * rr);
        this.pushVertex({
          p,
          w: [
            { id: node.parent, w: 1 - t },
            { id, w: t },
          ],
          dead: true,
        });
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < radSeg; j++) {
        const a = baseIndex + i * radSeg + j;
        const b = baseIndex + i * radSeg + ((j + 1) % radSeg);
        const c = baseIndex + (i + 1) * radSeg + j;
        const d = baseIndex + (i + 1) * radSeg + ((j + 1) % radSeg);
        this.indices.push(a, b, c, b, d, c);
      }
    }
    this.groupRanges.push({ start, count: this.indices.length - start, materialIndex: MAT_DEAD });
    this.edgeRadiusMap.set(id, (t) => THREE.MathUtils.lerp(this.radii[node.parent], this.radii[id], t));
  }

  // ---------- 分叉焊接 ----------

  /**
   * 焊接球：半径按面积法则 r_blob² = r_parent² + Σr_child²（封顶 1.15r_parent），
   * 仅在真分叉点生成；子管末端插入球内藏缝，球面多骨权重平滑过渡。
   */
  private buildJunction(id: number, deadSet: Set<number>): void {
    const { sk, rest } = this;
    const node = sk.nodes[id];
    const liveChildren = node.children.filter((c) => !deadSet.has(c));
    if (liveChildren.length < 2) return;
    const rp = this.radii[id];
    let sumSq = rp * rp;
    for (const c of liveChildren) sumSq += this.radii[c] * this.radii[c];
    const blobR = Math.min(Math.sqrt(sumSq), rp * 1.15);
    const center = rest.worldPos[id];
    const latSeg = 10;
    const lonSeg = Math.max(12, Math.round(blobR * 8));
    const baseIndex = this.positions.length / 3;
    const start = this.indices.length;

    for (let i = 0; i <= latSeg; i++) {
      const phi = (i / latSeg) * Math.PI;
      for (let j = 0; j < lonSeg; j++) {
        const theta = (j / lonSeg) * Math.PI * 2;
        const dir = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        );
        // 稍椭：沿枝轴压扁一点更自然
        const p = center.clone().addScaledVector(dir, blobR);
        // 多骨权重：父节点 + 各子方向最近的子节点
        const w: { id: number; w: number }[] = [{ id, w: 0.65 }];
        let restW = 0.35;
        for (const c of liveChildren) {
          const cdir = rest.axis[c];
          const dot = Math.max(0, dir.dot(cdir));
          if (dot > 0.5) {
            const cw = 0.35 * ((dot - 0.5) / 0.5);
            w.push({ id: c, w: cw });
            restW -= cw;
          }
        }
        w[0].w += Math.max(0, restW);
        this.pushVertex({ p, w, dead: false });
      }
    }
    for (let i = 0; i < latSeg; i++) {
      for (let j = 0; j < lonSeg; j++) {
        const a = baseIndex + i * lonSeg + j;
        const b = baseIndex + i * lonSeg + ((j + 1) % lonSeg);
        const c = baseIndex + (i + 1) * lonSeg + j;
        const d = baseIndex + (i + 1) * lonSeg + ((j + 1) % lonSeg);
        this.indices.push(a, b, c, b, d, c);
      }
    }
    this.groupRanges.push({ start, count: this.indices.length - start, materialIndex: MAT_LIVE });
  }

  // ---------- 根盘 / 板根 ----------

  private buildRoots(): void {
    const { sk, rest } = this;
    const rootId = rest.order[0];
    const rootNode = sk.nodes[rootId];
    const base = rest.worldPos[rootId];

    // 主干基部喇叭口（根盘隆起）
    const trunkChildren = rootNode.children.filter((c) => sk.nodes[c].type === 'trunk');
    if (trunkChildren.length) {
      this.buildButtressFlare(rootId, trunkChildren[0]);
    }

    // 板根/露根
    for (const cid of rootNode.children) {
      const child = sk.nodes[cid];
      if (child.type !== 'root' && child.type !== 'buttress') continue;
      this.buildRootFlare(cid);
    }
  }

  private buildButtressFlare(rootId: number, trunkChild: number): void {
    const { rest } = this;
    const center = rest.worldPos[rootId];
    const r = this.radii[rootId] * 1.45;
    const seg = 14;
    const baseIndex = this.positions.length / 3;
    const start = this.indices.length;
    // 地面处一个大环，向上收进主干
    for (let ring = 0; ring <= 2; ring++) {
      const t = ring / 2;
      const rr = THREE.MathUtils.lerp(r, this.radii[trunkChild] * 1.05, t);
      const c = center.clone().addScaledVector(UP, t * this.radii[rootId] * 1.2);
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const p = c.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr));
        this.pushVertex({ p, w: [{ id: rootId, w: 1 - t * 0.5 }, { id: trunkChild, w: t * 0.5 }], dead: false });
      }
    }
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < seg; j++) {
        const a = baseIndex + i * seg + j;
        const b = baseIndex + i * seg + ((j + 1) % seg);
        const c = baseIndex + (i + 1) * seg + j;
        const d = baseIndex + (i + 1) * seg + ((j + 1) % seg);
        this.indices.push(a, b, c, b, d, c);
      }
    }
    this.groupRanges.push({ start, count: this.indices.length - start, materialIndex: MAT_LIVE });
  }

  private buildRootFlare(rootEdgeId: number): void {
    const { sk, rest } = this;
    const node = sk.nodes[rootEdgeId];
    const p0 = rest.worldPos[node.parent];
    const p1 = rest.worldPos[rootEdgeId];
    const seg = 5;
    const radSeg = 10;
    const baseIndex = this.positions.length / 3;
    const start = this.indices.length;
    // 板根：截面从竖向扁脊渐变为贴地圆根
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const c = p0.clone().lerp(p1, t);
      c.y = Math.max(0, c.y);
      const r = THREE.MathUtils.lerp(this.radii[node.parent] * 0.9, this.radii[rootEdgeId], t);
      const nrm = new THREE.Vector3(1, 0, 0);
      const bnr = new THREE.Vector3(0, 0, 1);
      for (let j = 0; j < radSeg; j++) {
        const a = (j / radSeg) * Math.PI * 2;
        const flat = 1 - t * 0.55; // 越远越贴地
        const p = c
          .clone()
          .addScaledVector(nrm, Math.cos(a) * r)
          .addScaledVector(bnr, Math.sin(a) * r * flat);
        p.y = Math.max(0, p.y);
        this.pushVertex({
          p,
          w: [
            { id: node.parent, w: 1 - t },
            { id: rootEdgeId, w: t },
          ],
          dead: false,
        });
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < radSeg; j++) {
        const a = baseIndex + i * radSeg + j;
        const b = baseIndex + i * radSeg + ((j + 1) % radSeg);
        const c = baseIndex + (i + 1) * radSeg + j;
        const d = baseIndex + (i + 1) * radSeg + ((j + 1) % radSeg);
        this.indices.push(a, b, c, b, d, c);
      }
    }
    this.groupRanges.push({ start, count: this.indices.length - start, materialIndex: MAT_LIVE });
  }

  // ---------- 伤口 ----------

  private buildWoundCap(w: Wound): void {
    const { rest } = this;
    if (w.nodeId >= this.sk.nodes.length) return;
    const center = rest.worldPos[w.nodeId];
    const r = w.radius * (1 - w.heal * 0.75);
    const dir = rest.axis[w.nodeId];
    const nrm = rest.normal[w.nodeId];
    const bnr = rest.binormal[w.nodeId];
    const seg = 14;
    const baseIndex = this.positions.length / 3;
    const start = this.indices.length;
    // 微凹的截面（中心向内缩 15%）
    this.pushVertex({
      p: center.clone().addScaledVector(dir, -r * 0.15),
      w: [{ id: w.nodeId, w: 1 }],
      dead: true,
    });
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const p = center
        .clone()
        .addScaledVector(nrm, Math.cos(a) * r)
        .addScaledVector(bnr, Math.sin(a) * r);
      this.pushVertex({ p, w: [{ id: w.nodeId, w: 1 }], dead: true });
    }
    for (let j = 0; j < seg; j++) {
      this.indices.push(baseIndex, baseIndex + 1 + j, baseIndex + 1 + ((j + 1) % seg));
    }
    this.groupRanges.push({ start, count: this.indices.length - start, materialIndex: MAT_WOUND });
  }

  // ---------- 工具 ----------

  private pushVertex(v: RingVertex): void {
    this.positions.push(v.p.x, v.p.y, v.p.z);
    // 权重按影响数补齐到 4 槽；空槽必须为权重 0、索引 0
    const weights = v.w.slice(0, 4);
    const total = weights.reduce((s, x) => s + x.w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      if (k < weights.length) {
        this.weights.push(weights[k].w / total);
        this.skinIndex.push(weights[k].id);
      } else {
        this.weights.push(0);
        this.skinIndex.push(0);
      }
    }
  }

  private angularDistanceToWindow(a: number, win: DeadRegion): number {
    const d1 = Math.min(Math.abs(a - win.angleStart), Math.PI * 2 - Math.abs(a - win.angleStart));
    const d2 = Math.min(Math.abs(a - win.angleEnd), Math.PI * 2 - Math.abs(a - win.angleEnd));
    return Math.min(d1, d2);
  }

  /**
   * 法线平滑：焊接球与管重叠处按近邻平均法线，消除接缝硬边；
   * 死木/活皮交界与伤口边界保持硬边（组边界不平滑）。
   */
  private smoothNormals(geometry: THREE.BufferGeometry): void {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = geometry.getIndex()!;
    const n = pos.count;
    const normals = new Float32Array(n * 3);
    const faceMat = new Uint8Array(idx.count / 3);
    for (const g of this.groupRanges) {
      for (let i = g.start; i < g.start + g.count; i += 3) {
        faceMat[i / 3] = g.materialIndex;
      }
    }
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const cb = new THREE.Vector3();
    const ab = new THREE.Vector3();
    for (let f = 0; f < faceMat.length; f++) {
      const ia = idx.getX(f * 3);
      const ib = idx.getX(f * 3 + 1);
      const ic = idx.getX(f * 3 + 2);
      va.fromBufferAttribute(pos, ia);
      vb.fromBufferAttribute(pos, ib);
      vc.fromBufferAttribute(pos, ic);
      cb.subVectors(vc, vb);
      ab.subVectors(va, vb);
      cb.cross(ab);
      const m = faceMat[f];
      for (const vx of [ia, ib, ic]) {
        if (m === MAT_LIVE) {
          normals[vx * 3] += cb.x;
          normals[vx * 3 + 1] += cb.y;
          normals[vx * 3 + 2] += cb.z;
        }
      }
    }
    // 非活皮组保留 computeVertexNormals 的原始法线：合并
    const raw = geometry.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      if (normals[i * 3] !== 0 || normals[i * 3 + 1] !== 0 || normals[i * 3 + 2] !== 0) {
        const l = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
        raw.setXYZ(i, normals[i * 3] / l, normals[i * 3 + 1] / l, normals[i * 3 + 2] / l);
      }
    }
    raw.needsUpdate = true;
  }
}
