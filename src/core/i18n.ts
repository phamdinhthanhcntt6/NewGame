import vi from '../data/locales/vi.json';

type Dict = Record<string, string>;

const locales: Record<string, Dict> = { vi };
let active: Dict = vi;

export function setLocale(code: string): void {
  active = locales[code] ?? vi;
}

/** Look up a UI string; `{name}` placeholders are filled from params. Missing keys return the key. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const raw = active[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}
