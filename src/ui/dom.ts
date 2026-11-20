/** 极简 DOM 构建工具 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

export function panel(title: string, ...children: Node[]): HTMLElement {
  return h('section', { class: 'panel' }, h('h3', {}, title), ...children);
}

export function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

export function select(options: [string, string][], value: string, on: (v: string) => void): HTMLSelectElement {
  const s = h('select', {
    onchange: (e) => on((e.target as HTMLSelectElement).value),
  });
  for (const [v, t] of options) {
    const o = h('option', { value: v }, t);
    if (v === value) o.selected = true;
    s.append(o);
  }
  return s;
}

export function button(label: string, on: () => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `btn ${cls}`, onclick: on }, label);
}

export function toast(msg: string, ms = 2600): void {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}
