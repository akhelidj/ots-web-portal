/**
 * Unit test — AllExceptionsFilter (the global exception filter). Pins
 * the current flatten behavior of the exception-handling site. These assertions are
 * a documented baseline the filter must hold.
 *
 * NestFactory is mocked so importing main.ts (which calls bootstrap() at module
 * load) does not spin up a real HTTP server / bind a port; only NestFactory.create
 * is stubbed, the rest of '@nestjs/core' is the real module so AppModule still
 * loads. The filter is then exercised directly with a mock ArgumentsHost.
 *
 * NOTE on case (b2): the filter reads `.message` (not `.getResponse()`), so a
 * structured HttpException body (code / missingDispositionSerials /
 * missingRequiredFields) is flattened away over the wire in production. That is a
 * known gap documented in docs/KNOWN-ISSUES.md (#5, global-filter flattening); it is
 * pinned here as current fact and is deliberately not fixed here — a separate change
 * owns that fix.
 */
import {
  ArgumentsHost,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Build a mock ArgumentsHost whose HTTP response exposes chainable status/json spies. */
function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis(); // .status(x) returns `this` so .json() chains
  const response = { status, json };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter (global exception filter) [unit]', () => {
  const filter = new AllExceptionsFilter();
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    // The filter logs the exception via console.error; keep test output clean.
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errSpy.mockRestore());

  it('(a) HttpException → its own status + flat {statusCode, message, stack}', () => {
    const { host, status, json } = makeHost();

    filter.catch(new HttpException('msg', 418), host);

    expect(status).toHaveBeenCalledWith(418);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(418);
    expect(body.message).toBe('msg');
    expect(typeof body.stack).toBe('string');
  });

  it('(b2) BadRequestException(structured) → FLATTENED to the message string; code/missing* are DROPPED (KNOWN latent gap, KNOWN-ISSUES.md #5 — pinned, not fixed here)', () => {
    const { host, status, json } = makeHost();

    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Cannot request approval: missing disposition',
        missingDispositionSerials: ['SN-1'],
        missingRequiredFields: { 'SN-1': ['body.emiResult'] },
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(400);
    // Only the string message survives — the filter never reads .getResponse().
    expect(body.message).toBe('Cannot request approval: missing disposition');
    // Pins the current flattening: structured fields do not survive.
    expect(body.code).toBeUndefined();
    expect(body.missingDispositionSerials).toBeUndefined();
    expect(body.missingRequiredFields).toBeUndefined();
  });

  it('(c) plain Error → status 500 + {500, message, stack}', () => {
    const { host, status, json } = makeHost();

    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('boom');
    expect(typeof body.stack).toBe('string');
  });

  it("(d) non-Error throw (string) → status 500, 'Internal server error', stack key absent over the wire", () => {
    const { host, status, json } = makeHost();

    filter.catch('boom', host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
    // `stack: exception.stack` is undefined for a string throw; JSON serialization
    // omits the key, so the wire body is exactly {statusCode, message}.
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});

// ---- Production hardening: no internals leak to clients ----
function runIn(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'GET', url: '/x' }),
    }),
  };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  new AllExceptionsFilter().catch(exception, host as never);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter — production hardening', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
    jest.restoreAllMocks();
  });

  it('keeps HTTP exception messages in production, without a stack', () => {
    process.env.NODE_ENV = 'production';
    const { status, body } = runIn(new BadRequestException('bad input'));
    expect(status).toBe(400);
    expect(body.message).toBe('bad input');
    expect(body.stack).toBeUndefined();
  });

  it('hides the message and stack of an unexpected fault in production', () => {
    process.env.NODE_ENV = 'production';
    const { status, body } = runIn(new Error('connect ECONNREFUSED db:5432'));
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(body.stack).toBeUndefined();
  });

  it('keeps full detail outside production', () => {
    process.env.NODE_ENV = 'development';
    const { body } = runIn(new Error('boom'));
    expect(body.message).toBe('boom');
    expect(body.stack).toContain('boom');
  });

  it('is an HttpException-aware filter', () => {
    expect(runIn(new HttpException('x', 418)).status).toBe(418);
  });
});
