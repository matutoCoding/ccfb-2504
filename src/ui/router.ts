export type RouteId =
  | 'trees'
  | 'skeleton'
  | 'wiring'
  | 'bend'
  | 'preview'
  | 'care'
  | 'settings'
  | 'compare';

export interface Route {
  id: RouteId;
  label: string;
  icon: string;
}

export const ROUTES: Route[] = [
  { id: 'trees', label: '桩材档案', icon: '🌳' },
  { id: 'skeleton', label: '骨架编辑', icon: '🦴' },
  { id: 'wiring', label: '蟠扎造型', icon: '🌀' },
  { id: 'bend', label: '弯枝修剪', icon: '✂️' },
  { id: 'preview', label: '观赏面预览', icon: '👁' },
  { id: 'care', label: '养护计划', icon: '📅' },
  { id: 'compare', label: '方案对比', icon: '⚖️' },
  { id: 'settings', label: '设置', icon: '⚙️' },
];

const LISTENER = 'bonsai-route';

export function currentRoute(): RouteId {
  const h = location.hash.replace('#/', '') as RouteId;
  return (ROUTES.some((r) => r.id === h) ? h : 'trees') as RouteId;
}

export function navigate(id: RouteId): void {
  location.hash = `#/${id}`;
}

export function onRouteChange(fn: (r: RouteId) => void): () => void {
  const handler = () => fn(currentRoute());
  window.addEventListener('hashchange', handler);
  void LISTENER;
  return () => window.removeEventListener('hashchange', handler);
}
