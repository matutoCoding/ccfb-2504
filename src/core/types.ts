// 盆景蟠扎造型推演系统 —— 核心数据模型

export type SpeciesId = 'goyomatsu' | 'shimpaku' | 'elm' | 'bougainvillea';

export type FoliageKind = 'pine' | 'juniper' | 'elm' | 'bougainvillea';

export interface SpeciesInfo {
  id: SpeciesId;
  name: string;
  latin: string;
  /** 最小弯曲半径 = flexibility * 枝径（厘米/厘米） */
  flexibility: number;
  foliage: FoliageKind;
  /** 每年半径增粗比例 */
  growthRate: number;
  /** 铝丝/铜丝最多留园年数（逾期勒伤风险） */
  maxWireYearsAl: number;
  maxWireYearsCu: number;
  /** 换盆周期（年） */
  repotYears: number;
  /** 上丝/修剪季节（月份） */
  wireSeason: number[];
  pruneSeason: number[];
  barkColor: number;
  deadwoodCapable: boolean;
}

export type NodeType = 'trunk' | 'branch' | 'twig' | 'root' | 'buttress' | 'dead';

export interface SkeletonNode {
  id: number;
  parent: number;
  type: NodeType;
  /** 相对父节点的静止局部位置（厘米） */
  pos: [number, number, number];
  /** 节点处枝粗半径（厘米） */
  radius: number;
  children: number[];
}

export interface Skeleton {
  nodes: SkeletonNode[];
}

/** 舍利干（shari：主干上的剥皮窗口）/ 神枝（jin：整枝枯死） */
export interface DeadRegion {
  id: string;
  kind: 'shari' | 'jin';
  /** shari: 沿祖先链的起止节点；jin: startNode 子树整体作神枝 */
  startNode: number;
  endNode: number;
  /** 相对枝轴的方位角窗口（弧度） */
  angleStart: number;
  angleEnd: number;
  year: number;
}

/** 修剪伤口截面 */
export interface Wound {
  id: string;
  nodeId: number;
  year: number;
  radius: number;
  /** 0..1 愈合进度 */
  heal: number;
}

/** 拆丝后残留的勒痕（螺旋相位对应缠丝相位） */
export interface Scar {
  id: string;
  nodeId: number;
  depth: number;
  phase: number;
  /** 槽宽（弧度角） */
  width: number;
  heal: number;
  year: number;
}

export type WireMaterial = 'aluminum' | 'copper';

export interface WireGauge {
  /** 号数（日式番线号，号越大丝越细） */
  gauge: number;
  /** 直径毫米 */
  mm: number;
}

export interface WireSpec {
  material: WireMaterial;
  gauge: number;
}

export interface WireSpan {
  /** 锚点节点（丝固定处） */
  anchorNode: number;
  /** 主路径节点（有序，含 anchor 与 end） */
  path: number[];
  endNode: number;
  /** 双枝蟠扎：第二枝路径（从分叉点起） */
  forkPath?: number[];
  /** 缠绕换向的节点 id（过分叉处） */
  reverseAt: number[];
  direction: 1 | -1;
  phase: number;
}

export interface Wire {
  id: string;
  spec: WireSpec;
  spans: WireSpan[];
  appliedYear: number;
  removedYear?: number;
  active: boolean;
  note?: string;
}

export type CareEventType = 'wire-on' | 'wire-off' | 'prune' | 'repot' | 'scar-warning';

export interface CareEvent {
  id: string;
  year: number;
  month: number;
  type: CareEventType;
  title: string;
  detail: string;
  done: boolean;
  wireId?: string;
  risk?: boolean;
}

export interface CarePlan {
  events: CareEvent[];
  generatedAt: number;
}

export interface PotChoice {
  style: 'tokoname' | 'round' | 'cascade' | 'slab' | 'none';
  color: number;
  width: number;
}

export interface Plan {
  id: string;
  treeId: string;
  name: string;
  createdAt: number;
  /** 推演年数（0 = 建档当年） */
  year: number;
  /** 节点 id -> 编辑姿态四元数（相对静止骨架） */
  editRot: Record<number, [number, number, number, number]>;
  wires: Wire[];
  deadRegions: DeadRegion[];
  wounds: Wound[];
  scars: Scar[];
  /** 修剪节点 id -> 年份 */
  pruned: Record<number, number>;
  /** 整体疏叶的枝片节点 id */
  defoliated: number[];
  foliageDensity: number;
  care: CarePlan;
  frontAzimuth: number;
  trunkTiltTarget: number;
  pot: PotChoice;
  stand: string;
}

export interface TreeRecord {
  id: string;
  name: string;
  species: SpeciesId;
  createdAt: number;
  skeleton: Skeleton;
  notes?: string;
}

export interface Settings {
  theme: 'dark' | 'light';
  defaultWireMaterial: WireMaterial;
  /** 诊断阈值：丝-皮间隙相对丝径上限 */
  contactGapLimit: number;
  showHelpers: boolean;
  quality: 'perf' | 'balanced' | 'quality';
}

export interface AppDB {
  trees: TreeRecord[];
  plans: Plan[];
  settings: Settings;
}
