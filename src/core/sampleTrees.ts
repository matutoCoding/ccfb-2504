import type { Skeleton, SpeciesId, TreeRecord } from './types';
import { addNode } from './skeleton';
import { uid } from './id';

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

function newSkeleton(): Skeleton {
  return { nodes: [] };
}

/** 找某节点的主干孩子（跳过露根/板根） */
function trunkChild(sk: Skeleton, id: number): number {
  return sk.nodes[id].children.find((c) => sk.nodes[c].type === 'trunk') ?? sk.nodes[id].children[0];
}

/** 沿一串点接主干，返回末端 id */
function chain(
  sk: Skeleton,
  start: number,
  pts: [number, number, number][],
  r0: number,
  taper = 0.82,
  type: Skeleton['nodes'][number]['type'] = 'trunk',
): number {
  let cur = start;
  let r = r0;
  for (const p of pts) {
    r *= taper;
    cur = addNode(sk, cur, p, r, type);
  }
  return cur;
}

/** 根盘：一圈露根 + 两根板根 */
function addRoots(sk: Skeleton, rootId: number, rng: () => number): void {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng() * 0.4;
    const d = 5 + rng() * 3;
    const r1 = addNode(
      sk,
      rootId,
      [Math.cos(a) * d * 0.5, 0.4, Math.sin(a) * d * 0.5],
      1.6,
      'root',
    );
    addNode(sk, r1, [Math.cos(a) * d * 0.5, -0.4, Math.sin(a) * d * 0.5], 0.7, 'root');
  }
  for (let i = 0; i < 2; i++) {
    const a = rng() * Math.PI * 2;
    const b = addNode(sk, rootId, [Math.cos(a) * 2.5, 0.2, Math.sin(a) * 2.5], 2.4, 'buttress');
    addNode(sk, b, [Math.cos(a) * 3.5, -0.2, Math.sin(a) * 3.5], 1.2, 'buttress');
  }
}

/** 递归分枝：用于侧枝细化和压力测试大树 */
function growBranch(
  sk: Skeleton,
  parent: number,
  depth: number,
  rng: () => number,
  r: number,
): number {
  if (depth <= 0 || r < 0.08) return parent;
  const fan = rng() * Math.PI * 2;
  const nKids = depth > 2 ? 2 + (rng() > 0.6 ? 1 : 0) : 1;
  let last = parent;
  for (let k = 0; k < nKids; k++) {
    const ang = fan + (k - nKids / 2) * 0.9;
    const horiz = 0.4 + rng() * 0.25;
    const reach = 1.4 + rng() * 0.9;
    const seg = addNode(
      sk,
      last === parent ? parent : last,
      [
        Math.cos(ang) * horiz * reach,
        1.4 + rng() * 1.2,
        Math.sin(ang) * horiz * reach,
      ],
      r,
      depth > 3 ? 'branch' : 'twig',
    );
    growBranch(sk, seg, depth - 1, rng, r * 0.6);
    last = seg;
  }
  return last;
}

// ---------- 手工老桩 ----------

/** 五针松：斜干式，分层枝片 */
function makePine(): Skeleton {
  const sk = newSkeleton();
  const rng = mulberry32(11);
  const root = addNode(sk, -1, [0, 0, 0], 5.5, 'trunk');
  addRoots(sk, root, rng);
  const t1 = chain(
    sk,
    root,
    [
      [0.4, 4.4, 0.1],
      [0.9, 4.4, -0.2],
      [0.5, 4.6, 0.1],
      [1.1, 4.2, -0.3],
      [0.6, 4.0, 0.2],
    ],
    4.6,
    0.8,
  );
  // 三层枝片，下长上短
  const layerDefs = [
    { at: 1, len: 11, side: -1 },
    { at: 3, len: 8, side: 1 },
    { at: 5, len: 5, side: -1 },
  ];
  for (const ly of layerDefs) {
    let curId = 0;
    for (let i = 0; i < ly.at; i++) curId = trunkChild(sk, curId);
    const b = addNode(sk, curId, [ly.side * 3, 1, 0.4], 1.8, 'branch');
    growBranch(sk, b, 3, rng, 1.1);
    void ly.len;
  }
  // 顶梢小枝
  growBranch(sk, t1, 2, rng, 0.8);
  return sk;
}

/** 真柏：临水式，带舍利干窗口与神枝 */
function makeShimpaku(): Skeleton {
  const sk = newSkeleton();
  const rng = mulberry32(23);
  const root = addNode(sk, -1, [0, 0, 0], 6.2, 'trunk');
  addRoots(sk, root, rng);
  const t1 = chain(
    sk,
    root,
    [
      [-0.5, 4.4, 0.3],
      [-0.9, 4.0, 0.6],
      [-1.2, 3.6, 0.9],
      [-1.6, 3.0, 1.0],
      [-1.7, 2.6, 0.6],
      [-1.2, 2.8, 0.2],
    ],
    5.2,
    0.83,
  );
  // 主枝向水面探出
  const b1 = addNode(sk, trunkChild(sk, root), [-3.2, -0.4, 1.6], 2.2, 'branch');
  growBranch(sk, b1, 3, rng, 1.4);
  const b2 = addNode(sk, t1, [2.6, 0.6, -1.2], 1.4, 'branch');
  growBranch(sk, b2, 3, rng, 0.9);
  growBranch(sk, t1, 2, rng, 0.7);
  return sk;
}

/** 榆树：大树型，浓密分枝 */
function makeElm(): Skeleton {
  const sk = newSkeleton();
  const rng = mulberry32(37);
  const root = addNode(sk, -1, [0, 0, 0], 7.0, 'trunk');
  addRoots(sk, root, rng);
  const t1 = chain(
    sk,
    root,
    [
      [0.3, 5, -0.2],
      [-0.5, 5, 0.3],
      [0.4, 4.6, -0.1],
      [0, 4.2, 0.2],
    ],
    6.0,
    0.78,
  );
  const trunkKids: number[] = [];
  let cur = root;
  while (cur !== t1) {
    trunkKids.push(cur);
    cur = trunkChild(sk, cur);
  }
  for (let i = 1; i < trunkKids.length; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const b = addNode(sk, trunkKids[i], [side * (3.4 - i * 0.4), 1.2, (rng() - 0.5) * 2], 2.4 - i * 0.35, 'branch');
    growBranch(sk, b, 3, rng, 1.5 - i * 0.2);
  }
  growBranch(sk, t1, 3, rng, 1.2);
  return sk;
}

/** 三角梅：悬崖式素材 */
function makeBougainvillea(): Skeleton {
  const sk = newSkeleton();
  const rng = mulberry32(51);
  const root = addNode(sk, -1, [0, 0, 0], 4.8, 'trunk');
  addRoots(sk, root, rng);
  const t1 = chain(
    sk,
    root,
    [
      [0.6, 4.0, 0],
      [1.4, 3.4, 0.4],
      [2.2, 1.8, 0.8],
      [2.6, -0.6, 1.4],
      [2.0, -2.6, 2.2],
      [1.0, -3.0, 2.6],
    ],
    4.0,
    0.8,
  );
  const b1 = addNode(sk, trunkChild(sk, root), [2.8, 0.4, -1.4], 1.6, 'branch');
  growBranch(sk, b1, 3, rng, 1.0);
  growBranch(sk, t1, 3, rng, 1.1);
  return sk;
}

/** 压力测试：递归生成 ≥3000 节点的老桩 */
function makeStressTree(targetNodes = 3000): Skeleton {
  const sk = newSkeleton();
  const rng = mulberry32(99);
  const root = addNode(sk, -1, [0, 0, 0], 9.0, 'trunk');
  addRoots(sk, root, rng);
  let t = root;
  for (let i = 0; i < 7; i++) {
    t = addNode(sk, t, [(rng() - 0.5) * 1.6, 4, (rng() - 0.5) * 1.2], 7.5 - i * 0.8, 'trunk');
    // 每个主干节挂 2 个深侧枝
    for (let k = 0; k < 2; k++) {
      const ang = rng() * Math.PI * 2;
      const b = addNode(sk, t, [Math.cos(ang) * 3, 1.4, Math.sin(ang) * 3], 2.6 - i * 0.25, 'branch');
      growBranch(sk, b, 6, rng, 1.8);
      if (sk.nodes.length >= targetNodes) break;
    }
  }
  growBranch(sk, t, 5, rng, 1.4);
  // 补足到目标节点数：在现有枝梢上继续抽深侧枝
  let guard = 0;
  while (sk.nodes.length < targetNodes && guard++ < 400) {
    const host = sk.nodes[1 + Math.floor(rng() * (sk.nodes.length - 1))];
    if (!host || host.type === 'root' || host.type === 'buttress') continue;
    if (host.radius < 0.5) continue;
    const ang = rng() * Math.PI * 2;
    const b = addNode(
      sk,
      host.id,
      [Math.cos(ang) * 2.4, 1.6, Math.sin(ang) * 2.4],
      Math.max(0.12, host.radius * 0.5),
      'branch',
    );
    growBranch(sk, b, 5, rng, Math.max(0.15, host.radius * 0.35));
  }
  return sk;
}

export interface SampleTree {
  record: TreeRecord;
  shari?: { startNode: number; endNode: number; angleStart: number; angleEnd: number };
  jinNode?: number;
}

export function buildSampleTrees(): SampleTree[] {
  const pine = makePine();
  const shimpaku = makeShimpaku();
  const elm = makeElm();
  const bou = makeBougainvillea();
  const stress = makeStressTree(3000);

  // 真柏舍利窗口：主干第 2~4 节朝正面的剥皮面
  const shariNodeA = trunkChild(shimpaku, 0);
  const shariNodeB = trunkChild(shimpaku, shariNodeA);
  const shariEnd = trunkChild(shimpaku, shariNodeB);
  // 神枝：顶梢一枝枯死
  const jinNode = shimpaku.nodes[shimpaku.nodes.length - 1].id;

  const mk = (name: string, species: SpeciesId, skeleton: Skeleton, notes: string): TreeRecord => ({
    id: uid('tree'),
    name,
    species,
    createdAt: Date.now(),
    skeleton,
    notes,
  });

  return [
    { record: mk('五针松·斜干老桩', 'goyomatsu', pine, '三层枝片，斜干，素材约 35 年') },
    {
      record: mk('真柏·临水舍利', 'shimpaku', shimpaku, '主干带舍利干，一枝神枝，临水造型'),
      shari: { startNode: shariNodeA, endNode: shariEnd, angleStart: -0.5, angleEnd: 0.9 },
      jinNode,
    },
    { record: mk('榆树·大树型', 'elm', elm, '枝密，适合截干蓄枝') },
    { record: mk('三角梅·悬崖素材', 'bougainvillea', bou, '半悬崖，花勤') },
    { record: mk('压测老桩·三千节', 'goyomatsu', stress, `性能测试用，节点数 ${stress.nodes.length}`) },
  ];
}
