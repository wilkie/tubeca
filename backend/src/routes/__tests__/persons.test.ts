import personsRouter from '../persons';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function registeredPaths(method: string): string[] {
  return (personsRouter.stack as RouteLayer[])
    .filter((layer) => layer.route && layer.route.methods[method])
    .map((layer) => layer.route!.path);
}

describe('persons router', () => {
  it('registers GET /search before GET /:id so it is reachable', () => {
    const paths = registeredPaths('get');
    expect(paths).toContain('/search');
    expect(paths).toContain('/:id');
    expect(paths.indexOf('/search')).toBeLessThan(paths.indexOf('/:id'));
  });
});
