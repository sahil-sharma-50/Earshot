export function navigate(path: string): void {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}
