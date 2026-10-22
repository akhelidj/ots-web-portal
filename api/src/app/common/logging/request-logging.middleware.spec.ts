import { EventEmitter } from 'events';
import { LoggedRequest, requestLogger } from './request-logging.middleware';

function run(req: Partial<LoggedRequest>, statusCode = 200) {
  const res = Object.assign(new EventEmitter(), {
    statusCode,
    setHeader: jest.fn(),
  });
  const next = jest.fn();
  const full = { headers: {}, method: 'GET', originalUrl: '/x', ...req } as LoggedRequest;
  requestLogger(full, res as never, next);
  return { res, next, req: full };
}

describe('requestLogger', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs one JSON line on finish with the id, status, user — and no query string', () => {
    const req: Partial<LoggedRequest> = {
      originalUrl: '/inspection-reports/1/export?token=secret&format=pdf',
      user: { userId: 'u1', role: 'CUSTOMER', tenantId: 't1' },
    };
    const { res, next, req: seen } = run(req, 200);
    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    res.emit('finish');
    const line = JSON.parse(log.mock.calls[0][0]);
    expect(line).toMatchObject({
      level: 'info',
      method: 'GET',
      path: '/inspection-reports/1/export',
      status: 200,
      userId: 'u1',
      role: 'CUSTOMER',
      tenantId: 't1',
    });
    expect(line.reqId).toBe(seen.id);
    expect(JSON.stringify(line)).not.toContain('secret');
  });

  it('reuses a sane incoming X-Request-Id and rejects a junk one', () => {
    const ok = run({ headers: { 'x-request-id': 'abc12345-def' } }).req;
    expect(ok.id).toBe('abc12345-def');
    const bad = run({ headers: { 'x-request-id': 'x y\n!' } }).req;
    expect(bad.id).not.toBe('x y\n!');
    expect(bad.id).toMatch(/^[\w-]{8,64}$/);
  });

  it('routes 4xx to warn and 5xx to error', () => {
    run({}, 400).res.emit('finish');
    expect(JSON.parse(warn.mock.calls[0][0]).level).toBe('warn');
    run({}, 500).res.emit('finish');
    expect(JSON.parse(error.mock.calls[0][0]).level).toBe('error');
  });

  it('skips /health', () => {
    const { res } = run({ originalUrl: '/health' });
    res.emit('finish');
    expect(log).not.toHaveBeenCalled();
  });
});
