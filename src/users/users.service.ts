import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Role } from '../common/enums/role.enum';
import {
  UpdateUserApprovalDto,
  UserResponseDto,
  UserListResponseDto,
} from './dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private supabaseService: SupabaseService) {}

  /**
   * Gets all users with their profiles (admin only)
   */
  async getAllUsers(userId: string): Promise<UserListResponseDto> {
    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId);
    if (!isAdmin) {
      throw new ForbiddenException('Tylko administratorzy mogą przeglądać użytkowników');
    }

    const supabase = this.supabaseService.getClient();

    // Get all users from auth.users
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      this.logger.error('Failed to fetch users:', authError);
      throw new InternalServerErrorException('Nie udało się pobrać użytkowników');
    }

    // Get all profiles
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('*');

    if (profilesError) {
      this.logger.error('Failed to fetch profiles:', profilesError);
      throw new InternalServerErrorException('Nie udało się pobrać profili');
    }

    // Create a map of profiles by user id
    const profileMap = new Map(
      (profiles || []).map((p) => [p.id, p]),
    );

    // Get all projects for project name lookup
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('id, name');

    if (projectsError) {
      this.logger.error('Failed to fetch projects:', projectsError);
      throw new InternalServerErrorException('Nie udało się pobrać projektów');
    }

    const projectMap = new Map(
      (projects || []).map((p) => [p.id, p.name]),
    );

    // Combine auth users with profiles
    const users: UserResponseDto[] = (authUsers.users || []).map((user) => {
      const profile = profileMap.get(user.id);
      const assignedProjectName = profile?.assigned_project_id
        ? projectMap.get(profile.assigned_project_id) || null
        : null;

      return {
        id: user.id,
        email: user.email || '',
        firstName: user.user_metadata?.first_name,
        lastName: user.user_metadata?.last_name,
        role: profile?.role || 'registrar',
        isApproved: profile?.is_approved ?? false,
        assignedProjectId: profile?.assigned_project_id || null,
        assignedProjectName,
        createdAt: user.created_at,
        updatedAt: profile?.updated_at || user.updated_at,
      };
    });

    return {
      users,
      total: users.length,
    };
  }

  /**
   * Updates a user's approval status and/or assigned project (admin only)
   */
  async updateUserApproval(
    userId: string,
    targetUserId: string,
    updateDto: UpdateUserApprovalDto,
  ): Promise<UserResponseDto> {
    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId);
    if (!isAdmin) {
      throw new ForbiddenException('Tylko administratorzy mogą zarządzać użytkownikami');
    }

    const supabase = this.supabaseService.getClient();

    // Check if target user exists
    const { data: targetUser, error: userError } = await supabase.auth.admin.getUserById(
      targetUserId,
    );

    if (userError || !targetUser.user) {
      throw new NotFoundException('Użytkownik nie został znaleziony');
    }

    // Check if profile exists
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', targetUserId)
      .single();

    if (!existingProfile) {
      throw new NotFoundException('Profil użytkownika nie został znaleziony');
    }

    // Validate project assignment if provided
    if (updateDto.assignedProjectId !== undefined && updateDto.assignedProjectId !== null) {
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', updateDto.assignedProjectId)
        .single();

      if (!project) {
        throw new BadRequestException('Projekt nie został znaleziony');
      }
    }

    // Update profile
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (updateDto.isApproved !== undefined) {
      updateData.is_approved = updateDto.isApproved;
    }

    // Handle project assignment (can be null to unassign)
    if (updateDto.assignedProjectId !== undefined) {
      updateData.assigned_project_id = updateDto.assignedProjectId ?? null;
    }

    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', targetUserId)
      .select('*')
      .single();

    if (updateError) {
      this.logger.error('Failed to update user approval:', updateError);
      throw new InternalServerErrorException('Nie udało się zaktualizować użytkownika');
    }

    // Get project name if assigned
    let assignedProjectName = null;
    if (updatedProfile.assigned_project_id) {
      const { data: project } = await supabase
        .from('projects')
        .select('name')
        .eq('id', updatedProfile.assigned_project_id)
        .single();

      assignedProjectName = project?.name || null;
    }

    return {
      id: targetUser.user.id,
      email: targetUser.user.email || '',
      firstName: targetUser.user.user_metadata?.first_name,
      lastName: targetUser.user.user_metadata?.last_name,
      role: updatedProfile.role,
      isApproved: updatedProfile.is_approved,
      assignedProjectId: updatedProfile.assigned_project_id || null,
      assignedProjectName,
      createdAt: targetUser.user.created_at,
      updatedAt: updatedProfile.updated_at,
    };
  }

  /**
   * Deletes a user (admin only)
   * Prevents self-deletion
   */
  async deleteUser(
    currentUserId: string,
    targetUserId: string,
  ): Promise<void> {
    // Check if user is admin
    const isAdmin = await this.isUserAdmin(currentUserId);
    if (!isAdmin) {
      throw new ForbiddenException('Tylko administratorzy mogą usuwać użytkowników');
    }

    // Prevent self-deletion
    if (targetUserId === currentUserId) {
      throw new ForbiddenException('Nie możesz usunąć własnego konta');
    }

    const supabase = this.supabaseService.getClient();

    // Check if target user exists
    const { data: targetUser, error: userError } = await supabase.auth.admin.getUserById(
      targetUserId,
    );

    if (userError || !targetUser.user) {
      throw new NotFoundException('Użytkownik nie został znaleziony');
    }

    // Delete user from auth (this will cascade delete profile due to RLS/triggers)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      this.logger.error('Failed to delete user:', deleteError);
      throw new InternalServerErrorException('Nie udało się usunąć użytkownika');
    }

    this.logger.log(`User deleted: ${targetUserId} by ${currentUserId}`);
  }

  /**
   * Checks if a user is an admin
   */
  private async isUserAdmin(userId: string): Promise<boolean> {
    const supabase = this.supabaseService.getClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    return profile?.role === 'admin';
  }
}

