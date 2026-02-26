import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    if (!email || !pass) {
      return null;
    }

    const user = await this.prisma.user.findFirst({
      where: { email: email.trim() },
      include: {
        tenant: { select: { name: true } },
        customer: { select: { name: true } },
      }
    });

    if (user && await bcrypt.compare(pass, user.passwordHash)) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    if (user.role === 'CUSTOMER' && !user.customerId) {
      throw new UnauthorizedException('Customer access denied: Invalid user entity binding.');
    }

    const payload = { sub: user.id, email: user.email, tenantId: user.tenantId, role: user.role, customerId: user.customerId };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = crypto.randomBytes(32).toString('hex');
    
    await this.storeRefreshToken(user.id, refreshToken);

    return {
      accessToken,
      refreshToken,
      user
    };
  }

  async refreshTokens(refreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    const tokenRecord = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!tokenRecord) throw new UnauthorizedException('Invalid refresh token');
    if (tokenRecord.revokedAt) {
      // Token reuse detection logic could go here (revoke all tokens for user)
      throw new UnauthorizedException('Token revoked');
    }
    if (new Date() > tokenRecord.expiresAt) {
      throw new UnauthorizedException('Token expired');
    }

    // Rotate token
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    
    // Revoke old token
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { 
        revokedAt: new Date(),
        replacedByTokenId: 'NEXT_ID_PLACEHOLDER' // Ideally we create first then update, but simplifying for T0.3
      }
    });

    // Create new token
    await this.storeRefreshToken(tokenRecord.userId, newRefreshToken);
    
    if (tokenRecord.user.role === 'CUSTOMER' && !tokenRecord.user.customerId) {
      throw new UnauthorizedException('Customer access denied: Invalid user entity binding.');
    }

    // Issue new access token
    const payload = { 
      sub: tokenRecord.user.id, 
      email: tokenRecord.user.email, 
      tenantId: tokenRecord.user.tenantId, 
      role: tokenRecord.user.role,
      customerId: tokenRecord.user.customerId
    };
    
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const tokenRecord = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });
    
    if (tokenRecord) {
      await this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  async changePassword(userId: string, currentPass: string, newPass: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!(await bcrypt.compare(currentPass, user.passwordHash))) {
      throw new BadRequestException('Incorrect current password');
    }

    const newHash = await this.hashPassword(newPass);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        customerId: true,
        mustChangePassword: true,
        tenant: { select: { name: true } },
        customer: { select: { name: true } },
      }
    });

    // Revoke all existing refresh tokens for this user
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (updatedUser.role === 'CUSTOMER' && !updatedUser.customerId) {
      throw new UnauthorizedException('Customer access denied: Invalid user entity binding.');
    }

    // Issue new tokens transparently
    const payload = { 
      sub: updatedUser.id, 
      email: updatedUser.email, 
      tenantId: updatedUser.tenantId, 
      role: updatedUser.role,
      customerId: updatedUser.customerId
    };
    
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = crypto.randomBytes(32).toString('hex');
    await this.storeRefreshToken(updatedUser.id, refreshToken);

    return {
      accessToken,
      refreshToken,
      user: updatedUser
    };
  }

  private async storeRefreshToken(userId: string, token: string) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const ttlDays = parseInt(this.configService.get('REFRESH_TOKEN_TTL_DAYS') || '7', 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hash,
        expiresAt,
      },
    });
  }

  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt();
    return bcrypt.hash(password, salt);
  }
}
