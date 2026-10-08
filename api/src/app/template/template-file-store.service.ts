import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TemplateFileStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores the file content.
   * Currently implementation leverages the DB 'fileBlob' field directly via the main TemplateService transaction.
   * This service is a placeholder for future S3 logic.
   *
   * For the current DB-based implementation, the file is passed to the create command in TemplateService.
   * If we were using S3, this method would upload and return a reference/URL.
   */
  async storeFile(buffer: Buffer): Promise<Buffer> {
    // In T0.5.1, we store directly in DB.
    // We return the buffer so it can be used in the Prisma create call.
    // In future S3 impl, this would return a string (key/url).
    return buffer;

    // Future S3 implementation:
    // const key = `templates/${uuid()}.xlsx`;
    // await s3.putObject({ Key: key, Body: buffer });
    // return key;
  }

  async getFile(templateId: string): Promise<Buffer> {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
      select: { fileBlob: true },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    return template.fileBlob;
  }
}
