import * as THREE from 'three';
import type { Plan, TreeRecord } from './types';
import { SPECIES, gaugeMm } from './species';
import { grownRadius, subtree } from './skeleton';
import { uid } from './id';

export interface GrowthResult {
  radii: number[];
  /** 今年新发生勒伤的丝 id */
  bitingWires: string[];
  warnings: string[];
}

/** 计算某方案年份下各节点有效粗度 */
export function radiiAtYear(tree: TreeRecord, plan: Plan): number[] {
  const sp = SPECIES[tree.species];
  return tree.skeleton.nodes.map((n) => grownRadius(n.radius, sp.growthRate, plan.year));
}

/**
  * 推进一年：
  * 1. 枝条按树种速率增粗（radii 由 year 推导，这里只更新 year）
  * 2. 丝逾期未拆 -> 生成螺旋勒痕（scar），并标记风险
  * 3. 已有勒痕随年自愈（heal 趋近 1），伤口截面同步愈合
  */
export function advanceYear(tree: TreeRecord, plan: Plan): GrowthResult {
  const sp = SPECIES[tree.species];
  plan.year += 1;
  const warnings: string[] = [];
  const biting: string[] = [];
  const baseRadii = tree.skeleton.nodes.map((n) => n.radius);

  for (const wire of plan.wires) {
    if (!wire.active) continue;
    const age = plan.year - wire.appliedYear;
    const limit = wire.spec.material === 'aluminum' ? sp.maxWireYearsAl : sp.maxWireYearsCu;
    if (age > limit) {
      biting.push(wire.id);
      warnings.push(`${wire.spec.material === 'aluminum' ? '铝' : '铜'}丝（${wire.spec.gauge} 号）已超期 ${(age - limit).toFixed(1)} 年，勒入树皮`);
      // 每条路径边生成一条勒痕（深度随超期加剧，封顶丝径 35%）
      const wireR = gaugeMm(wire.spec.gauge) / 20;
      for (const span of wire.spans) {
        for (let i = 1; i < span.path.length; i++) {
          const edgeId = span.path[i];
          if (plan.scars.some((s) => s.nodeId === edgeId)) continue;
          const over = age - limit;
          plan.scars.push({
            id: uid('scar'),
            nodeId: edgeId,
            depth: Math.min(wireR * 0.7, wireR * 0.18 * over),
            phase: span.phase + i * 0.7,
            width: 0.5,
            heal: 0,
            year: plan.year,
          });
        }
      }
    }
  }

  // 勒痕与伤口逐年长平
  for (const s of plan.scars) s.heal = Math.min(1, s.heal + 0.12);
  for (const w of plan.wounds) w.heal = Math.min(1, w.heal + 0.1);

  const radii = baseRadii.map((r) => grownRadius(r, sp.growthRate, plan.year));
  return { radii, bitingWires: biting, warnings };
}

/** 拆丝：停用丝，勒痕保留 */
export function removeWire(plan: Plan, wireId: string, year?: number): void {
  const wire = plan.wires.find((w) => w.id === wireId);
  if (!wire) return;
  wire.active = false;
  wire.removedYear = year ?? plan.year;
}

/** 修剪：记录伤口截面，标记子树节点为已剪（叶簇隐藏） */
export function pruneNode(tree: TreeRecord, plan: Plan, nodeId: number): void {
  const node = tree.skeleton.nodes[nodeId];
  plan.pruned[nodeId] = plan.year;
  plan.wounds.push({
    id: uid('wound'),
    nodeId,
    year: plan.year,
    radius: node.radius,
    heal: 0,
  });
}

export function isPruned(plan: Plan, nodeId: number): boolean {
  return nodeId in plan.pruned;
}

/** 真柏舍利干窗口 */
export function makeShari(
  plan: Plan,
  startNode: number,
  endNode: number,
  angleStart = -0.6,
  angleEnd = 0.8,
): void {
  plan.deadRegions.push({
    id: uid('shari'),
    kind: 'shari',
    startNode,
    endNode,
    angleStart,
    angleEnd,
    year: plan.year,
  });
}

/** 神枝：整枝剥皮枯死 */
export function makeJin(tree: TreeRecord, plan: Plan, nodeId: number): void {
  const sub = subtree(tree.skeleton, nodeId);
  plan.deadRegions.push({
    id: uid('jin'),
    kind: 'jin',
    startNode: nodeId,
    endNode: nodeId,
    angleStart: 0,
    angleEnd: Math.PI * 2,
    year: plan.year,
  });
  for (const id of sub) {
    if (tree.skeleton.nodes[id].type !== 'dead') {
      tree.skeleton.nodes[id].type = 'dead';
    }
  }
}

/**
 * 按方案自动排养护计划：
 * 上丝 -> 到期前一个季度提醒拆丝 -> 修剪季修剪 -> 周期换盆；
 * 勒痕风险提前（到期当年）生成 scar-warning。
 */
export function generateCarePlan(tree: TreeRecord, plan: Plan): void {
  const sp = SPECIES[tree.species];
  const events = plan.care.events;
  const push = (e: Omit<(typeof events)[number], 'id' | 'done'>) =>
    events.push({ id: uid('care'), done: false, ...e });

  for (const wire of plan.wires) {
    const limit = wire.spec.material === 'aluminum' ? sp.maxWireYearsAl : sp.maxWireYearsCu;
    const onYear = wire.appliedYear;
    push({
      year: onYear,
      month: sp.wireSeason[0],
      type: 'wire-on',
      title: `上${wire.spec.material === 'aluminum' ? '铝' : '铜'}丝 ${wire.spec.gauge} 号`,
      detail: `沿枝 45° 缠绕，锚点节点 #${wire.spans[0]?.anchorNode ?? '-'}`,
      wireId: wire.id,
    });
    const offYear = onYear + Math.floor(limit);
    push({
      year: offYear,
      month: sp.wireSeason[0],
      type: 'scar-warning',
      title: `勒伤风险：${wire.spec.gauge} 号丝临近到期`,
      detail: `最多再留 ${(limit % 1).toFixed(1)} 年，逾期将勒入树皮`,
      risk: true,
      wireId: wire.id,
    });
    push({
      year: offYear,
      month: sp.wireSeason[Math.min(1, sp.wireSeason.length - 1)],
      type: 'wire-off',
      title: `拆 ${wire.spec.gauge} 号${wire.spec.material === 'aluminum' ? '铝' : '铜'}丝`,
      detail: '拆后检查勒痕，勒痕会在 2-3 年长平',
      wireId: wire.id,
    });
  }

  for (const wound of plan.wounds) {
    push({
      year: wound.year,
      month: sp.pruneSeason[0],
      type: 'prune',
      title: `修剪节点 #${wound.nodeId}，封伤口`,
      detail: `伤口半径 ${wound.radius.toFixed(1)}cm，封口剂保护`,
    });
  }

  const horizon = Math.max(10, plan.year + 6);
  for (let y = sp.repotYears; y <= horizon; y += sp.repotYears) {
    push({
      year: y,
      month: 3,
      type: 'repot',
      title: '换盆修根',
      detail: `${sp.name} 每 ${sp.repotYears} 年换盆，修剪 1/3 老根`,
    });
  }

  events.sort((a, b) => a.year - b.year || a.month - b.month);
  plan.care.generatedAt = Date.now();
}

/** 弯枝合规校验：最小弯曲半径 = flexibility * 枝径 */
export function checkBendRadius(
  tree: TreeRecord,
  chainNodeIds: number[],
  currentRadius: number,
): { ok: boolean; minRadius: number; actual: number } {
  const sp = SPECIES[tree.species];
  let thickest = 0;
  for (const id of chainNodeIds) thickest = Math.max(thickest, tree.skeleton.nodes[id].radius * 2);
  const minRadius = sp.flexibility * thickest;
  return { ok: currentRadius >= minRadius, minRadius, actual: currentRadius };
}

/** 丝号是否足以固定该弯曲（丝径 ≥ 枝径 1/3 经验法则校验） */
export function checkWireGauge(branchRadiusCm: number, wireGaugeMm: number): { ok: boolean; recommend: number } {
  const need = branchRadiusCm * 20 / 3;
  return { ok: wireGaugeMm >= need * 0.85, recommend: need };
}

export function bendQuatFromDrag(
  pivot: THREE.Vector3,
  grabRest: THREE.Vector3,
  grabNow: THREE.Vector3,
): THREE.Quaternion {
  const a = grabRest.clone().sub(pivot).normalize();
  const b = grabNow.clone().sub(pivot).normalize();
  return new THREE.Quaternion().setFromUnitVectors(a, b);
}
