import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Put,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { AllowWithoutSignature } from '../common/decorators/allow-without-signature.decorator';
import { MAX_SIGNATURE_BYTES, SignaturesService } from './signatures.service';

/**
 * The caller's own account signature. Always scoped to `req.user` — there is no
 * `:id` parameter, so one user can never read or replace another's signature.
 *
 * `@AllowWithoutSignature` on the whole controller: these are exactly the calls an
 * inspector without a signature must be able to make to get out of the gate.
 */
@AllowWithoutSignature()
@UseGuards(RolesGuard)
@Roles(UserRole.INSPECTOR, UserRole.SUPERVISOR, UserRole.ADMIN)
@Controller('me/signature')
export class SignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get()
  getStatus(@Req() req: AuthenticatedRequest) {
    return this.signatures.getStatus(req.user.id);
  }

  @Get('image')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'private, no-store')
  async getImage(@Req() req: AuthenticatedRequest) {
    return new StreamableFile(
      await this.signatures.getImageForUser(req.user.id),
    );
  }

  @Put()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SIGNATURE_BYTES } }),
  )
  async save(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Signature file is required.');
    }
    return this.signatures.saveForUser(
      { id: req.user.id, tenantId: req.user.tenantId },
      file.buffer,
    );
  }
}
