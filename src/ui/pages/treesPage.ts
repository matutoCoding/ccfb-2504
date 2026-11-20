import { h, button, panel, toast } from '../dom';
import { store } from '../../core/store';
import { SPECIES, SPECIES_LIST } from '../../core/species';
import { buildSampleTrees } from '../../core/sampleTrees';
import { makeShari, makeJin } from '../../core/simulation';
import { uid } from '../../core/id';
import type { SpeciesId, TreeRecord } from '../../core/types';
import { navigate } from '../router';

export class TreesPage {
  constructor(private root: HTMLElement) {
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';
    const side = h('div', { class: 'sidebar' });
    const view = h('div', { class: 'viewport' }, h('div', { class: 'hud' }, '选择左侧桩材查看档案，或载入测试老桩'));

    side.append(
      panel(
        '桩材库',
        button('载入 5 棵测试老桩（含舍利真柏、3000 节压测树）', () => this.seedSamples(), 'primary'),
        button('新建空桩材', () => this.createEmpty()),
      ),
    );

    const list = h('div');
    for (const t of store.trees) {
      const sp = SPECIES[t.species];
      const planCount = store.plansOf(t.id).length;
      const card = h(
        'div',
        {
          class: `card ${store.currentTreeId === t.id ? 'active' : ''}`,
          onclick: () => {
            store.selectTree(t.id);
            this.render();
          },
        },
        h('h4', {}, t.name, ' ', h('span', { class: 'badge' }, sp.name)),
        h('p', {}, `${sp.latin} · 骨架节点 ${t.skeleton.nodes.length} 个`),
        h('p', {}, t.notes ?? ''),
        h('p', {}, `造型方案 ${planCount} 个`),
        h(
          'div',
          { class: 'row', style: 'margin-top:8px' },
          button('打开骨架', () => {
            store.selectTree(t.id);
            if (!store.plansOf(t.id).length) store.createPlan(t.id, '初始方案');
            navigate('skeleton');
          }, 'small primary'),
          button(
            '删除',
            () => {
              if (confirm(`删除桩材「${t.name}」及其全部方案？`)) void store.deleteTree(t.id);
            },
            'small danger',
          ),
        ),
      );
      list.append(card);
    }
    side.append(list);
    this.root.append(side, view);

    // 右侧显示当前树档案详情
    const t = store.currentTree;
    if (t) {
      view.innerHTML = '';
      const info = panel(
        '档案详情',
        h('p', { class: 'muted' }, `ID: ${t.id}`),
        this.readOnlyField('树种', `${SPECIES[t.species].name}（${SPECIES[t.species].latin}）`),
        this.readOnlyField('节点数', String(t.skeleton.nodes.length)),
        this.readOnlyField('年增粗率', `${(SPECIES[t.species].growthRate * 100).toFixed(1)} %/年`),
        this.readOnlyField('柔韧系数', String(SPECIES[t.species].flexibility)),
        this.readOnlyField('换盆周期', `${SPECIES[t.species].repotYears} 年`),
        this.readOnlyField('可做舍利/神枝', SPECIES[t.species].deadwoodCapable ? '是' : '否'),
        h('div', { class: 'row' }, button('进入骨架编辑', () => navigate('skeleton'), 'primary'), button('蟠扎造型', () => navigate('wiring'))),
      );
      const wrap = h('div', { style: 'padding:16px;overflow:auto;width:100%' }, info);
      view.append(wrap);
    }
  }

  private readOnlyField(label: string, value: string): HTMLElement {
    return h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'mono', style: 'padding:6px 0' }, value));
  }

  private seedSamples(): void {
    const samples = buildSampleTrees();
    for (const s of samples) {
      if (store.trees.some((x) => x.name === s.record.name)) continue;
      store.trees.push(s.record);
      const plan = store.createPlan(s.record.id, '初始方案');
      // 真柏：预置舍利干与神枝
      if (s.shari) makeShari(plan, s.shari.startNode, s.shari.endNode, s.shari.angleStart, s.shari.angleEnd);
      if (s.jinNode !== undefined) makeJin(s.record, plan, s.jinNode);
    }
    void store.saveTrees().then(() => store.savePlans()).then(() => {
      toast('测试桩材已写入 IndexedDB');
      this.render();
    });
  }

  private createEmpty(): void {
    const name = prompt('桩材名称', '新桩材');
    if (!name) return;
    const species = prompt(`树种（${SPECIES_LIST.map((s) => s.id).join(' / ')}）`, 'shimpaku') as SpeciesId;
    if (!SPECIES[species]) return toast('树种无效');
    const rec: TreeRecord = {
      id: uid('tree'),
      name,
      species,
      createdAt: Date.now(),
      skeleton: {
        nodes: [
          { id: 0, parent: -1, pos: [0, 0, 0], radius: 4, type: 'trunk', children: [] },
        ],
      },
    };
    store.trees.push(rec);
    void store.saveTrees().then(() => {
      store.selectTree(rec.id);
      store.createPlan(rec.id, '初始方案');
      navigate('skeleton');
    });
  }

  dispose(): void {}
}
