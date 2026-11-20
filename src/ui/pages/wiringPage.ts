import { h, button, panel, field, select, toast } from '../dom';
import { store } from '../../core/store';
import { mountScene } from '../sceneMount';
import { WIRE_GAUGES, gaugeMm, recommendGauge, SPECIES } from '../../core/species';
import { ancestorChain } from '../../core/skeleton';
import { buildSpanFromChain } from '../../three/bendController';
import { uid } from '../../core/id';
import { statsLabel } from '../statsLabel';
import * as THREE from 'three';
import type { Wire, WireMaterial } from '../../core/types';

export class WiringPage {
  private handle: ReturnType<typeof mountScene> | null = null;
  private picked: number[] = [];
  private material: WireMaterial = store.settings.defaultWireMaterial;
  private gauge = 4;
  private direction: 1 | -1 = 1;
  private forkMode = false;
  private forkPicked: number[] = [];

  constructor(private root: HTMLElement) {
    if (!store.currentTree || !store.currentPlan) {
      this.root.append(h('div', { class: 'hud' }, '请先选择桩材并创建方案'));
      return;
    }
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';
    const tree = store.currentTree!;
    const plan = store.currentPlan!;
    const side = h('div', { class: 'sidebar' });
    const view = h('div', { class: 'viewport' });
    this.root.append(side, view);
    this.handle = mountScene(view, tree, plan);
    const hud = h('div', { class: 'hud', id: 'wire-hud' }, '点选枝条节点（从锚点到梢），再点「生成缠丝」');
    view.append(hud);

    const matSel = select(
      [
        ['aluminum', '铝丝（软，常用）'],
        ['copper', '铜丝（硬，定型强）'],
      ],
      this.material,
      (v) => (this.material = v as WireMaterial),
    );
    const gaugeSel = select(
      WIRE_GAUGES.map((g) => [String(g.gauge), `${g.gauge} 号 · Ø${g.mm}mm`]),
      String(this.gauge),
      (v) => (this.gauge = Number(v)),
    );

    side.append(
      panel(
        '上丝参数',
        field('丝材', matSel),
        field('号数', gaugeSel),
        field(
          '绕向',
          select(
            [
              ['1', '顺时针 45°'],
              ['-1', '逆时针 45°'],
            ],
            String(this.direction),
            (v) => (this.direction = Number(v) as 1 | -1),
          ),
        ),
        h('label', { class: 'switch' }, h('input', {
          type: 'checkbox',
          onchange: (e) => (this.forkMode = (e.target as HTMLInputElement).checked),
        }), ' 双枝蟠扎模式（一根丝跨两枝）'),
        button('清空已选路径', () => {
          this.picked = [];
          this.forkPicked = [];
          this.updateHud();
        }),
        button('生成缠丝', () => this.createWire(), 'primary'),
      ),
      panel(
        '丝号参考',
        h('div', { class: 'status-line' }, '经验法则：丝径 ≈ 枝基部直径的 1/3\n点选枝条后这里给出推荐号数'),
        h('div', { id: 'gauge-hint', class: 'status-line mono' }, ''),
      ),
    );

    const wireList = panel('已上缠丝', h('div', { id: 'wire-list' }));
    side.append(wireList);
    this.refreshWireList();

    side.append(
      panel(
        '接触精度诊断',
        h(
          'div',
          { class: 'status-line mono', id: 'contact-report' },
          statsLabel(
            this.handle.scene.lastStats ?? {
              vertices: 0,
              triangles: 0,
              contactGap: this.handle.scene.getContactReport().gap,
              contactPen: this.handle.scene.getContactReport().pen,
              ms: 0,
            },
            store.settings.contactGapLimit,
          ),
        ),
      ),
    );

    const canvas = view.querySelector('canvas')!;
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      const id = this.handle!.scene.pickNode(ndc);
      if (id < 0) return;
      if (this.forkMode) this.forkPicked.push(id);
      else this.picked.push(id);
      this.updateHud();
      this.updateGaugeHint(id);
    });
  }

  private updateHud(): void {
    const el = document.getElementById('wire-hud');
    if (!el) return;
    const main = this.picked.length ? `主路径节点: #${this.picked.join(' → #')}` : '尚未选择主路径';
    const fork = this.forkPicked.length ? `\n第二枝: #${this.forkPicked.join(' → #')}` : '';
    el.textContent = `${main}${fork}\n丝: ${this.material === 'aluminum' ? '铝' : '铜'} ${gaugeMm(this.gauge)}mm`;
  }

  private updateGaugeHint(nodeId: number): void {
    const tree = store.currentTree!;
    const r = tree.skeleton.nodes[nodeId].radius;
    const rec = recommendGauge(r, this.material);
    const el = document.getElementById('gauge-hint');
    if (el) {
      el.textContent =
        `节点 #${nodeId} 枝粗 Ø${(r * 2).toFixed(1)}cm\n` +
        `推荐丝号: ${rec} 号（Ø${gaugeMm(rec)}mm）\n` +
        `当前: ${this.gauge} 号（Ø${gaugeMm(this.gauge)}mm）`;
    }
  }

  private createWire(): void {
    if (this.picked.length < 2) return toast('至少点选两个节点（锚点→梢）');
    const plan = store.currentPlan!;
    // 以最先选的节点为锚点，构造祖先链路径
    const anchor = this.picked[0];
    const end = this.picked[this.picked.length - 1];
    const chain = ancestorChain(store.currentTree!.skeleton, end).filter((id) => {
      // 只保留锚点及以下
      return id === anchor || ancestorChain(store.currentTree!.skeleton, id).includes(anchor);
    });
    if (!chain.includes(anchor)) return toast('路径无效：末端不在锚点子树内');
    const span = buildSpanFromChain(chain, {
      anchor,
      reverseAt: [],
      direction: this.direction,
      phase: 0,
    });

    // 双枝蟠扎：第二枝从共同分叉点起
    if (this.forkMode && this.forkPicked.length >= 2) {
      const fEnd = this.forkPicked[this.forkPicked.length - 1];
      const fChain = ancestorChain(store.currentTree!.skeleton, fEnd);
      span.forkPath = [...fChain].reverse();
      span.reverseAt = [fChain[fChain.length - 1]]; // 过分叉换向
    }

    const wire: Wire = {
      id: uid('wire'),
      spec: { material: this.material, gauge: this.gauge },
      spans: [span],
      appliedYear: plan.year,
      active: true,
    };
    plan.wires.push(wire);
    void store.savePlans().then(() => {
      const stats = this.handle!.scene.rebuild();
      const rep = document.getElementById('contact-report');
      if (rep) rep.textContent = statsLabel(stats, store.settings.contactGapLimit);
      this.picked = [];
      this.forkPicked = [];
      this.updateHud();
      this.refreshWireList();
      toast(`缠丝已生成：${wire.spec.material === 'aluminum' ? '铝' : '铜'}丝 ${this.gauge} 号，间隙残差 ${(stats.contactGap * 10).toFixed(2)}mm`);
    });
  }

  private refreshWireList(): void {
    const el = document.getElementById('wire-list');
    if (!el) return;
    el.innerHTML = '';
    const plan = store.currentPlan!;
    const sp = SPECIES[tree_species()];
    if (!plan.wires.length) {
      el.append(h('div', { class: 'muted' }, '暂无缠丝'));
      return;
    }
    for (const w of plan.wires) {
      const age = plan.year - w.appliedYear;
      const limit = w.spec.material === 'aluminum' ? sp.maxWireYearsAl : sp.maxWireYearsCu;
      const overdue = w.active && age > limit;
      const item = h(
        'div',
        { class: `wire-item ${overdue ? 'overdue' : ''}` },
        h('div', {}, `${w.active ? '🟢' : '⚪'} ${w.spec.material === 'aluminum' ? '铝' : '铜'}丝 ${w.spec.gauge} 号 · 第 ${w.appliedYear} 年上${w.removedYear !== undefined ? ` / 第 ${w.removedYear} 年拆` : ''}`),
        h('div', { class: 'muted' }, `路径 ${w.spans[0]?.path.length ?? 0} 节点${w.spans[0]?.forkPath ? ' · 双枝' : ''}${overdue ? ' · ⚠ 超期勒伤风险' : ''}`),
        w.active
          ? button('拆丝（保留勒痕）', () => {
              w.active = false;
              w.removedYear = plan.year;
              void store.savePlans().then(() => this.handle!.scene.rebuild());
              this.refreshWireList();
            }, 'small')
          : h('span', { class: 'badge' }, '已拆除'),
      );
      el.append(item);
    }
  }

  dispose(): void {
    this.handle?.dispose();
  }
}

function tree_species() {
  return store.currentTree!.species;
}
