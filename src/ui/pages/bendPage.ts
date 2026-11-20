import { h, button, panel, field, select, toast } from '../dom';
import { store } from '../../core/store';
import { mountScene } from '../sceneMount';
import { BendController, type BendStatus } from '../../three/bendController';
import { SPECIES } from '../../core/species';
import { advanceYear, makeJin, makeShari, pruneNode, radiiAtYear } from '../../core/simulation';
import { subtree } from '../../core/skeleton';
import * as THREE from 'three';

export class BendPage {
  private handle: ReturnType<typeof mountScene> | null = null;
  private bend: BendController | null = null;
  private selected = -1;
  private marker: THREE.Mesh | null = null;

  constructor(private root: HTMLElement) {
    if (!store.currentTree || !store.currentPlan) {
      this.root.append(h('div', { class: 'hud' }, '请先选择桩材和方案'));
      return;
    }
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';
    const tree = store.currentTree!;
    const plan = store.currentPlan!;
    const sp = SPECIES[tree.species];
    const side = h('div', { class: 'sidebar' });
    const view = h('div', { class: 'viewport' });
    this.root.append(side, view);
    this.handle = mountScene(view, tree, plan);
    const hud = h('div', { class: 'hud', id: 'bend-hud' }, '直接拖拽枝条弯曲；红色提示 = 超过最小弯曲半径会劈裂');
    view.append(hud);

    this.bend = new BendController(this.handle.scene, view.querySelector('canvas')!);
    this.handle.scene.onViolation = (text) => {
      hud.classList.toggle('danger', !!text);
      if (text) hud.textContent = text;
      else hud.textContent = '直接拖拽枝条弯曲；红色提示 = 超过最小弯曲半径会劈裂';
    };
    this.bend.onStatus = (s: BendStatus | null) => this.showStatus(s);
    this.bend.onFirstPick = (id) => {
      this.selected = id;
      this.showMarker(id);
    };

    side.append(
      panel(
        '年度推演',
        h('p', { class: 'muted' }, `当前第 ${plan.year} 年 · 树种柔韧系数 ${sp.flexibility}（最小弯曲半径 = ${sp.flexibility}×枝径）`),
        h('div', { class: 'row' }, button('推进 1 年', () => this.grow(), 'primary'), button('回退 1 年', () => this.rewind())),
        h('div', { id: 'grow-warn', class: 'status-line' }, ''),
      ),
    );

    const actionPanel = panel(
      '修剪 / 舍利 / 疏叶',
      h('div', { class: 'muted', id: 'sel-info' }, '点选一个节点后操作'),
      button('修剪此枝（留伤口截面）', () => this.doPrune(), 'danger'),
      sp.deadwoodCapable
        ? h(
            'div',
            {},
            button('做舍利干窗口（主干剥皮）', () => this.doShari()),
            button('做神枝（整枝枯死剥皮）', () => this.doJin()),
          )
        : h('div', { class: 'muted' }, `${sp.name}不做舍利/神枝`),
      button('此枝片整体疏叶', () => this.doDefoliate()),
      button('恢复此枝片叶片', () => this.undoDefoliate()),
    );
    side.append(actionPanel);

    side.append(
      panel(
        '叶簇密度',
        (() => {
          const inp = h('input', { type: 'range', min: '0.3', max: '1.6', step: '0.1', value: String(plan.foliageDensity) });
          inp.addEventListener('input', () => {
            plan.foliageDensity = Number(inp.value);
            this.handle!.scene.foliage?.update(this.handle!.scene.pose, plan);
          });
          inp.addEventListener('change', () => void store.savePlans());
          return field('全局缩放', inp);
        })(),
      ),
      panel(
        '状态统计',
        h('div', { class: 'status-line mono', id: 'bend-stats' }, this.statsText()),
      ),
    );

    const canvas = view.querySelector('canvas')!;
    canvas.addEventListener('pointerdown', (e) => {
      // BendController 已处理拖拽；这里补充纯点选
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      const id = this.handle!.scene.pickNode(ndc);
      if (id >= 0) {
        this.selected = id;
        this.showMarker(id);
      }
    });
  }

  private showStatus(s: BendStatus | null): void {
    const el = document.getElementById('sel-info');
    if (!el || !s) return;
    el.innerHTML = '';
    el.append(
      h('div', {}, `节点 #${s.nodeId}`),
      h('div', { class: s.ok ? 'badge ok' : 'badge warn' }, s.ok ? '弯曲安全' : '劈裂风险'),
      h('div', { class: 'status-line mono' }, `当前半径 ${s.actualR === Infinity ? '∞' : s.actualR.toFixed(1)}cm / 安全下限 ${s.minR.toFixed(1)}cm\n推荐丝号 ${s.recommendedGauge} 号`),
    );
  }

  private showMarker(id: number): void {
    if (this.marker) this.handle!.scene.scene.remove(this.marker);
    const r = store.currentTree!.skeleton.nodes[id].radius;
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.2 + 0.25, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x6cb2e8, wireframe: true }),
    );
    this.handle!.scene.scene.add(this.marker);
    this.handle!.scene.onFrame = () => {
      if (this.marker) this.marker.position.copy(this.handle!.scene.pose.worldPos[id]);
    };
    const info = document.getElementById('sel-info');
    if (info) {
      const node = store.currentTree!.skeleton.nodes[id];
      info.textContent = `节点 #${id}（${node.type}）粗度半径 ${node.radius.toFixed(2)}cm · 子树 ${subtree(store.currentTree!.skeleton, id).length} 节点`;
    }
  }

  private doPrune(): void {
    if (this.selected < 0) return toast('请先点选枝条');
    pruneNode(store.currentTree!, store.currentPlan!, this.selected);
    void store.savePlans().then(() => {
      this.handle!.scene.rebuild();
      toast('已修剪：伤口截面已生成');
      this.updateStats();
    });
  }

  private doShari(): void {
    if (this.selected < 0) return;
    // 向上找主干链上的两个节点
    const sk = store.currentTree!.skeleton;
    const end = this.selected;
    let start = sk.nodes[end].parent;
    if (start < 0) return toast('根节点不能做舍利窗口');
    if (sk.nodes[start].parent >= 0) start = sk.nodes[start].parent;
    makeShari(store.currentPlan!, start, end, -0.6, 0.8);
    void store.savePlans().then(() => {
      this.handle!.scene.rebuild();
      toast('舍利干窗口已开：水线隆起、露出纹理木质部');
    });
  }

  private doJin(): void {
    if (this.selected < 0) return toast('请先点选枝条');
    makeJin(store.currentTree!, store.currentPlan!, this.selected);
    void store.saveTrees().then(() => store.savePlans()).then(() => {
      this.handle!.scene.rebuild();
      toast('神枝完成：整枝剥皮枯死');
    });
  }

  private doDefoliate(): void {
    if (this.selected < 0) return;
    const plan = store.currentPlan!;
    if (!plan.defoliated.includes(this.selected)) plan.defoliated.push(this.selected);
    void store.savePlans().then(() => {
      this.handle!.scene.rebuild();
      toast('枝片已疏叶');
    });
  }

  private undoDefoliate(): void {
    const plan = store.currentPlan!;
    plan.defoliated = plan.defoliated.filter((id) => id !== this.selected);
    void store.savePlans().then(() => this.handle!.scene.rebuild());
  }

  private grow(): void {
    const result = advanceYear(store.currentTree!, store.currentPlan!);
    void store.savePlans().then(() => {
      const stats = this.handle!.scene.rebuild();
      const w = document.getElementById('grow-warn');
      if (w) {
        w.innerHTML = '';
        w.append(
          h('div', {}, `第 ${store.currentPlan!.year} 年：网格重建 ${stats.ms.toFixed(1)}ms`),
          ...result.warnings.map((x) => h('div', { class: 'event-risk' }, `⚠ ${x}`)),
        );
      }
      this.updateStats();
    });
  }

  private rewind(): void {
    const plan = store.currentPlan!;
    if (plan.year <= 0) return;
    plan.year -= 1;
    for (const s of plan.scars) s.heal = Math.max(0, s.heal - 0.12);
    void store.savePlans().then(() => this.handle!.scene.rebuild());
  }

  private statsText(): string {
    const tree = store.currentTree!;
    const plan = store.currentPlan!;
    const radii = radiiAtYear(tree, plan);
    const rootR = radii[0];
    return [
      `年份 第${plan.year}年`,
      `根基粗 Ø${(rootR * 2).toFixed(1)}cm`,
      `缠丝 ${plan.wires.length}（活跃 ${plan.wires.filter((w) => w.active).length}）`,
      `勒痕 ${plan.scars.length} · 伤口 ${plan.wounds.length} · 舍利/神枝 ${plan.deadRegions.length}`,
    ].join('\n');
  }

  private updateStats(): void {
    const el = document.getElementById('bend-stats');
    if (el) el.textContent = this.statsText();
  }

  dispose(): void {
    this.bend?.dispose();
    this.handle?.dispose();
  }
}
