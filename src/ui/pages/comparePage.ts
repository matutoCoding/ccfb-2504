import { h, button, panel, toast } from '../dom';
import { store } from '../../core/store';
import { BonsaiScene } from '../../three/bonsaiScene';
import type { Plan } from '../../core/types';

export class ComparePage {
  private scenes: BonsaiScene[] = [];
  private observers: ResizeObserver[] = [];
  private linked = true;
  private syncing = false;

  constructor(private root: HTMLElement) {
    if (!store.currentTree) {
      this.root.append(h('div', { class: 'hud' }, '请先选择桩材'));
      return;
    }
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';
    const tree = store.currentTree!;
    const plans = store.plansOf(tree.id);
    const side = h('div', { class: 'sidebar' });
    const grid = h('div', { class: `compare-grid ${Math.min(3, Math.max(2, plans.length || 2)) === 2 ? 'c2' : 'c3'}` });
    this.root.append(side, grid);

    side.append(
      panel(
        '方案对比',
        h('p', { class: 'muted' }, '同一棵桩的多个方案并排，相机旋转/缩放联动'),
        h('label', { class: 'switch' }, h('input', {
          type: 'checkbox',
          checked: true,
          onchange: (e) => (this.linked = (e.target as HTMLInputElement).checked),
        }), ' 视角联动'),
        button('新建方案', () => {
          store.createPlan(tree.id);
          this.render();
        }, 'primary'),
        button('重开当前布局', () => this.render()),
      ),
    );

    const planList = panel(
      '本桩方案',
      ...plans.map((p) =>
        h(
          'div',
          { class: 'wire-item' },
          h('div', {}, p.name),
          h('div', { class: 'muted' }, `第 ${p.year} 年 · 丝 ${p.wires.length} · 舍利 ${p.deadRegions.length} · 勒痕 ${p.scars.length}`),
          button('删除', () => {
            if (plans.length <= 1) return toast('至少保留一个方案');
            void store.deletePlan(p.id).then(() => this.render());
          }, 'small danger'),
        ),
      ),
    );
    side.append(planList);

    if (plans.length === 0) {
      grid.append(h('div', { class: 'hud' }, '还没有方案，先在左侧新建'));
      return;
    }

    const show = plans.slice(0, 3);
    for (const p of show) {
      const cell = h('div', { class: 'compare-cell' });
      cell.append(h('div', { class: 'tag' }, p.name));
      grid.append(cell);
      const canvas = document.createElement('canvas');
      cell.append(canvas);
      const scene = new BonsaiScene(canvas, tree, p);
      const r = cell.getBoundingClientRect();
      scene.resize(Math.max(100, r.width || cell.clientWidth || 400), Math.max(100, r.height || cell.clientHeight || 400));
      scene.rebuild();
      scene.start();
      this.scenes.push(scene);
      const ro = new ResizeObserver(() => {
        const cr = cell.getBoundingClientRect();
        scene.resize(Math.max(100, cr.width), Math.max(100, cr.height));
      });
      ro.observe(cell);
      this.observers.push(ro);
    }

    // 相机联动：任一场景 controls 变化 -> 广播
    for (const s of this.scenes) {
      s.controls.addEventListener('change', () => {
        if (!this.linked || this.syncing) return;
        this.syncing = true;
        for (const o of this.scenes) if (o !== s) o.syncCameraFrom(s);
        this.syncing = false;
      });
    }
    // 首帧统一视角
    if (this.scenes.length > 1) {
      for (const o of this.scenes.slice(1)) o.syncCameraFrom(this.scenes[0]);
    }
  }

  dispose(): void {
    for (const ro of this.observers) ro.disconnect();
    this.observers = [];
    for (const s of this.scenes) s.dispose();
    this.scenes = [];
  }
}

export function planSummary(p: Plan): string {
  return `年${p.year} 丝${p.wires.length} 剪${Object.keys(p.pruned).length} 痕${p.scars.length}`;
}
