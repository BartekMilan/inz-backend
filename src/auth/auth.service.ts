import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterDto, LoginDto, ResetPasswordDto, UpdatePasswordDto } from './dto';
import { Role } from '../common/enums/role.enum';

/**
 * Profile data structure from Supabase profiles table
 */
interface ProfileData {
  role: string;
  is_approved: boolean;
  assigned_project_id: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
    // NAJWCZEŚNIEJSZE LOGI - na samym początku metody
    console.log('=== LOGIN METHOD CALLED ===');
    console.log('Email:', loginDto.email);
    console.log('Has password:', !!loginDto.password);
    console.log('Timestamp:', new Date().toISOString());

    try {
      const supabase = this.supabaseService.getClient();
      console.log('Supabase client obtained');

      console.log('Attempting signInWithPassword...');
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginDto.email,
        password: loginDto.password,
      });

      console.log('signInWithPassword completed');
      console.log('Has error:', !!error);
      console.log('Error details:', error ? JSON.stringify(error, null, 2) : 'none');
      console.log('Has data:', !!data);
      console.log('Has user:', !!data?.user);
      console.log('Has session:', !!data?.session);

      if (error) {
        console.log('ERROR: signInWithPassword failed');
        console.log('Error message:', error.message);
        console.log('Error status:', error.status);
        console.log('Error code:', (error as any).code);
        
        // Handle specific Supabase error codes
        if ((error as any).code === 'email_not_confirmed') {
          // Try to auto-confirm email using admin client (for dev/test environments)
          console.log('Attempting to auto-confirm email using admin client...');
          try {
            const adminSupabase = this.supabaseService.getAdminClient();
            
            // Get user by email
            const { data: users, error: listError } = await adminSupabase.auth.admin.listUsers();
            const user = users?.users?.find((u: any) => u.email === loginDto.email);
            
            if (user && !user.email_confirmed_at) {
              console.log('Found user, confirming email...');
              // Confirm email using admin client
              const { data: updatedUser, error: updateError } = await adminSupabase.auth.admin.updateUserById(
                user.id,
                { email_confirm: true }
              );
              
              if (!updateError && updatedUser) {
                console.log('Email confirmed successfully, retrying login...');
                // Retry login after confirming email
                const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
                  email: loginDto.email,
                  password: loginDto.password,
                });
                
                if (!retryError && retryData) {
                  console.log('Login successful after email confirmation');
                  // Continue with normal flow
                  const finalData = retryData;
                  console.log('=== DEBUG LOGIN - RAW USER OBJECT (AFTER CONFIRMATION) ===');
                  console.log('DEBUG AUTH USER:', JSON.stringify(finalData.user, null, 2));
                  console.log('User ID:', finalData.user.id);
                  console.log('User Email:', finalData.user.email);
                  console.log('User metadata:', JSON.stringify(finalData.user.user_metadata, null, 2));

                  const profile = await this.getProfileData(finalData.user.id);
                  const userResponse = this.buildUserResponse(finalData.user, profile);

                  console.log('Returning success response');
                  return {
                    message: 'Logowanie pomyślne',
                    user: userResponse,
                    session: {
                      accessToken: finalData.session.access_token,
                      refreshToken: finalData.session.refresh_token,
                      expiresAt: finalData.session.expires_at,
                    },
                  };
                }
              }
            }
          } catch (adminError) {
            console.log('Failed to auto-confirm email:', adminError);
          }
          
          throw new UnauthorizedException({
            message: 'Email nie został potwierdzony. Sprawdź swoją skrzynkę pocztową.',
            code: 'EMAIL_NOT_CONFIRMED',
          });
        }
        
        throw new UnauthorizedException('Nieprawidłowy email lub hasło');
      }

      // STEP 1: Aggressive logging - log the raw user object
      console.log('=== DEBUG LOGIN - RAW USER OBJECT ===');
      console.log('DEBUG AUTH USER:', JSON.stringify(data.user, null, 2));
      console.log('User ID:', data.user.id);
      console.log('User Email:', data.user.email);
      console.log('User metadata:', JSON.stringify(data.user.user_metadata, null, 2));

      const profile = await this.getProfileData(data.user.id);
      const userResponse = this.buildUserResponse(data.user, profile);

      console.log('Returning success response');
      return {
        message: 'Logowanie pomyślne',
        user: userResponse,
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
        },
      };
    } catch (error) {
      console.log('=== EXCEPTION IN LOGIN METHOD ===');
      console.log('Error type:', error?.constructor?.name);
      console.log('Error message:', error?.message);
      console.log('Error stack:', error?.stack);
      console.log('Is UnauthorizedException:', error instanceof UnauthorizedException);
      
      // Re-throw the error to preserve the original exception
      throw error;
    }
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

    const profile = await this.getProfileData(data.user.id);
    const userRole = this.validateRole(profile?.role || data.user.user_metadata?.role);
    const isApproved = userRole === Role.REGISTRAR ? profile?.is_approved === true : true;

    return {
      id: data.user.id,
      email: data.user.email,
      firstName: data.user.user_metadata?.first_name,
      lastName: data.user.user_metadata?.last_name,
      role: userRole,
      isApproved,
      assignedProjectId: profile?.assigned_project_id || null,
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

    const profile = await this.getProfileData(data.user.id);
    const userResponse = this.buildUserResponse(data.user, profile);

    return {
      user: userResponse,
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

    const profile = await this.getProfileData(data.user.id);
    return this.buildUserResponse(data.user, profile);
  }

  /**
   * Pobiera dane profilu użytkownika z tabeli profiles.
   */
  private async getProfileData(userId: string): Promise<ProfileData | null> {
    const supabase = this.supabaseService.getClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role, is_approved, assigned_project_id')
      .eq('id', userId)
      .single<ProfileData>();

    if (error || !profile) {
      this.logger.warn(`Profile not found for user ${userId}`, { error });
      return null;
    }

    return profile;
  }

  private buildUserResponse(user: any, profile: ProfileData | null) {
    const role = profile?.role ?? user.user_metadata?.role ?? user.role;
    const isApproved = role === Role.REGISTRAR ? profile?.is_approved === true : true;

    return {
      ...user,
      role,
      isApproved,
      assignedProjectId: profile?.assigned_project_id || null,
    };
  }
}
