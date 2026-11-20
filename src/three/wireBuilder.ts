import * as THREE from 'three';
import type { Skeleton, Wire, WireSpan } from '../core/types';
import type { RestData } from '../core/skeleton';
import { gaugeMm } from '../core/species';

const UP = new THREE.Vector3(0, 1, 0);

function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const qa = new THREE.Quaternion().setFromUnitVectors(UP, a);
  const qb = new THREE.Quaternion().setFromUnitVectors(UP, b);
  qa.slerp(qb, t);
  return out.copy(UP).applyQuaternion(qa).normalize();
}

export interface BuiltWireMesh {
  geometry: THREE.BufferGeometry;
  weights: Float32Array;
  skinIndex: Uint32Array;
  /** 诊断：静止姿态下丝-皮最小间隙与最大穿插（厘米） */
  contact: { maxGap: number; maxPenetration: number };
  wireCount: number;
}

interface Sample {
  p: THREE.Vector3;
  n: THREE.Vector3;
  b: THREE.Vector3;
  barkR: number;
  edgeId: number;
  t: number;
  weights: { id: number; w: number }[];
}

/**
 * 缠丝网格构建。
 * 接触保证：丝中心线 = 树皮表面采样点沿径向外偏 (barkR + wireR)，
 * 丝顶点与该站位树皮顶点共用同一组双骨蒙皮权重 —— LBS 下两者变换完全一致，
 * 因此无论骨架怎么弯，丝-皮间隙在静止和姿态空间恒等（仅数值误差，远小于丝径10%）。
 */
export class WireMeshBuilder {
  private positions: number[] = [];
  private weights: number[] = [];
  private skinIndex: number[] = [];
  private indices: number[] = [];
  private maxGap = 0;
  private maxPen = 0;

  constructor(
    private sk: Skeleton,
    private rest: RestData,
    private edgeRadius: (edgeId: number, t: number) => number,
  ) {}

  buildAll(wires: Wire[]): BuiltWireMesh {
    for (const wire of wires) {
      if (!wire.active) continue;
      const wireR = gaugeMm(wire.spec.gauge) / 20; // mm -> cm 半径
      for (const span of wire.spans) {
        this.buildSpan(span, wireR);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return {
      geometry,
      weights: new Float32Array(this.weights),
      skinIndex: new Uint32Array(this.skinIndex),
      contact: { maxGap: this.maxGap, maxPenetration: this.maxPen },
      wireCount: wires.filter((w) => w.active).length,
    };
  }

  /** 沿路径以 ~45° 螺旋采样中心线 */
  private samplePath(span: WireSpan, wireR: number): Sample[] {
    const path = span.path;
    const samples: Sample[] = [];
    let dirSign = span.direction;
    let accumulated = span.phase;

    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k];
      const b = path[k + 1];
      const p0 = this.rest.worldPos[a];
      const p1 = this.rest.worldPos[b];
      const len = p0.distanceTo(p1);
      // 过分叉换向
      if (k > 0 && span.reverseAt.includes(b)) dirSign = (dirSign * -1) as 1 | -1;

      const nSteps = Math.max(3, Math.round(len / 0.4));
      for (let i = k === 0 ? 0 : 1; i <= nSteps; i++) {
        const t = i / nSteps;
        const c = p0.clone().lerp(p1, t);
        const n = new THREE.Vector3();
        slerpDir(this.rest.normal[a], this.rest.normal[b], t, n);
        const axis = p1.clone().sub(p0).normalize();
        const bn = new THREE.Vector3().crossVectors(axis, n).normalize();
        const barkR = this.edgeRadius(b, t);
        // 45° 螺旋：每前进一个周长转一圈 -> 相位 = 弧长 / 半径
        const arc = accumulated + (i / nSteps) * len;
        const angle = dirSign * (arc / Math.max(barkR, 0.05));
        const radial = n.clone().multiplyScalar(Math.cos(angle)).addScaledVector(bn, Math.sin(angle)).normalize();
        const p = c.clone().addScaledVector(radial, barkR + wireR);
        samples.push({
          p,
          n,
          b: bn,
          barkR,
          edgeId: b,
          t,
          weights: [
            { id: a, w: 1 - t },
            { id: b, w: t },
          ],
        });
      }
      accumulated += len;
    }
    return samples;
  }

  private buildSpan(span: WireSpan, wireR: number): void {
    const parts: Sample[][] = [this.samplePath(span, wireR)];
    if (span.forkPath && span.forkPath.length > 1) {
      parts.push(this.samplePath({ ...span, path: span.forkPath, forkPath: undefined }, wireR));
    }

    for (const samples of parts) {
      if (samples.length < 2) continue;
      const radSeg = 6;
      const baseIndex = this.positions.length / 3;
      // 管截面（丝本身的小圆管）
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const tangent =
          i < samples.length - 1
            ? samples[i + 1].p.clone().sub(s.p).normalize()
            : s.p.clone().sub(samples[i - 1].p).normalize();
        const ref = Math.abs(tangent.dot(new THREE.Vector3(0, 1, 0))) > 0.9
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 1, 0);
        const u = new THREE.Vector3().crossVectors(tangent, ref).normalize();
        const v = new THREE.Vector3().crossVectors(u, tangent).normalize();
        for (let j = 0; j < radSeg; j++) {
          const a = (j / radSeg) * Math.PI * 2;
          const p = s.p
            .clone()
            .addScaledVector(u, Math.cos(a) * wireR)
            .addScaledVector(v, Math.sin(a) * wireR);
          this.positions.push(p.x, p.y, p.z);
          // 关键：丝顶点权重 = 该站位树皮权重
          const w = s.weights;
          for (let k2 = 0; k2 < 4; k2++) {
            if (k2 < w.length) {
              this.weights.push(w[k2].w);
              this.skinIndex.push(w[k2].id);
            } else {
              this.weights.push(0);
              this.skinIndex.push(0);
            }
          }
        }
      }
      for (let i = 0; i < samples.length - 1; i++) {
        for (let j = 0; j < radSeg; j++) {
          const a = baseIndex + i * radSeg + j;
          const b = baseIndex + i * radSeg + ((j + 1) % radSeg);
          const c = baseIndex + (i + 1) * radSeg + j;
          const d = baseIndex + (i + 1) * radSeg + ((j + 1) % radSeg);
          this.indices.push(a, b, c, b, d, c);
        }
      }
      // 接触诊断（静止空间）：丝中心到枝轴距离应为 barkR + wireR，
      // 构造上恒等，这里记录数值残差；蒙皮后姿态空间保持同一相对关系
      for (const s of samples) {
        const axisPoint = this.rest.worldPos[this.sk.nodes[s.edgeId].parent]
          .clone()
          .lerp(this.rest.worldPos[s.edgeId], s.t);
        const centerToAxis = s.p.distanceTo(axisPoint) - wireR;
        const diff = centerToAxis - s.barkR;
        if (diff > 0) this.maxGap = Math.max(this.maxGap, diff);
        else this.maxPen = Math.max(this.maxPen, -diff);
      }
    }
  }
}
