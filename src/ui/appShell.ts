import { h, clear } from './dom';
import { ROUTES, currentRoute, navigate, onRouteChange, type RouteId } from './router';
import { store } from '../core/store';
import { TreesPage } from './pages/treesPage';
import { SkeletonPage } from './pages/skeletonPage';
import { WiringPage } from './pages/wiringPage';
import { BendPage } from './pages/bendPage';
import { PreviewPage } from './pages/previewPage';
import { CarePage } from './pages/carePage';
import { ComparePage } from './pages/comparePage';
import { SettingsPage } from './pages/settingsPage';

export class AppShell {
  private main = h('main', {});
  private pages: { dispose?: () => void }[] = [];

  mount(root: HTMLElement): void {
    const tabs = h(
      'nav',
      { class: 'tabs' },
      ...ROUTES.map((r) =>
        h(
          'a',
          {
            href: `#/${r.id}`,
            'data-route': r.id,
          },
          `${r.icon} ${r.label}`,
        ),
      ),
    );
    const topbar = h('header', { class: 'topbar' }, h('div', { class: 'brand' }, '盆景蟠扎造型推演'), tabs);
    root.append(topbar, this.main);
    document.documentElement.dataset.theme = store.settings.theme;

    onRouteChange((r) => this.render(r));
    store.subscribe(() => {
      document.documentElement.dataset.theme = store.settings.theme;
      this.render(currentRoute());
    });
    this.render(currentRoute());
  }

  private render(route: RouteId): void {
    for (const p of this.pages) p?.dispose?.();
    this.pages = [];
    clear(this.main);
    document.querySelectorAll('nav.tabs a').forEach((a) => {
      a.classList.toggle('active', (a as HTMLElement).dataset.route === route);
    });
    const wrap = h('div', { class: 'page' });
    this.main.append(wrap);
    switch (route) {
      case 'trees':
        this.pages.push(new TreesPage(wrap));
        break;
      case 'skeleton':
        this.pages.push(new SkeletonPage(wrap));
        break;
      case 'wiring':
        this.pages.push(new WiringPage(wrap));
        break;
      case 'bend':
        this.pages.push(new BendPage(wrap));
        break;
      case 'preview':
        this.pages.push(new PreviewPage(wrap));
        break;
      case 'care':
        this.pages.push(new CarePage(wrap));
        break;
      case 'compare':
        this.pages.push(new ComparePage(wrap));
        break;
      case 'settings':
        this.pages.push(new SettingsPage(wrap));
        break;
      default:
        navigate('trees');
    }
  }
}
