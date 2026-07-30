/**
 * Characterization [unit] — AllExceptionsFilter (the global exception filter in
 * main.ts). Pins the CURRENT flatten behavior of the `catch (exception: any)`
 * site ahead of the 3h-ii `any -> unknown` typing rewrite. These are a documented
 * BASELINE the rewrite must hold — NOT flip tags.
 *
 * NestFactory is mocked so importing main.ts (which calls bootstrap() at module
 * load) does not spin up a real HTTP server / bind a port; only NestFactory.create
 * is stubbed, the rest of '@nestjs/core' is the real module so AppModule still
 * loads. The filter is then exercised directly with a mock ArgumentsHost.
 *
 * NOTE on case (b2): the filter reads `.message` (not `.getResponse()`), so a
 * structured HttpException body (code / missingDispositionSerials /
 * missingRequiredFields) is flattened away over the wire in production. That is a
 * KNOWN latent gap logged in docs/internal/sync-risks.md ("Block 3h — global-filter
 * flattening"); it is pinned here as current fact and is deliberately NOT fixed or
 * flipped in this block — a separate sanctioned block owns that change.
 */
jest.mock('@nestjs/core', () => ({
  ...jest.requireActual('@nestjs/core'),
  NestFactory: {
    create: jest.fn().mockResolvedValue({
      useGlobalFilters: jest.fn(),
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

import {
  ArgumentsHost,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './main';

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

  it('(b2) BadRequestException(structured) → FLATTENED to the message string; code/missing* are DROPPED (KNOWN latent gap, sync-risks.md — pinned, not fixed here)', () => {
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
    // CHARACTERIZATION of the current flattening: structured fields do not survive.
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
