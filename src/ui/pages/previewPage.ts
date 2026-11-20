import { h, button, panel, field, select } from '../dom';
import { store } from '../../core/store';
import { mountScene } from '../sceneMount';

const POTS: [string, string][] = [
  ['tokoname', '常滑方盆'],
  ['round', '圆盆'],
  ['cascade', '悬崖深盆'],
  ['slab', '石板盆'],
  ['none', '不配盆'],
];

export class PreviewPage {
  private handle: ReturnType<typeof mountScene> | null = null;

  constructor(private root: HTMLElement) {
    if (!store.currentTree || !store.currentPlan) {
      this.root.append(h('div', { class: 'hud' }, '请先选择桩材和方案'));
      return;
    }
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';
    const plan = store.currentPlan!;
    const side = h('div', { class: 'sidebar' });
    const view = h('div', { class: 'viewport' });
    this.root.append(side, view);
    this.handle = mountScene(view, store.currentTree!, plan);
    const hud = h('div', { class: 'hud', id: 'pv-hud' }, '');
    view.append(hud);

    const azimuth = h('input', { type: 'range', min: '0', max: '360', step: '5', value: String(plan.frontAzimuth) });
    azimuth.addEventListener('input', () => {
      this.handle!.scene.setFrontAzimuth(Number(azimuth.value));
      plan.frontAzimuth = Number(azimuth.value);
      this.updateHud();
    });
    azimuth.addEventListener('change', () => void store.savePlans());

    const rimAz = h('input', { type: 'range', min: '0', max: '360', step: '10', value: '60' });
    const rimInt = h('input', { type: 'range', min: '0', max: '4', step: '0.1', value: '1.1' });
    const applyLight = () => this.handle!.scene.setRimLight(Number(rimAz.value), Number(rimInt.value));
    rimAz.addEventListener('input', applyLight);
    rimInt.addEventListener('input', applyLight);

    const potSel = select(POTS, plan.pot.style, (v) => {
      plan.pot.style = v as typeof plan.pot.style;
      void store.savePlans().then(() => this.handle!.scene.rebuild());
    });
    const potW = h('input', { type: 'range', min: '12', max: '40', step: '1', value: String(plan.pot.width) });
    potW.addEventListener('change', () => {
      plan.pot.width = Number(potW.value);
      void store.savePlans().then(() => this.handle!.scene.rebuild());
    });

    let silhouette = false;
    side.append(
      panel(
        '正面设定',
        field('正面方位角（度）', azimuth),
        button('把当前相机方向设为正面', () => {
          const v = Math.round(
            THREE_math(this.handle!.scene.camera.position),
          );
          azimuth.value = String(v);
          plan.frontAzimuth = v;
          this.handle!.scene.setFrontAzimuth(v);
          void store.savePlans();
          this.updateHud();
        }, 'primary'),
      ),
      panel(
        '侧光与层次',
        field('侧光方位', rimAz),
        field('侧光强度', rimInt),
      ),
      panel(
        '配盆与几架',
        field('盆型', potSel),
        field('盆宽（cm）', potW),
        h('div', { class: 'muted' }, `几架：${plan.stand}`),
      ),
      panel(
        '构图检查',
        button('剪影轮廓模式（三角构图/主干倾角）', () => {
          silhouette = !silhouette;
          this.handle!.scene.setSilhouette(silhouette);
          this.updateHud();
        }),
        h('div', { id: 'comp-report', class: 'status-line mono' }, ''),
      ),
    );

    this.handle!.scene.onFrame = () => this.updateHud();
    this.updateHud();
  }

  private updateHud(): void {
    const hud = document.getElementById('pv-hud');
    const rep = document.getElementById('comp-report');
    if (!hud || !this.handle) return;
    const tilt = this.handle.scene.trunkTilt();
    const plan = store.currentPlan!;
    hud.textContent = `正面方位 ${plan.frontAzimuth}° · 主干倾角 ${tilt.toFixed(1)}°（目标 ≤ ${plan.trunkTiltTarget}°）`;
    if (rep) {
      const tiltOk = tilt <= plan.trunkTiltTarget;
      rep.textContent =
        `主干倾角: ${tilt.toFixed(1)}° ${tiltOk ? '✅' : '⚠ 偏斜'}\n` +
        `三角构图: 剪影模式下观察枝片外轮廓应呈不等边三角形\n` +
        `枝片层次: 侧光中亮/暗面应分出至少三层\n` +
        `盆树比例: 盆宽约为冠幅 1/2~2/3`;
    }
  }

  dispose(): void {
    this.handle?.dispose();
  }
}

function THREE_math(pos: { x: number; z: number }): number {
  const a = Math.atan2(pos.x, pos.z);
  return ((a * 180) / Math.PI + 360) % 360;
}
