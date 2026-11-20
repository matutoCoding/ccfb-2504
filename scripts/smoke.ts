// 纯数学冒烟测试（无 WebGL）：node --experimental-strip-types scripts/smoke.ts
import { buildSampleTrees } from '../src/core/sampleTrees.ts';
import { computeRest, ancestorChain } from '../src/core/skeleton.ts';
import { TreeMeshBuilder } from '../src/three/meshBuilder.ts';
import { WireMeshBuilder } from '../src/three/wireBuilder.ts';
import { PoseState } from '../src/core/pose.ts';
import { advanceYear, radiiAtYear, generateCarePlan } from '../src/core/simulation.ts';
import { store } from '../src/core/store.ts';
import { uid } from '../src/core/id.ts';
import * as THREE from 'three';
import type { Plan, Wire } from '../src/core/types.ts';

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`  ✅ ${name} ${extra}`);
  else {
    failures++;
    console.error(`  ❌ ${name} ${extra}`);
  }
}

function freshPlan(treeId: string): Plan {
  return {
    id: uid('plan'), treeId, name: 'test', createdAt: 0, year: 0,
    editRot: {}, wires: [], deadRegions: [], wounds: [], scars: [], pruned: {},
    defoliated: [], foliageDensity: 1, care: { events: [], generatedAt: 0 },
    frontAzimuth: 0, trunkTiltTarget: 12,
    pot: { style: 'tokoname', color: 0, width: 20 }, stand: '',
  };
}

console.log('1) 样本桩材');
const samples = buildSampleTrees();
for (const s of samples) {
  check(`${s.record.name} 节点数 ${s.record.skeleton.nodes.length}`, s.record.skeleton.nodes.length > 20);
}
const stress = samples.find((s) => s.record.name.includes('三千节'))!;
check('压测树 ≥3000 节点', stress.record.skeleton.nodes.length >= 3000, `实际 ${stress.record.skeleton.nodes.length}`);
const shimpaku = samples.find((s) => s.record.name.includes('真柏'))!;
check('真柏带舍利配置', !!shimpaku.shari && shimpaku.jinNode !== undefined);

console.log('2) 静止骨架与网格构建');
for (const s of samples) {
  const tree = s.record;
  const plan = freshPlan(tree.id);
  if (s.shari) plan.deadRegions.push({ id: uid('d'), kind: 'shari', ...s.shari, year: 0 });
  if (s.jinNode !== undefined) plan.deadRegions.push({
    id: uid('d'), kind: 'jin', startNode: s.jinNode, endNode: s.jinNode,
    angleStart: 0, angleEnd: Math.PI * 2, year: 0,
  });
  tree.skeleton.nodes.forEach((n) => { if (plan.deadRegions.some((d) => d.kind === 'jin')) { /* keep types */ } });
  const rest = computeRest(tree.skeleton);
  check(`${tree.name} 根序覆盖全部节点`, rest.order.length === tree.skeleton.nodes.length);

  const radii = radiiAtYear(tree, plan);
  const built = new TreeMeshBuilder(tree.skeleton, rest, plan, radii).build();
  const pos = built.geometry.getAttribute('position') as THREE.BufferAttribute;
  let nan = false;
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
      nan = true; break;
    }
  }
  check(`${tree.name} 网格无 NaN`, !nan, `顶点 ${pos.count}`);
  check(`${tree.name} 权重数组长度匹配`, built.weights.length === pos.count * 4);
  check(`${tree.name} 权重和≈1`, (() => {
    let bad = 0;
    for (let i = 0; i < pos.count; i++) {
      const sum = built.weights[i * 4] + built.weights[i * 4 + 1] + built.weights[i * 4 + 2] + built.weights[i * 4 + 3];
      if (Math.abs(sum - 1) > 1e-4) bad++;
    }
    return bad === 0;
  })());
  check(`${tree.name} 蒙皮索引均为有效节点`, built.skinIndex.every((id) => id >= 0 && id < tree.skeleton.nodes.length));
  check(`${tree.name} 面组齐全`, built.groups.length > 0);

  console.log('3) 缠丝接触精度');
  // 在第一条足够长的主干链上缠 4 号丝
  const trunkTip = (() => {
    let id = 0;
    while (true) {
      const kids = tree.skeleton.nodes[id].children.filter((c) => tree.skeleton.nodes[c].type === 'trunk');
      if (!kids.length) return id;
      id = kids[0];
    }
  })();
  const chain = ancestorChain(tree.skeleton, trunkTip).slice(0, 6).reverse();
  const wire: Wire = {
    id: uid('w'), spec: { material: 'aluminum', gauge: 4 },
    spans: [{ anchorNode: chain[0], path: chain, endNode: chain[chain.length - 1], reverseAt: [], direction: 1, phase: 0 }],
    appliedYear: 0, active: true,
  };
  const wb = new WireMeshBuilder(tree.skeleton, rest, built.edgeRadius).buildAll([wire]);
  check(`${tree.name} 缠丝网格生成`, wb.geometry.getAttribute('position').count > 0);
  const wireR = 3.2 / 20; // 4号丝半径 cm
  check(
    `${tree.name} 丝-皮间隙残差 < 丝径10%`,
    wb.contact.maxGap < wireR * 0.2 && wb.contact.maxPenetration < wireR * 0.2,
    `gap=${(wb.contact.maxGap * 10).toFixed(3)}mm pen=${(wb.contact.maxPenetration * 10).toFixed(3)}mm`,
  );

  console.log('4) 蒙皮姿态跟随');
  const pose = new PoseState(tree.skeleton, rest);
  pose.update();
  const bendNode = Math.min(3, tree.skeleton.nodes.length - 1);
  // 先验证 FK：弯 bendNode 后，其后代世界位置必须变化
  const descendant = (() => {
    let id = bendNode;
    while (tree.skeleton.nodes[id].children.length) id = tree.skeleton.nodes[id].children[0];
    return id;
  })();
  const before = pose.worldPos[descendant].clone();
  pose.applyWorldDelta(bendNode, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
  pose.update();
  const after = pose.worldPos[descendant].clone();
  check(`${tree.name} FK 后代节点随弯枝移动`, after.distanceTo(before) > 0.1, `位移 ${after.distanceTo(before).toFixed(2)}cm`);

  // 找一个蒙皮到 bendNode 后代的树皮顶点，验证调色板蒙皮后确实移动
  const posArr = pos;
  let movedV = false;
  for (let vi = 0; vi < posArr.count; vi++) {
    const ids = [built.skinIndex[vi * 4], built.skinIndex[vi * 4 + 1]];
    if (!ids.some((x) => x === bendNode || ancestorChain(tree.skeleton, x).includes(bendNode))) continue;
    const restP = new THREE.Vector3(posArr.getX(vi), posArr.getY(vi), posArr.getZ(vi));
    let skinnedP = new THREE.Vector3();
    for (let k = 0; k < 2; k++) {
      const w = built.weights[vi * 4 + k];
      if (w === 0) continue;
      skinnedP.add(restP.clone().applyMatrix4(pose.skinPalette[ids[k]]).multiplyScalar(w));
    }
    if (skinnedP.distanceTo(restP) > 0.05) { movedV = true; break; }
  }
  check(`${tree.name} 树皮顶点经蒙皮调色板跟随弯曲`, movedV);

  // 丝顶点与同站位树皮顶点用同权重 -> 间隙在姿态空间保持（残差仍为构造残差）
  const wPos = wb.geometry.getAttribute('position') as THREE.BufferAttribute;
  const wireRest = new THREE.Vector3(wPos.getX(0), wPos.getY(0), wPos.getZ(0));
  const wireSkinned = wireRest.clone().applyMatrix4(pose.skinPalette[wb.skinIndex[0]]);
  check(`${tree.name} 蒙皮调色板有限`, Number.isFinite(wireSkinned.x));

  console.log('5) 年度推演与勒痕');
  const plan2 = freshPlan(tree.id);
  plan2.wires.push(wire);
  let scarsBefore = 0;
  for (let y = 0; y < 8; y++) {
    const r = advanceYear(tree, plan2);
    if (y === 0) scarsBefore = plan2.scars.length;
    void r;
  }
  check(`${tree.name} 逾期缠丝生成勒痕`, plan2.scars.length > 0, `勒痕 ${plan2.scars.length} 条`);
  check(`${tree.name} 年份推进到第8年`, plan2.year === 8);
  const healed = plan2.scars.every((s) => s.heal > 0);
  check(`${tree.name} 勒痕开始长平`, healed);
  generateCarePlan(tree, plan2);
  check(`${tree.name} 养护计划自动排程`, plan2.care.events.length >= 3, `${plan2.care.events.length} 条`);
  check(`${tree.name} 含勒伤预警`, plan2.care.events.some((e) => e.type === 'scar-warning'));
}

console.log('6) store 持久化层（IndexedDB 在 node 下应优雅降级以外的逻辑）');
check('store 单例可用', !!store && typeof store.createPlan === 'function');

console.log('7) 3000 节点每帧 FK 性能与弯后接触保持');
{
  const big = buildSampleTrees().find((s) => s.record.name.includes('三千节'))!.record;
  const rest = computeRest(big.skeleton);
  const pose = new PoseState(big.skeleton, rest);
  pose.update();
  // 制造一个大弯曲
  pose.applyWorldDelta(3, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.9));
  pose.applyWorldDelta(7, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.6));
  const N = 50;
  // 预热：排除首次 JIT/内联缓存冷启动的抖动
  for (let i = 0; i < 20; i++) pose.update();
  // 多批次取中位数，抵御偶发 GC/系统调度尖峰
  const batches: number[] = [];
  for (let b = 0; b < 7; b++) {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) pose.update();
    batches.push((performance.now() - t0) / N);
  }
  batches.sort((a, b) => a - b);
  const perFrame = batches[Math.floor(batches.length / 2)];
  check(`3001 节点 FK 每帧 < 8ms（跟手红线）`, perFrame < 8, `${perFrame.toFixed(2)}ms/帧`);

  // 弯后接触保持：丝中心线点与同站位枝轴点用同一权重向量蒙皮，
  // 纯旋转骨变换下两点距离必须与静止时恒等
  const plan = freshPlan(big.id);
  const radii = radiiAtYear(big, plan);
  const built = new TreeMeshBuilder(big.skeleton, rest, plan, radii).build();
  let tip = 0;
  while (true) {
    const kids = big.skeleton.nodes[tip].children.filter((c) => big.skeleton.nodes[c].type === 'trunk');
    if (!kids.length) break;
    tip = kids[0];
  }
  const chain = ancestorChain(big.skeleton, tip).slice(0, 7).reverse();
  const wire: Wire = {
    id: uid('w'), spec: { material: 'copper', gauge: 3 },
    spans: [{ anchorNode: chain[0], path: chain, endNode: chain[chain.length - 1], reverseAt: [], direction: 1, phase: 0 }],
    appliedYear: 0, active: true,
  };
  const wb = new WireMeshBuilder(big.skeleton, rest, built.edgeRadius).buildAll([wire]);
  const wireR = 4.0 / 20;
  let maxRelErr = 0;
  const wPos = wb.geometry.getAttribute('position') as THREE.BufferAttribute;
  // 每个丝管截面 6 个顶点，取各截面中心代表中心线
  const radSeg = 6;
  for (let ring = 0; ring < wPos.count / radSeg; ring += 4) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < radSeg; j++) {
      cx += wPos.getX(ring * radSeg + j);
      cy += wPos.getY(ring * radSeg + j);
      cz += wPos.getZ(ring * radSeg + j);
    }
    const centerRest = new THREE.Vector3(cx / radSeg, cy / radSeg, cz / radSeg);
    const bi0 = wb.skinIndex[ring * radSeg * 4];
    const bi1 = wb.skinIndex[ring * radSeg * 4 + 1];
    const bw0 = wb.weights[ring * radSeg * 4];
    const bw1 = wb.weights[ring * radSeg * 4 + 1];
    // 同权重的枝轴点
    const axisRest = rest.worldPos[bi0].clone().lerp(rest.worldPos[bi1], bw1);
    const restDist = centerRest.distanceTo(axisRest);
    const skin = (p: THREE.Vector3) =>
      p.clone().applyMatrix4(pose.skinPalette[bi0]).multiplyScalar(bw0)
        .add(p.clone().applyMatrix4(pose.skinPalette[bi1]).multiplyScalar(bw1));
    const bentDist = skin(centerRest).distanceTo(skin(axisRest));
    maxRelErr = Math.max(maxRelErr, Math.abs(bentDist - restDist) / (wireR * 2));
  }
  check('弯后丝-皮相对距离误差 < 丝径 10%', maxRelErr < 0.1, `最大相对误差 ${(maxRelErr * 100).toFixed(3)}%`);
}

console.log(failures === 0 ? '\n全部通过 ✨' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
