import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ReasonDto } from './reason.dto';
import { DeleteReportDto } from '../../inspection-reports/dto/delete-report.dto';
import { CreateSerialNumbersDto } from '../../serial-numbers/dto/create-serial-numbers.dto';
import { UpdateSerialNumberDto } from '../../serial-numbers/dto/update-serial-number.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const body = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

describe('request-body DTOs (through the app ValidationPipe settings)', () => {
  it('accepts a missing body where the reason is optional (DELETE without a body)', async () => {
    await expect(
      pipe.transform(undefined, body(ReasonDto)),
    ).resolves.toBeDefined();
    await expect(
      pipe.transform({}, body(DeleteReportDto)),
    ).resolves.toBeDefined();
  });

  it('rejects a non-string reason', async () => {
    await expect(
      pipe.transform({ reason: 5 }, body(ReasonDto)),
    ).rejects.toThrow();
  });

  it('validates serial-number items, including nested ones', async () => {
    const ok = await pipe.transform(
      { items: [{ clientRef: 'c1', serialNumber: 'SN-1' }] },
      body(CreateSerialNumbersDto),
    );
    expect(ok.items[0].serialNumber).toBe('SN-1');
    await expect(
      pipe.transform(
        { items: [{ clientRef: 'c1', serialNumber: 7 }] },
        body(CreateSerialNumbersDto),
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ items: 'x' }, body(CreateSerialNumbersDto)),
    ).rejects.toThrow();
  });

  it('keeps the serial update payload shape (version, serialNumber, inspectionData)', async () => {
    const out = await pipe.transform(
      { version: 3, inspectionData: { body: { emiResult: 'PASS' } }, extra: 1 },
      body(UpdateSerialNumberDto),
    );
    expect(out).toEqual({
      version: 3,
      inspectionData: { body: { emiResult: 'PASS' } },
    });
    await expect(
      pipe.transform({ version: 'x' }, body(UpdateSerialNumberDto)),
    ).rejects.toThrow();
  });
});
