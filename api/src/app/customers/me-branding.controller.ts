import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { CustomerBrandingService } from './customer-branding.service';

/**
 * The signed-in customer's own branding. Always scoped to `req.user.customerId` — no
 * `:id` parameter, so a customer can never read another customer's logo or colour.
 */
@UseGuards(RolesGuard)
@Roles(UserRole.CUSTOMER)
@Controller('me/branding')
export class MeBrandingController {
  constructor(private readonly branding: CustomerBrandingService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  getBranding(@Req() req: AuthenticatedRequest) {
    return this.branding.getBranding(req.user.tenantId, this.customerId(req));
  }

  @Get('logo')
  async getLogo(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, mimeType } = await this.branding.getLogo(
      req.user.tenantId,
      this.customerId(req),
    );
    res.set({
      'Content-Type': mimeType,
      'Cache-Control': 'private, max-age=86400',
    });
    return new StreamableFile(buffer);
  }

  private customerId(req: AuthenticatedRequest): string {
    if (!req.user.customerId) {
      throw new ForbiddenException('No customer is bound to this account.');
    }
    return req.user.customerId;
  }
}
