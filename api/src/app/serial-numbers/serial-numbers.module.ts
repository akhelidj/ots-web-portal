import { Module } from '@nestjs/common';
import { SerialNumbersController } from './serial-numbers.controller';
import { SerialNumbersService } from './serial-numbers.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SerialNumbersController],
  providers: [SerialNumbersService],
  exports: [SerialNumbersService],
})
export class SerialNumbersModule {}
