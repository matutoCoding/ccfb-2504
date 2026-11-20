import './ui/styles.css';
import { AppShell } from './ui/appShell';
import { store } from './core/store';

async function bootstrap(): Promise<void> {
  await store.init();
  const app = document.getElementById('app')!;
  new AppShell().mount(app);
}

void bootstrap();
