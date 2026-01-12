import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { ProjectsService } from '../projects/projects.service';
import {
  UpdateUserApprovalDto,
  UserResponseDto,
  UserListResponseDto,
} from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/guards/auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { SupabaseService } from '../supabase/supabase.service';

@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Get all users (admin) or project members (owner)
   */
  @Get()
  async getAllUsers(
    @CurrentUser() user: RequestUser,
    @Query('projectId') projectId?: string,
  ): Promise<UserListResponseDto> {
    // Sprawdź rolę systemową użytkownika
    const systemRole = await this.projectsService.getUserSystemRole(user.id);

    // Jeśli ADMIN i nie podano projectId -> zwróć wszystkich użytkowników
    if (systemRole === Role.ADMIN && !projectId) {
      return this.usersService.getAllUsers(user.id);
    }

    // Jeśli podano projectId -> sprawdź uprawnienia i pobierz członków projektu
    if (projectId) {
      // Sprawdź uprawnienia (validateProjectRole rzuci ForbiddenException jeśli brak dostępu)
      await this.projectsService.validateProjectRole(projectId, user.id, 'viewer');

      // Pobierz informacje o projekcie (dla nazwy projektu)
      const project = await this.projectsService.getProjectById(projectId, user.id);

      // Pobierz członków projektu
      const members = await this.projectsService.getProjectMembers(projectId, user.id);

      // Pobierz dane użytkowników - użyj serwisu, który zwraca przetworzone DTO
      let authUsersMap = new Map<string, UserResponseDto>();
      try {
        const allUsers = await this.usersService.getAllUsers(user.id);
        authUsersMap = new Map(
          (allUsers.users || []).map((u) => [u.id, u] as [string, UserResponseDto]),
        );
      } catch (error) {
        // Jeśli nie można pobrać globalnej listy (np. brak uprawnień admina),
        // kontynuuj z samymi danymi członków projektu
        this.logger.warn(
          'Nie udało się pobrać globalnej listy użytkowników, używam tylko danych członków projektu',
        );
      }

      // Zmapuj członków projektu na strukturę UserResponseDto
      const users: UserResponseDto[] = members.map((member) => {
        const authUser = authUsersMap.get(member.userId);
        return {
          id: member.userId,
          email: member.user?.email || '',
          firstName: authUser?.firstName || '',
          lastName: authUser?.lastName || '',
          role: member.role, // rola w projekcie (owner/editor/viewer)
          isApproved: true, // członkowie projektu są automatycznie zatwierdzeni
          assignedProjectId: projectId,
          assignedProjectName: project.name,
          createdAt: authUser?.createdAt || member.createdAt,
          updatedAt: authUser?.updatedAt || member.createdAt,
        };
      });

      return {
        users,
        total: users.length,
      };
    }

    // Jeśli nie ADMIN i brak projectId -> brak dostępu
    throw new ForbiddenException(
      'Brak dostępu. Musisz być administratorem lub podać projectId.',
    );
  }

  /**
   * Update user approval status and/or project assignment (admin only)
   */
  @Put(':userId/approval')
  @Roles(Role.ADMIN)
  async updateUserApproval(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() updateDto: UpdateUserApprovalDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UserResponseDto> {
    return this.usersService.updateUserApproval(user.id, targetUserId, updateDto);
  }

  /**
   * Delete a user (admin only)
   * Prevents self-deletion
   */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  async deleteUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.usersService.deleteUser(user.id, targetUserId);
  }
}

