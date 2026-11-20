import { buildSampleTrees } from '../src/core/sampleTrees.ts';
import { computeRest } from '../src/core/skeleton.ts';

const samples = buildSampleTrees();
for (const s of samples) {
  const rest = computeRest(s.record.skeleton);
  let minY = 1e9, maxY = -1e9, maxX = 0;
  for (const p of rest.worldPos) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    maxX = Math.max(maxX, Math.abs(p.x), Math.abs(p.z));
  }
  const typeCount: Record<string, number> = {};
  for (const n of s.record.skeleton.nodes) typeCount[n.type] = (typeCount[n.type] ?? 0) + 1;
  console.log(`\n${s.record.name}（${s.record.skeleton.nodes.length} 节点）`);
  console.log(`  Y范围 ${minY.toFixed(1)} -> ${maxY.toFixed(1)}，水平半幅 ${maxX.toFixed(1)}`);
  console.log(`  类型 ${JSON.stringify(typeCount)}`);
}
