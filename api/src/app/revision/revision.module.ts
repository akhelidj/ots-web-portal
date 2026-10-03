import { Module } from '@nestjs/common';
import { RevisionService } from './revision.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [RevisionService],
  exports: [RevisionService],
})
export class RevisionModule {}
