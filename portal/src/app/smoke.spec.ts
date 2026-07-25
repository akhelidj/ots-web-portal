// Foundation smoke test — proves the Jest runner (jest-preset-angular, zoneless)
// executes for the portal project. Replace/expand with real tests; this only
// verifies the harness is wired up.
describe('portal test harness', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
