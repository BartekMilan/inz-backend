import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterDto, LoginDto, ResetPasswordDto, UpdatePasswordDto } from './dto';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class AuthService {
  constructor(
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.auth.signUp({
      email: registerDto.email,
      password: registerDto.password,
      options: {
        data: {
          first_name: registerDto.firstName,
          last_name: registerDto.lastName,
          role: Role.REGISTRAR, // Default role for new users
        },
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      message: 'Rejestracja pomyślna. Sprawdź email, aby potwierdzić konto.',
      user: data.user,
    };
  }

  async login(loginDto: LoginDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginDto.email,
      password: loginDto.password,
    });

    if (error) {
      throw new UnauthorizedException('Nieprawidłowy email lub hasło');
    }

    return {
      message: 'Logowanie pomyślne',
      user: data.user,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    };
  }

  async logout(accessToken: string) {
    const supabase = this.supabaseService.getClientWithAuth(accessToken);

    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { message: 'Wylogowano pomyślnie' };
  }

  async getProfile(accessToken: string) {
    const supabase = this.supabaseService.getClientWithAuth(accessToken);

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw new UnauthorizedException('Nieprawidłowy token');
    }

    const userRole = this.validateRole(data.user.user_metadata?.role);

    return {
      id: data.user.id,
      email: data.user.email,
      firstName: data.user.user_metadata?.first_name,
      lastName: data.user.user_metadata?.last_name,
      role: userRole,
      createdAt: data.user.created_at,
    };
  }

  private validateRole(role: string | undefined): Role {
    if (role && Object.values(Role).includes(role as Role)) {
      return role as Role;
    }
    return Role.REGISTRAR; // Default role
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const supabase = this.supabaseService.getClient();

    const { error } = await supabase.auth.resetPasswordForEmail(
      resetPasswordDto.email,
      {
        redirectTo: `${process.env.FRONTEND_URL}/password-reset/confirm`,
      },
    );

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      message: 'Link do resetowania hasła został wysłany na podany email',
    };
  }

  async updatePassword(accessToken: string, updatePasswordDto: UpdatePasswordDto) {
    const supabase = this.supabaseService.getClientWithAuth(accessToken);

    const { error } = await supabase.auth.updateUser({
      password: updatePasswordDto.password,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { message: 'Hasło zostało zmienione pomyślnie' };
  }

  async refreshToken(refreshToken: string) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('Nie można odświeżyć sesji');
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    };
  }

  // Google OAuth - get redirect URL
  async getGoogleOAuthUrl() {
    const supabase = this.supabaseService.getClient();
    const frontendUrl = this.configService.get('FRONTEND_URL');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${frontendUrl}/auth/callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { url: data.url };
  }

  // Exchange code for session (after OAuth callback)
  async exchangeCodeForSession(code: string) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      user: data.user,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    };
  }

  // Validate token and return user data (used by AuthGuard)
  async validateToken(accessToken: string) {
    const supabase = this.supabaseService.getClientWithAuth(accessToken);

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    return data.user;
  }
}
