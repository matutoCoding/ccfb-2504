import type { RebuildStats } from '../three/bonsaiScene';

export function statsLabel(s: RebuildStats, contactGapLimit: number): string {
  // 接触残差以最细常用丝径（14 号 Ø0.45mm，半径 0.0225cm）的 10% 作为最严标尺
  const finestWireR = 0.045 / 2;
  const worstRel = Math.max(s.contactGap, s.contactPen) / finestWireR;
  const ok = worstRel <= contactGapLimit;
  return [
    `顶点 ${s.vertices.toLocaleString()} / 三角面 ${s.triangles.toLocaleString()}`,
    `结构重建耗时 ${s.ms.toFixed(1)} ms（弯枝走蒙皮，无需重建）`,
    `丝-皮间隙残差 ${(s.contactGap * 10).toFixed(3)} mm，穿插 ${(s.contactPen * 10).toFixed(3)} mm`,
    ok ? `✅ 接触误差 ${(worstRel * 100).toFixed(2)}%，优于丝径 ${contactGapLimit * 100}% 红线` : '⚠ 接触精度超标',
  ].join('\n');
}
