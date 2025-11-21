import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { Verify2FADto } from './dto/verify-2fa.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user || !(await bcrypt.compare(loginDto.password, user.password))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const token2FA = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.twoFactorToken.create({
      data: {
        token: token2FA,
        userId: user.id,
        expiresAt: expiresAt,
      },
    });

    console.log(` Token 2FA para ${user.email}: ${token2FA}`);

    return {
      message: 'Código 2FA enviado a tu email',
      expiresIn: '5 minutos',
    };
  }

  async verify2FA(verify2FADto: Verify2FADto) {
    const tokenRecord = await this.prisma.twoFactorToken.findFirst({
      where: {
        token: verify2FADto.token,
        used: false,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Token inválido o expirado');
    }

    await this.prisma.twoFactorToken.update({
      where: { id: tokenRecord.id },
      data: { used: true },
    });

    const payload = {
      sub: tokenRecord.user.id,
      email: tokenRecord.user.email,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: tokenRecord.user.id,
        email: tokenRecord.user.email,
      },
    };
  }

  async requestPasswordReset(passwordResetDto: PasswordResetRequestDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: passwordResetDto.email },
    });

    if (!user) {
      return {
        message: 'Si el email existe, recibirás un enlace de recuperación',
      };
    }

    const resetToken =
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000);

    await this.prisma.passwordRecoveryRequest.create({
      data: {
        token: resetToken,
        userId: user.id,
        expiresAt: expiresAt,
      },
    });

    console.log(
      ` Enlace recuperación 
      para ${user.email}: http://localhost:3000/reset-password?token=${resetToken}`,
    );

    return {
      message: 'Si el email existe, recibirás un enlace de recuperación',
    };
  }

  async confirmPasswordReset(confirmPasswordResetDto: ConfirmPasswordResetDto) {
    if (
      confirmPasswordResetDto.newPassword !==
      confirmPasswordResetDto.confirmPassword
    ) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    const resetRequest = await this.prisma.passwordRecoveryRequest.findFirst({
      where: {
        token: confirmPasswordResetDto.token,
        used: false,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!resetRequest) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const hashedPassword = await bcrypt.hash(
      confirmPasswordResetDto.newPassword,
      10,
    );

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRequest.user.id },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordRecoveryRequest.update({
        where: { id: resetRequest.id },
        data: { used: true },
      }),
    ]);

    return { message: 'Contraseña actualizada exitosamente' };
  }
}
