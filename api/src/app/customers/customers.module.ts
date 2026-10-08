import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerBrandingService } from './customer-branding.service';
import { MeBrandingController } from './me-branding.controller';

@Module({
  controllers: [CustomersController, MeBrandingController],
  providers: [CustomersService, CustomerBrandingService],
})
export class CustomersModule {}
