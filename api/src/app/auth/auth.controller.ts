import { Controller, Post, Body, Req, UnauthorizedException, Get, UseGuards } from '@nestjs/common';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: any) {
    const user = await this.authService.validateUser(body.tenantName, body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshTokens(body.refreshToken);
  }

  @Public() // Logout can be public if we just revoke the token passed in body
  @Post('logout')
  async logout(@Body() body: { refreshToken: string }) {
    return this.authService.logout(body.refreshToken);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('change-password')
  async changePassword(@Req() req, @Body() body: ChangePasswordDto) {
    const userId = req.user.sub || req.user.id;
    return this.authService.changePassword(userId, body.currentPassword, body.newPassword);
  }

  @Get('me')
  getProfile(@Req() req) {
    return req.user;
  }
}
