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
  CreateProjectDto,
  UpdateProjectDto,
  ProjectResponseDto,
  AddProjectMemberDto,
  UpdateProjectMemberDto,
  ProjectMemberResponseDto,
  CreateFieldDefinitionDto,
  UpdateFieldDefinitionDto,
  FieldDefinitionResponseDto,
  ProjectMemberRole,
} from './dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private supabaseService: SupabaseService) {}

  // =====================================================
  // PROJECT CRUD OPERATIONS
  // =====================================================

  /**
   * Creates a new project
   */
  async createProject(
    userId: string,
    createProjectDto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: createProjectDto.name,
        description: createProjectDto.description || null,
        owner_id: userId,
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to create project:', error);
      throw new InternalServerErrorException('Nie udało się utworzyć projektu');
    }

    // Add owner as a member with 'owner' role
    await supabase.from('project_members').insert({
      project_id: data.id,
      user_id: userId,
      role: ProjectMemberRole.OWNER,
    });

    this.logger.log(`Project created: ${data.id} by user ${userId}`);

    return this.mapProjectToResponse(data, 'owner');
  }

  /**
   * Gets the user's system role from profiles table
   * Authorization is handled by backend logic
   */
  async getUserSystemRole(userId: string): Promise<Role> {
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !data) {
      this.logger.warn(`Could not fetch profile for user ${userId}, defaulting to REGISTRAR`);
      return Role.REGISTRAR;
    }

    return data.role === 'admin' ? Role.ADMIN : Role.REGISTRAR;
  }

  /**
   * Gets all projects for a user based on their system role
   * - ADMIN: Gets ALL projects in the system
   * - REGISTRAR: Gets only projects they are a member of
   */
  async getUserProjects(userId: string): Promise<ProjectResponseDto[]> {
    const supabase = this.supabaseService.getClient();

    // First, get user's system role
    const systemRole = await this.getUserSystemRole(userId);

    if (systemRole === Role.ADMIN) {
      // ADMIN: Return ALL projects
      return this.getAllProjects();
    }

    // REGISTRAR: Return only assigned projects
    return this.getUserAssignedProjects(userId);
  }

  /**
   * Gets ALL projects in the system (for admins)
   * Uses admin client to bypass RLS
   */
  private async getAllProjects(): Promise<ProjectResponseDto[]> {
    const supabase = this.supabaseService.getAdminClient();

    const { data: projects, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch all projects:', error);
      throw new InternalServerErrorException('Nie udało się pobrać projektów');
    }

    return (projects || []).map((p) => this.mapProjectToResponse(p, 'admin'));
  }

  /**
   * Gets only projects the user is assigned to (for registrars)
   */
  private async getUserAssignedProjects(userId: string): Promise<ProjectResponseDto[]> {
    const supabase = this.supabaseService.getClient();

    // Get projects where user is owner
    const { data: ownedProjects, error: ownedError } = await supabase
      .from('projects')
      .select('*')
      .eq('owner_id', userId);

    if (ownedError) {
      this.logger.error('Failed to fetch owned projects:', ownedError);
      throw new InternalServerErrorException('Nie udało się pobrać projektów');
    }

    // Get projects where user is a member (but not owner)
    const { data: memberProjects, error: memberError } = await supabase
      .from('project_members')
      .select('project_id, role, projects(*)')
      .eq('user_id', userId)
      .neq('role', ProjectMemberRole.OWNER);

    if (memberError) {
      this.logger.error('Failed to fetch member projects:', memberError);
      throw new InternalServerErrorException('Nie udało się pobrać projektów');
    }

    // Combine and map results
    const owned = (ownedProjects || []).map((p) =>
      this.mapProjectToResponse(p, 'owner'),
    );

    const member = (memberProjects || [])
      .filter((m) => m.projects)
      .map((m) => this.mapProjectToResponse(m.projects as any, m.role));

    // Remove duplicates (user might be both owner and in members table)
    const projectMap = new Map<string, ProjectResponseDto>();
    [...owned, ...member].forEach((p) => {
      if (!projectMap.has(p.id) || p.role === 'owner') {
        projectMap.set(p.id, p);
      }
    });

    return Array.from(projectMap.values());
  }

  /**
   * Gets a single project by ID
   */
  async getProjectById(
    projectId: string,
    userId: string,
  ): Promise<ProjectResponseDto> {
    const supabase = this.supabaseService.getClient();

    const { data: project, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (error || !project) {
      throw new NotFoundException('Projekt nie został znaleziony');
    }

    // Check user access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    // Get member count
    const { count } = await supabase
      .from('project_members')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);

    return {
      ...this.mapProjectToResponse(project, role),
      memberCount: count || 0,
    };
  }

  /**
   * Updates a project
   */
  async updateProject(
    projectId: string,
    userId: string,
    updateProjectDto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    // Check if user has admin access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Brak uprawnień do edycji tego projektu',
      );
    }

    const supabase = this.supabaseService.getClient();

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (updateProjectDto.name !== undefined) {
      updateData.name = updateProjectDto.name;
    }
    if (updateProjectDto.description !== undefined) {
      updateData.description = updateProjectDto.description;
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to update project:', error);
      throw new InternalServerErrorException(
        'Nie udało się zaktualizować projektu',
      );
    }

    this.logger.log(`Project updated: ${projectId}`);

    return this.mapProjectToResponse(data, role);
  }

  /**
   * Deletes a project (only owner can delete)
   */
  async deleteProject(projectId: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Check if user is owner
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    if (!project) {
      throw new NotFoundException('Projekt nie został znaleziony');
    }

    if (project.owner_id !== userId) {
      throw new ForbiddenException(
        'Tylko właściciel może usunąć projekt',
      );
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (error) {
      this.logger.error('Failed to delete project:', error);
      throw new InternalServerErrorException('Nie udało się usunąć projektu');
    }

    this.logger.log(`Project deleted: ${projectId}`);
  }

  // =====================================================
  // PROJECT MEMBER OPERATIONS
  // =====================================================

  /**
   * Adds a member to a project
   */
  async addProjectMember(
    projectId: string,
    userId: string,
    addMemberDto: AddProjectMemberDto,
  ): Promise<ProjectMemberResponseDto> {
    // Check if user has admin access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Brak uprawnień do dodawania członków',
      );
    }

    // Cannot add someone as owner through this method
    if (addMemberDto.role === ProjectMemberRole.OWNER) {
      throw new BadRequestException(
        'Nie można dodać użytkownika jako właściciela',
      );
    }

    const supabase = this.supabaseService.getClient();

    // Check if user is already a member
    const { data: existing } = await supabase
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', addMemberDto.userId)
      .single();

    if (existing) {
      throw new BadRequestException(
        'Użytkownik jest już członkiem tego projektu',
      );
    }

    const { data, error } = await supabase
      .from('project_members')
      .insert({
        project_id: projectId,
        user_id: addMemberDto.userId,
        role: addMemberDto.role || ProjectMemberRole.MEMBER,
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to add project member:', error);
      throw new InternalServerErrorException(
        'Nie udało się dodać członka do projektu',
      );
    }

    this.logger.log(
      `Member ${addMemberDto.userId} added to project ${projectId}`,
    );

    return this.mapMemberToResponse(data);
  }

  /**
   * Gets all members of a project
   */
  async getProjectMembers(
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberResponseDto[]> {
    // Check if user has access to project
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('project_members')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch project members:', error);
      throw new InternalServerErrorException(
        'Nie udało się pobrać członków projektu',
      );
    }

    return (data || []).map((m) => this.mapMemberToResponse(m));
  }

  /**
   * Updates a member's role
   */
  async updateProjectMember(
    projectId: string,
    memberId: string,
    userId: string,
    updateMemberDto: UpdateProjectMemberDto,
  ): Promise<ProjectMemberResponseDto> {
    // Check if user has admin access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Brak uprawnień do edycji członków',
      );
    }

    // Cannot change to owner role
    if (updateMemberDto.role === ProjectMemberRole.OWNER) {
      throw new BadRequestException('Nie można zmienić roli na właściciela');
    }

    const supabase = this.supabaseService.getClient();

    // Get current member to check if it's the owner
    const { data: member } = await supabase
      .from('project_members')
      .select('role')
      .eq('id', memberId)
      .eq('project_id', projectId)
      .single();

    if (!member) {
      throw new NotFoundException('Członek nie został znaleziony');
    }

    if (member.role === ProjectMemberRole.OWNER) {
      throw new BadRequestException(
        'Nie można zmienić roli właściciela projektu',
      );
    }

    const { data, error } = await supabase
      .from('project_members')
      .update({
        role: updateMemberDto.role,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .eq('project_id', projectId)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to update project member:', error);
      throw new InternalServerErrorException(
        'Nie udało się zaktualizować członka projektu',
      );
    }

    return this.mapMemberToResponse(data);
  }

  /**
   * Removes a member from a project
   */
  async removeProjectMember(
    projectId: string,
    memberId: string,
    userId: string,
  ): Promise<void> {
    // Check if user has admin access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Brak uprawnień do usuwania członków',
      );
    }

    const supabase = this.supabaseService.getClient();

    // Get member to check if it's the owner
    const { data: member } = await supabase
      .from('project_members')
      .select('role, user_id')
      .eq('id', memberId)
      .eq('project_id', projectId)
      .single();

    if (!member) {
      throw new NotFoundException('Członek nie został znaleziony');
    }

    if (member.role === ProjectMemberRole.OWNER) {
      throw new BadRequestException(
        'Nie można usunąć właściciela projektu',
      );
    }

    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('id', memberId)
      .eq('project_id', projectId);

    if (error) {
      this.logger.error('Failed to remove project member:', error);
      throw new InternalServerErrorException(
        'Nie udało się usunąć członka z projektu',
      );
    }

    this.logger.log(`Member ${memberId} removed from project ${projectId}`);
  }

  // =====================================================
  // FIELD DEFINITIONS OPERATIONS
  // =====================================================

  /**
   * Creates a field definition for a project
   */
  async createFieldDefinition(
    projectId: string,
    userId: string,
    createFieldDto: CreateFieldDefinitionDto,
  ): Promise<FieldDefinitionResponseDto> {
    // Check if user has admin access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Brak uprawnień do tworzenia definicji pól',
      );
    }

    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('field_definitions')
      .insert({
        project_id: projectId,
        field_name: createFieldDto.fieldName,
        field_label: createFieldDto.fieldLabel,
        field_type: createFieldDto.fieldType || 'text',
        column_index: createFieldDto.columnIndex,
        is_required: createFieldDto.isRequired || false,
        options: createFieldDto.options || null,
        validation_rules: createFieldDto.validationRules || null,
        display_order: createFieldDto.displayOrder || 0,
        is_visible: createFieldDto.isVisible ?? true,
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to create field definition:', error);
      if (error.code === '23505') {
        throw new BadRequestException(
          'Pole o tej nazwie lub indeksie kolumny już istnieje w tym projekcie',
        );
      }
      throw new InternalServerErrorException(
        'Nie udało się utworzyć definicji pola',
      );
    }

    this.logger.log(`Field definition created: ${data.id} for project ${projectId}`);

    return this.mapFieldDefinitionToResponse(data);
  }

  /**
   * Creates multiple field definitions at once
   */
  async bulkCreateFieldDefinitions(
    projectId: string,
    userId: string,
    fields: CreateFieldDefinitionDto[],
  ): Promise<FieldDefinitionResponseDto[]> {
    // Check if user has admin access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Brak uprawnień do tworzenia definicji pól',
      );
    }

    const supabase = this.supabaseService.getClient();

    const insertData = fields.map((field) => ({
      project_id: projectId,
      field_name: field.fieldName,
      field_label: field.fieldLabel,
      field_type: field.fieldType || 'text',
      column_index: field.columnIndex,
      is_required: field.isRequired || false,
      options: field.options || null,
      validation_rules: field.validationRules || null,
      display_order: field.displayOrder || 0,
      is_visible: field.isVisible ?? true,
    }));

    const { data, error } = await supabase
      .from('field_definitions')
      .insert(insertData)
      .select('*');

    if (error) {
      this.logger.error('Failed to bulk create field definitions:', error);
      throw new InternalServerErrorException(
        'Nie udało się utworzyć definicji pól',
      );
    }

    return (data || []).map((f) => this.mapFieldDefinitionToResponse(f));
  }

  /**
   * Gets all field definitions for a project
   */
  async getProjectFieldDefinitions(
    projectId: string,
    userId: string,
  ): Promise<FieldDefinitionResponseDto[]> {
    // Check if user has access to project
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('field_definitions')
      .select('*')
      .eq('project_id', projectId)
      .order('display_order', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch field definitions:', error);
      throw new InternalServerErrorException(
        'Nie udało się pobrać definicji pól',
      );
    }

    return (data || []).map((f) => this.mapFieldDefinitionToResponse(f));
  }

  /**
   * Updates a field definition
   */
  async updateFieldDefinition(
    projectId: string,
    fieldId: string,
    userId: string,
    updateFieldDto: UpdateFieldDefinitionDto,
  ): Promise<FieldDefinitionResponseDto> {
    // Check if user has admin access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Brak uprawnień do edycji definicji pól',
      );
    }

    const supabase = this.supabaseService.getClient();

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (updateFieldDto.fieldLabel !== undefined) {
      updateData.field_label = updateFieldDto.fieldLabel;
    }
    if (updateFieldDto.fieldType !== undefined) {
      updateData.field_type = updateFieldDto.fieldType;
    }
    if (updateFieldDto.columnIndex !== undefined) {
      updateData.column_index = updateFieldDto.columnIndex;
    }
    if (updateFieldDto.isRequired !== undefined) {
      updateData.is_required = updateFieldDto.isRequired;
    }
    if (updateFieldDto.options !== undefined) {
      updateData.options = updateFieldDto.options;
    }
    if (updateFieldDto.validationRules !== undefined) {
      updateData.validation_rules = updateFieldDto.validationRules;
    }
    if (updateFieldDto.displayOrder !== undefined) {
      updateData.display_order = updateFieldDto.displayOrder;
    }
    if (updateFieldDto.isVisible !== undefined) {
      updateData.is_visible = updateFieldDto.isVisible;
    }

    const { data, error } = await supabase
      .from('field_definitions')
      .update(updateData)
      .eq('id', fieldId)
      .eq('project_id', projectId)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to update field definition:', error);
      throw new InternalServerErrorException(
        'Nie udało się zaktualizować definicji pola',
      );
    }

    if (!data) {
      throw new NotFoundException('Definicja pola nie została znaleziona');
    }

    return this.mapFieldDefinitionToResponse(data);
  }

  /**
   * Deletes a field definition
   */
  async deleteFieldDefinition(
    projectId: string,
    fieldId: string,
    userId: string,
  ): Promise<void> {
    // Check if user has admin access
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Brak uprawnień do usuwania definicji pól',
      );
    }

    const supabase = this.supabaseService.getClient();

    const { error } = await supabase
      .from('field_definitions')
      .delete()
      .eq('id', fieldId)
      .eq('project_id', projectId);

    if (error) {
      this.logger.error('Failed to delete field definition:', error);
      throw new InternalServerErrorException(
        'Nie udało się usunąć definicji pola',
      );
    }

    this.logger.log(`Field definition ${fieldId} deleted from project ${projectId}`);
  }

  // =====================================================
  // HELPER METHODS
  // =====================================================

  /**
   * Gets user's role in a project
   */
  async getUserProjectRole(
    projectId: string,
    userId: string,
  ): Promise<string | null> {
    const supabase = this.supabaseService.getClient();

    // Check if owner
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    if (project?.owner_id === userId) {
      return 'owner';
    }

    // Check membership
    const { data: member } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();

    return member?.role || null;
  }

  /**
   * Checks if user has access to a project
   */
  async userHasProjectAccess(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const role = await this.getUserProjectRole(projectId, userId);
    return role !== null;
  }

  /**
   * Checks if user has admin access to a project
   */
  async userHasAdminAccess(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const role = await this.getUserProjectRole(projectId, userId);
    return role !== null && ['owner', 'admin'].includes(role);
  }

  private mapProjectToResponse(
    project: any,
    role?: string,
  ): ProjectResponseDto {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      ownerId: project.owner_id,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      role,
    };
  }

  private mapMemberToResponse(member: any): ProjectMemberResponseDto {
    return {
      id: member.id,
      projectId: member.project_id,
      userId: member.user_id,
      role: member.role,
      createdAt: member.created_at,
    };
  }

  private mapFieldDefinitionToResponse(field: any): FieldDefinitionResponseDto {
    return {
      id: field.id,
      projectId: field.project_id,
      fieldName: field.field_name,
      fieldLabel: field.field_label,
      fieldType: field.field_type,
      columnIndex: field.column_index,
      isRequired: field.is_required,
      options: field.options,
      validationRules: field.validation_rules,
      displayOrder: field.display_order,
      isVisible: field.is_visible,
      createdAt: field.created_at,
      updatedAt: field.updated_at,
    };
  }
}
