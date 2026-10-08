import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { PdfConverterService } from './pdf-converter.service';
import { RevisionModule } from '../revision/revision.module';

@Module({
  imports: [RevisionModule],
  controllers: [ExportController],
  providers: [ExportService, PdfConverterService],
})
export class ExportModule {}
