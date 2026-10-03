import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Put,
  Req,
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
import { MAX_SIGNATURE_BYTES, SignaturesService } from './signatures.service';

/**
 * Per-report signature fields (a template's `signature` fields).
 *
 * Reading the state is open to every role that can see the report; PROVIDING a signature
 * is customer-only — a supervisor's signature is applied automatically at approval from
 * their account signature and is never drawn per report.
 */
@UseGuards(RolesGuard)
@Controller()
export class ReportSignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  /** Reports of the caller's customer still waiting on a customer signature. */
  @Roles(UserRole.CUSTOMER)
  @Get('customer-signatures/pending')
  listPending(@Req() req: AuthenticatedRequest) {
    return this.signatures.listPendingForCustomer(req.user);
  }

  @Roles(
    UserRole.ADMIN,
    UserRole.RECEIVER,
    UserRole.SUPERVISOR,
    UserRole.INSPECTOR,
    UserRole.CUSTOMER,
  )
  @Get('inspection-reports/:id/signatures')
  getStates(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.signatures.getFieldStates(req.user, id);
  }

  @Roles(UserRole.CUSTOMER)
  @Put('inspection-reports/:id/signatures/:fieldKey')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SIGNATURE_BYTES } }),
  )
  async sign(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('fieldKey') fieldKey: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Signature file is required.');
    }
    return this.signatures.signCustomerField(req.user, id, fieldKey, file.buffer);
  }
}
