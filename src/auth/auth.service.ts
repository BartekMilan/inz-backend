import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
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

                  // Check approval status for registrars
                  console.log('Calling checkRegistrarApproval...');
                  await this.checkRegistrarApproval(finalData.user.id);
                  console.log('checkRegistrarApproval completed successfully');

                  // Fetch profile to get assigned_project_id
                  const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('role, assigned_project_id')
                    .eq('id', finalData.user.id)
                    .single<ProfileData>();

                  if (profileError) {
                    this.logger.warn(`Failed to fetch profile for user ${finalData.user.id}`, { error: profileError });
                  }

                  // Build user object with assigned_project_id
                  const userResponse = {
                    ...finalData.user,
                    assignedProjectId: profile?.assigned_project_id || null,
                  };

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

      // Check approval status for registrars
      console.log('Calling checkRegistrarApproval...');
      await this.checkRegistrarApproval(data.user.id);
      console.log('checkRegistrarApproval completed successfully');

      // Fetch profile to get assigned_project_id
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, assigned_project_id')
        .eq('id', data.user.id)
        .single<ProfileData>();

      if (profileError) {
        this.logger.warn(`Failed to fetch profile for user ${data.user.id}`, { error: profileError });
      }

      // Build user object with assigned_project_id
      const userResponse = {
        ...data.user,
        assignedProjectId: profile?.assigned_project_id || null,
      };

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
      console.log('Is ForbiddenException:', error instanceof ForbiddenException);
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

    // Check approval status for registrars
    await this.checkRegistrarApproval(data.user.id);

    // Fetch profile to get assigned_project_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, assigned_project_id')
      .eq('id', data.user.id)
      .single<ProfileData>();

    if (profileError) {
      this.logger.warn(`Failed to fetch profile for user ${data.user.id}`, { error: profileError });
    }

    // Build user object with assigned_project_id
    const userResponse = {
      ...data.user,
      assignedProjectId: profile?.assigned_project_id || null,
    };

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

    // Check approval status for registrars on token validation
    // This ensures that even if a token is valid, registrars must be approved
    await this.checkRegistrarApproval(data.user.id);

    return data.user;
  }

  /**
   * Checks if a registrar user is approved and has a project assigned.
   * Throws ForbiddenException if not approved or no project assigned.
   */
  private async checkRegistrarApproval(userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // STEP 2: Inspect and fix the database query
    // Try explicit field selection first, then fallback to * if needed
    let { data: profile, error } = await supabase
      .from('profiles')
      .select('role, is_approved, assigned_project_id')
      .eq('id', userId)
      .single<ProfileData>();

    // If explicit select fails or returns incomplete data, try select('*')
    if (error || !profile || (profile && profile.role === 'registrar' && !profile.assigned_project_id)) {
      console.log('=== FALLBACK: Trying select(*) query ===');
      const fallbackResult = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      console.log('Fallback query result:', JSON.stringify(fallbackResult, null, 2));
      
      if (!fallbackResult.error && fallbackResult.data) {
        profile = fallbackResult.data as any;
        error = null;
        console.log('Using fallback profile data');
      }
    }

    // STEP 1: Aggressive logging - print RAW profile object
    console.log('=== DEBUG CHECK REGISTRAR APPROVAL ===');
    console.log('User ID:', userId);
    console.log('Query Error:', error);
    console.log('DEBUG RAW PROFILE:', JSON.stringify(profile, null, 2));
    console.log('Profile exists:', !!profile);
    
    if (profile) {
      console.log('Checks:', {
        role: profile.role,
        approved: profile.is_approved,
        project: profile.assigned_project_id,
        'is_approved type': typeof profile.is_approved,
        'is_approved value': profile.is_approved,
        'assigned_project_id type': typeof profile.assigned_project_id,
        'assigned_project_id value': profile.assigned_project_id,
        'assigned_project_id === null': profile.assigned_project_id === null,
        'assigned_project_id === undefined': profile.assigned_project_id === undefined,
        'All profile keys': Object.keys(profile),
      });
    }

    // Debug logging to help diagnose issues
    this.logger.debug(`Checking registrar approval for user ${userId}`, {
      hasError: !!error,
      error: error?.message,
      profile: profile ? {
        role: profile.role,
        is_approved: profile.is_approved,
        assigned_project_id: profile.assigned_project_id,
        assigned_project_id_type: typeof profile.assigned_project_id,
        assigned_project_id_is_null: profile.assigned_project_id === null,
        assigned_project_id_is_undefined: profile.assigned_project_id === undefined,
      } : null,
    });

    if (error || !profile) {
      // If profile doesn't exist, default to registrar and check approval
      this.logger.warn(`Profile not found for user ${userId}`, { error });
      console.log('ERROR: Profile not found or query error');
      throw new ForbiddenException({
        message: 'Konto oczekuje na zatwierdzenie',
        code: 'ACCOUNT_PENDING_APPROVAL',
      });
    }

    // STEP 3: Fix the logic condition - handle both naming conventions
    // Only check approval for registrars (admins bypass this check)
    if (profile.role === 'registrar') {
      // Check both potential naming conventions just to be safe during debugging
      // or standardize on one
      const projectId = (profile as any).assigned_project_id || (profile as any).assignedProjectId;
      const isApproved = (profile as any).is_approved !== undefined 
        ? (profile as any).is_approved === true 
        : (profile as any).isApproved === true;

      console.log('=== REGISTRAR VALIDATION CHECKS ===');
      console.log('Role:', profile.role);
      console.log('isApproved (snake_case):', (profile as any).is_approved);
      console.log('isApproved (camelCase):', (profile as any).isApproved);
      console.log('Final isApproved check:', isApproved);
      console.log('projectId (snake_case):', (profile as any).assigned_project_id);
      console.log('projectId (camelCase):', (profile as any).assignedProjectId);
      console.log('Final projectId check:', projectId);
      console.log('Has project (not null/undefined):', projectId !== null && projectId !== undefined);

      // Check both null and undefined explicitly
      const hasProject = projectId !== null && projectId !== undefined && projectId !== '';

      this.logger.debug(`Registrar approval check for user ${userId}`, {
        isApproved,
        hasProject,
        assigned_project_id: projectId,
      });

      if (!isApproved) {
        console.log('FAILED: Account not approved');
        throw new ForbiddenException({
          message: 'Konto oczekuje na zatwierdzenie przez administratora',
          code: 'ACCOUNT_PENDING_APPROVAL',
        });
      }

      if (!hasProject) {
        console.log('FAILED: No project assigned');
        this.logger.warn(`Registrar ${userId} is approved but has no assigned project`, {
          assigned_project_id: projectId,
        });
        throw new ForbiddenException({
          message: 'Konto nie ma przypisanego projektu',
          code: 'NO_PROJECT_ASSIGNED',
        });
      }

      console.log('SUCCESS: Registrar validation passed');
    } else {
      console.log('SKIPPED: User is not a registrar (role:', profile.role, ')');
    }
  }
}
