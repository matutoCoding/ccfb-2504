import { storage, DEFAULT_SETTINGS } from './db';
import type { AppDB, Plan, Settings, TreeRecord } from './types';
import { uid } from './id';

type Listener = () => void;

class Store {
  trees: TreeRecord[] = [];
  plans: Plan[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  currentTreeId: string | null = null;
  currentPlanId: string | null = null;
  private listeners = new Set<Listener>();

  async init(): Promise<void> {
    const db: AppDB = await storage.loadAll();
    this.trees = db.trees;
    this.plans = db.plans;
    this.settings = db.settings;
    if (this.trees.length && !this.currentTreeId) {
      this.currentTreeId = this.trees[0].id;
      const p = this.plans.find((x) => x.treeId === this.currentTreeId);
      this.currentPlanId = p?.id ?? null;
    }
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  get currentTree(): TreeRecord | undefined {
    return this.trees.find((t) => t.id === this.currentTreeId);
  }

  get currentPlan(): Plan | undefined {
    return this.plans.find((p) => p.id === this.currentPlanId);
  }

  plansOf(treeId: string): Plan[] {
    return this.plans.filter((p) => p.treeId === treeId);
  }

  // ---------- 持久化 ----------

  async saveTrees(): Promise<void> {
    await storage.saveTrees(this.trees);
    this.emit();
  }
  async savePlans(): Promise<void> {
    await storage.savePlans(this.plans);
    this.emit();
  }
  async saveSettings(): Promise<void> {
    await storage.saveSettings(this.settings);
    this.emit();
  }

  // ---------- 树 ----------

  selectTree(id: string): void {
    this.currentTreeId = id;
    const p = this.plans.find((x) => x.treeId === id);
    this.currentPlanId = p?.id ?? null;
    this.emit();
  }

  async deleteTree(id: string): Promise<void> {
    this.trees = this.trees.filter((t) => t.id !== id);
    this.plans = this.plans.filter((p) => p.treeId !== id);
    if (this.currentTreeId === id) {
      this.currentTreeId = this.trees[0]?.id ?? null;
      this.currentPlanId = this.plans.find((p) => p.treeId === this.currentTreeId)?.id ?? null;
    }
    await storage.saveTrees(this.trees);
    await storage.savePlans(this.plans);
    this.emit();
  }

  // ---------- 方案 ----------

  createPlan(treeId: string, name?: string): Plan {
    const n = this.plans.filter((p) => p.treeId === treeId).length + 1;
    const plan: Plan = {
      id: uid('plan'),
      treeId,
      name: name ?? `方案 ${n}`,
      createdAt: Date.now(),
      year: 0,
      editRot: {},
      wires: [],
      deadRegions: [],
      wounds: [],
      scars: [],
      pruned: {},
      defoliated: [],
      foliageDensity: 1,
      care: { events: [], generatedAt: 0 },
      frontAzimuth: 0,
      trunkTiltTarget: 12,
      pot: { style: 'tokoname', color: 0x5a3d2b, width: 22 },
      stand: '红木几架',
    };
    this.plans.push(plan);
    this.currentPlanId = plan.id;
    void this.savePlans();
    return plan;
  }

  selectPlan(id: string): void {
    this.currentPlanId = id;
    this.emit();
  }

  async deletePlan(id: string): Promise<void> {
    this.plans = this.plans.filter((p) => p.id !== id);
    if (this.currentPlanId === id) {
      this.currentPlanId = this.plans.find((p) => p.treeId === this.currentTreeId)?.id ?? null;
    }
    await this.savePlans();
  }

  async updatePlan(mut: (p: Plan) => void): Promise<void> {
    const p = this.currentPlan;
    if (!p) return;
    mut(p);
    await this.savePlans();
  }
}

export const store = new Store();
