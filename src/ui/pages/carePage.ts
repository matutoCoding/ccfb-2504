import { h, button, panel, toast } from '../dom';
import { store } from '../../core/store';
import { generateCarePlan } from '../../core/simulation';
import { SPECIES } from '../../core/species';
import type { CareEventType } from '../../core/types';

const TYPE_LABEL: Record<CareEventType, string> = {
  'wire-on': '🔩 上丝',
  'wire-off': '🧰 拆丝',
  prune: '✂️ 修剪',
  repot: '🪴 换盆',
  'scar-warning': '⚠ 勒伤预警',
};

export class CarePage {
  constructor(private root: HTMLElement) {
    if (!store.currentTree || !store.currentPlan) {
      this.root.append(h('div', { class: 'hud' }, '请先选择桩材和方案'));
      return;
    }
    this.render();
  }

  private render(): void {
    const tree = store.currentTree!;
    const plan = store.currentPlan!;
    const sp = SPECIES[tree.species];
    const side = h('div', { class: 'sidebar' });
    const body = h('div', { style: 'flex:1;overflow:auto;padding:18px;min-width:0' });
    this.root.append(side, body);

    side.append(
      panel(
        '养护排程',
        h('p', { class: 'muted' }, `按「${plan.name}」自动生成上丝/拆丝/修剪/换盆时间表\n勒痕风险提前一年预警`),
        button('重新生成养护计划', () => {
          plan.care.events = [];
          generateCarePlan(tree, plan);
          void store.savePlans().then(() => {
            toast(`已生成 ${plan.care.events.length} 条养护事项`);
            this.render();
          });
        }, 'primary'),
      ),
      panel(
        '树种参数',
        h('div', { class: 'status-line' },
          `铝丝最长留 ${sp.maxWireYearsAl} 年\n铜丝最长留 ${sp.maxWireYearsCu} 年\n换盆周期 ${sp.repotYears} 年\n上丝季节 ${sp.wireSeason.join('/')} 月\n修剪季节 ${sp.pruneSeason.join('/')} 月`),
      ),
    );

    body.append(
      h('h2', { style: 'margin:4px 0 14px' }, `养护计划 · ${tree.name} · ${plan.name}`),
    );

    if (!plan.care.events.length) {
      body.append(h('div', { class: 'panel muted' }, '尚未生成计划，点左侧按钮自动排程'));
      return;
    }

    // 按年分组
    const byYear = new Map<number, typeof plan.care.events>();
    for (const e of plan.care.events) {
      const arr = byYear.get(e.year) ?? [];
      arr.push(e);
      byYear.set(e.year, arr);
    }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    for (const y of years) {
      const rows = byYear.get(y)!;
      const riskCount = rows.filter((r) => r.risk).length;
      const sec = panel(
        `第 ${y} 年${riskCount ? ` · ${riskCount} 项风险` : ''}`,
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, '月份'), h('th', {}, '事项'), h('th', {}, '说明'), h('th', {}, '状态'))),
          h(
            'tbody',
            {},
            ...rows.map((e) =>
              h(
                'tr',
                { class: e.done ? 'event-done' : e.risk ? 'event-risk' : '' },
                h('td', { class: 'mono' }, `${e.month}月`),
                h('td', {}, TYPE_LABEL[e.type]),
                h('td', {}, e.title + (e.detail ? ` —— ${e.detail}` : '')),
                h(
                  'td',
                  {},
                  h(
                    'button',
                    {
                      class: 'btn small',
                      onclick: () => {
                        e.done = !e.done;
                        void store.savePlans().then(() => this.render());
                      },
                    },
                    e.done ? '已完成' : '待办',
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      body.append(sec);
    }
  }

  dispose(): void {}
}
