import { h, button, panel, field, select, toast } from '../dom';
import { store } from '../../core/store';
import { mountScene } from '../sceneMount';
import { addNode, computeRest } from '../../core/skeleton';
import { SPECIES } from '../../core/species';
import * as THREE from 'three';
import type { NodeType } from '../../core/types';

const NODE_TYPES: [NodeType, string][] = [
  ['trunk', '主干'],
  ['branch', '枝条'],
  ['twig', '小枝'],
  ['root', '露根'],
  ['buttress', '板根'],
  ['dead', '枯梢'],
];

export class SkeletonPage {
  private handle: ReturnType<typeof mountScene> | null = null;
  private selected = -1;
  private marker: THREE.Mesh | null = null;

  constructor(private root: HTMLElement) {
    if (!store.currentTree) {
      this.root.append(h('div', { class: 'hud' }, '请先在「桩材档案」选择或创建桩材'));
      return;
    }
    if (!store.currentPlan) store.createPlan(store.currentTree.id);
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

    side.append(
      panel(
        '当前桩材',
        h('p', { class: 'muted' }, `${tree.name} · ${SPECIES[tree.species].name}`),
        h('p', { class: 'muted' }, `节点 ${tree.skeleton.nodes.length} 个 · 方案「${plan.name}」 · 第 ${plan.year} 年`),
      ),
    );

    // 节点编辑面板（占位，选中后填充）
    const editor = panel('节点编辑', h('div', { class: 'muted', id: 'node-editor' }, '在 3D 视图中点选节点'));
    side.append(editor);

    side.append(
      panel(
        '骨架操作',
        button('在选中节点上添加子枝', () => this.addChild(), 'primary'),
        button('删除选中节点子树', () => this.deleteSelected(), 'danger'),
        button('重置观察视角', () => {
          this.handle?.scene.controls.reset();
          this.handle?.scene.camera.position.set(28, 22, 34);
        }),
      ),
      panel(
        '统计',
        h(
          'div',
          { class: 'status-line mono', id: 'sk-stats' },
          (() => {
            const rest = computeRest(tree.skeleton);
            const byType = new Map<string, number>();
            for (const n of tree.skeleton.nodes) byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
            return [`根序长度 ${rest.order.length}`, ...[...byType].map(([k, v]) => `${k}: ${v}`)].join('\n');
          })(),
        ),
      ),
    );

    // 拾取
    const canvas = view.querySelector('canvas')!;
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      const id = this.handle!.scene.pickNode(ndc);
      if (id >= 0) this.select(id, editor);
    });
  }

  private select(id: number, host: HTMLElement): void {
    this.selected = id;
    const tree = store.currentTree!;
    const node = tree.skeleton.nodes[id];
    if (this.marker) this.handle!.scene.scene.remove(this.marker);
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(node.radius * 1.25 + 0.3, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0x6cb2e8, wireframe: true }),
    );
    this.handle!.scene.scene.add(this.marker);
    this.handle!.scene.onFrame = () => {
      if (this.marker && this.selected >= 0) {
        this.marker.position.copy(this.handle!.scene.pose.worldPos[this.selected]);
      }
    };

    host.innerHTML = '';
    const posInputs = node.pos.map((c, i) => {
      const inp = h('input', { type: 'number', step: '0.2', value: String(c) });
      inp.addEventListener('change', () => {
        node.pos[i] = Number(inp.value);
        void this.rebuild();
      });
      return inp;
    });
    const rInput = h('input', { type: 'number', step: '0.1', min: '0.05', value: String(node.radius) });
    rInput.addEventListener('change', () => {
      node.radius = Math.max(0.05, Number(rInput.value));
      void this.rebuild();
    });
    const typeSel = select(
      NODE_TYPES.map(([v, t]) => [v, t]),
      node.type,
      (v) => {
        node.type = v as NodeType;
        void this.rebuild();
      },
    );
    host.append(
      h('div', { class: 'status-line' }, `节点 #${id} · 父 #${node.parent} · 子节点 ${node.children.length} 个`),
      field('局部位置 X / Y / Z（cm）', h('div', { class: 'row' }, ...posInputs)),
      field('粗度半径（cm）', rInput),
      field('节点类型', typeSel),
      button('添加子枝后自动选中新节点', () => this.addChild(), 'small primary'),
    );
  }

  private addChild(): void {
    if (this.selected < 0) return toast('请先点选一个节点');
    const tree = store.currentTree!;
    const parent = tree.skeleton.nodes[this.selected];
    const id = addNode(
      tree.skeleton,
      this.selected,
      [(Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2],
      Math.max(0.1, parent.radius * 0.65),
      parent.type === 'trunk' ? 'trunk' : 'twig',
    );
    void store.saveTrees().then(() => this.rebuild(id));
  }

  private deleteSelected(): void {
    if (this.selected <= 0) return toast('根节点不可删除');
    const tree = store.currentTree!;
    const ids: number[] = [];
    const stack = [this.selected];
    while (stack.length) {
      const x = stack.pop()!;
      ids.push(x);
      stack.push(...tree.skeleton.nodes[x].children);
    }
    if (!confirm(`删除节点 #${this.selected} 及其子树共 ${ids.length} 个节点？`)) return;
    const node = tree.skeleton.nodes[this.selected];
    const parent = tree.skeleton.nodes[node.parent];
    parent.children = parent.children.filter((c) => c !== this.selected);
    tree.skeleton.nodes = tree.skeleton.nodes.filter((n) => !ids.includes(n.id));
    this.selected = -1;
    void store.saveTrees().then(() => this.rebuild());
  }

  private rebuild(selectId?: number): void {
    const stats = this.handle!.scene.rebuild();
    if (selectId !== undefined) this.select(selectId, document.getElementById('node-editor')!.parentElement!);
    const el = document.getElementById('sk-stats');
    if (el) {
      const rest = computeRest(store.currentTree!.skeleton);
      el.textContent = [`根序长度 ${rest.order.length}`, `重建 ${stats.ms.toFixed(1)}ms`, `三角面 ${stats.triangles}`].join('\n');
    }
  }

  dispose(): void {
    this.handle?.dispose();
  }
}
