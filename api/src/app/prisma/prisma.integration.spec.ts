/**
 * Integration smoke test — proves the PrismaService <-> test DB wiring end to end.
 * NOT a characterization test; it just confirms the harness connects, round-trips a
 * row, and tears down. Runs under the `test-integration` target against the
 * dedicated test Postgres (docker-compose.test.yml). The DB safety guard in
 * api/test/integration-env.ts has already validated DATABASE_URL before this runs.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService integration (dedicated test DB)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit(); // $connect
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy(); // $disconnect
    await moduleRef?.close();
  });

  it('is connected to a *_test database (never dev/prod)', async () => {
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    // Belt-and-suspenders at runtime: the live connection is on a _test DB.
    expect(rows[0].current_database).toMatch(/_test$/);
  });

  it('round-trips a Tenant row: create -> read -> delete', async () => {
    const created = await prisma.tenant.create({
      data: { name: 'integration-smoke' },
    });
    expect(created.id).toBeTruthy();

    const read = await prisma.tenant.findUnique({ where: { id: created.id } });
    expect(read?.name).toBe('integration-smoke');

    // Tear down the row we created.
    await prisma.tenant.delete({ where: { id: created.id } });
    const afterDelete = await prisma.tenant.findUnique({
      where: { id: created.id },
    });
    expect(afterDelete).toBeNull();
  });
});
