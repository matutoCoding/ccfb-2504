import { h, button, panel, field, select, toast } from '../dom';
import { store } from '../../core/store';
import { storage } from '../../core/db';

export class SettingsPage {
  constructor(private root: HTMLElement) {
    this.render();
  }

  private render(): void {
    const s = store.settings;
    const side = h('div', { class: 'sidebar' });
    const body = h('div', { style: 'flex:1;overflow:auto;padding:18px' });
    this.root.append(side, body);

    side.append(
      panel(
        '外观',
        field(
          '主题',
          select(
            [
              ['dark', '深色'],
              ['light', '浅色'],
            ],
            s.theme,
            (v) => {
              s.theme = v as 'dark' | 'light';
              void store.saveSettings().then(() => this.render());
            },
          ),
        ),
      ),
      panel(
        '蟠扎默认值',
        field(
          '默认丝材',
          select(
            [
              ['aluminum', '铝丝'],
              ['copper', '铜丝'],
            ],
            s.defaultWireMaterial,
            (v) => {
              s.defaultWireMaterial = v as 'aluminum' | 'copper';
              void store.saveSettings();
            },
          ),
        ),
        field(
          '渲染质量',
          select(
            [
              ['perf', '性能优先'],
              ['balanced', '均衡'],
              ['quality', '质量优先'],
            ],
            s.quality,
            (v) => {
              s.quality = v as typeof s.quality;
              void store.saveSettings();
            },
          ),
        ),
        h('label', { class: 'switch' }, h('input', {
          type: 'checkbox',
          checked: s.showHelpers,
          onchange: (e) => {
            s.showHelpers = (e.target as HTMLInputElement).checked;
            void store.saveSettings();
          },
        }), ' 显示辅助标记'),
      ),
      panel(
        '接触精度阈值',
        (() => {
          const inp = h('input', { type: 'range', min: '0.05', max: '0.3', step: '0.01', value: String(s.contactGapLimit) });
          inp.addEventListener('change', () => {
            s.contactGapLimit = Number(inp.value);
            void store.saveSettings();
          });
          return field('丝-皮间隙 / 丝径上限', inp);
        })(),
        h('div', { class: 'muted' }, `当前 ${(s.contactGapLimit * 100).toFixed(0)}%（需求红线 10%）`),
      ),
    );

    body.append(
      panel(
        '数据管理（IndexedDB）',
        h('div', { class: 'status-line' }, `桩材 ${store.trees.length} 棵 · 方案 ${store.plans.length} 个`),
        h('div', {
          class: 'row',
          style: 'margin-top:10px',
        } as Record<string, string>),
        button('导出 JSON 备份', () => this.exportData(), 'primary'),
        button('从 JSON 导入（覆盖当前库）', () => this.importData()),
        button('清空全部数据', () => this.wipe(), 'danger'),
      ),
      panel(
        '系统说明',
        h('div', { class: 'status-line' },
          '· 树皮网格在静止姿态一次构建，分叉处以面积法则焊接球融合，无穿插无缝\n' +
          '· 弯枝走 GPU 蒙皮：3000 节点每帧仅更新骨骼矩阵，拖拽跟手\n' +
          '· 缠丝顶点复制同站位树皮蒙皮权重，任意弯曲下丝-皮相对间隙恒定\n' +
          '· 年度推演：枝条增粗、逾期丝勒入树皮生成螺旋勒痕、拆丝后逐年长平\n' +
          '· 真柏支持舍利干窗口（水线隆起）与神枝（整枝枯木质部纹理）'),
      ),
    );
  }

  private exportData(): void {
    void storage.exportJSON().then((text) => {
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bonsai-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
          URL.revokeObjectURL(a.href);
      toast('已导出 JSON 备份');
    });
  }

  private importData(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        storage
          .importJSON(String(reader.result))
          .then((db) => {
            store.trees = db.trees;
            store.plans = db.plans;
            store.settings = db.settings;
            store.currentTreeId = db.trees[0]?.id ?? null;
            store.currentPlanId = db.plans[0]?.id ?? null;
            store.emit();
            toast('导入完成');
          })
          .catch(() => toast('导入失败：JSON 格式错误'));
      };
      reader.readAsText(f);
    };
    inp.click();
  }

  private wipe(): void {
    if (!confirm('确认清空全部桩材、方案和设置？此操作不可恢复')) return;
    store.trees = [];
    store.plans = [];
    store.currentTreeId = null;
    store.currentPlanId = null;
    void store.saveTrees().then(() => store.savePlans()).then(() => {
      toast('已清空');
      this.render();
    });
  }

  dispose(): void {}
}
