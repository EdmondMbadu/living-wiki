import { PRIMARY_OUTLET, Router } from '@angular/router';

export function safeGuestReturnTo(value: string | null, router: Router): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')
    || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  const tree = router.parseUrl(value);
  const path = tree.root.children[PRIMARY_OUTLET]?.segments.map(segment => segment.path).join('/') ?? '';
  return path === 'guest-terms' ? '/' : router.serializeUrl(tree);
}

