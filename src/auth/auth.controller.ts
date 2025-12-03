import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, ResetPasswordDto, UpdatePasswordDto } from './dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Headers('authorization') authHeader: string) {
    const token = this.extractToken(authHeader);
    return this.authService.logout(token);
  }

  @Get('profile')
  async getProfile(@Headers('authorization') authHeader: string) {
    const token = this.extractToken(authHeader);
    return this.authService.getProfile(token);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('update-password')
  @HttpCode(HttpStatus.OK)
  async updatePassword(
    @Headers('authorization') authHeader: string,
    @Body() updatePasswordDto: UpdatePasswordDto,
  ) {
    const token = this.extractToken(authHeader);
    return this.authService.updatePassword(token, updatePasswordDto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  // Google OAuth endpoints
  @Public()
  @Get('google')
  async googleAuth() {
    return this.authService.getGoogleOAuthUrl();
  }

  @Public()
  @Get('callback')
  async authCallback(@Query('code') code: string) {
    return this.authService.exchangeCodeForSession(code);
  }

  private extractToken(authHeader: string): string {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Token nie został dostarczony');
    }
    return authHeader.substring(7);
  }
}
