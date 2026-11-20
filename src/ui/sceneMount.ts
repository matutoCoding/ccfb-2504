import { BonsaiScene } from '../three/bonsaiScene';
import type { Plan, TreeRecord } from '../core/types';

export interface SceneHandle {
  scene: BonsaiScene;
  dispose: () => void;
}

/** 在容器里挂一个画布并构建 BonsaiScene（页面共用） */
export function mountScene(container: HTMLElement, tree: TreeRecord, plan: Plan): SceneHandle {
  const canvas = document.createElement('canvas');
  container.append(canvas);
  const scene = new BonsaiScene(canvas, tree, plan);
  const resize = () => {
    const r = container.getBoundingClientRect();
    scene.resize(Math.max(50, r.width), Math.max(50, r.height));
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const stats = scene.rebuild();
  scene.start();
  // 调试钩子（浏览器控制台）
  (window as unknown as { __bonsai?: unknown }).__bonsai = scene;
  return {
    scene,
    dispose: () => {
      ro.disconnect();
      scene.dispose();
      canvas.remove();
    },
  };
}

export { statsLabel } from './statsLabel';
