import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { TemplateValidationService } from './template-validation.service';
import { TemplateFileStoreService } from './template-file-store.service';
import { TemplateTokensService } from './template-tokens.service';
import { XlsNormalizerService } from './xls-normalizer.service';
import { TokenExtractorService } from './token-extractor.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [TemplateController],
  providers: [
    TemplateService,
    TemplateValidationService,
    TemplateFileStoreService,
    TemplateTokensService,
    XlsNormalizerService,
    TokenExtractorService,
    PrismaService,
  ],
})
export class TemplateModule {}
