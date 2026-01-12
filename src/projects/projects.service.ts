import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { Role } from '../common/enums/role.enum';
import {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectResponseDto,
  AddProjectMemberDto,
  AddProjectMemberByEmailDto,
  UpdateProjectMemberDto,
  ProjectMemberResponseDto,
  CreateFieldDefinitionDto,
  UpdateFieldDefinitionDto,
  FieldDefinitionResponseDto,
  ProjectMemberRole,
  ParticipantsResponseDto,
  ParticipantConfigDto,
  ParticipantDataDto,
  ScanHeadersDto,
  ScanHeadersResponseDto,
  SheetHeaderDto,
  UpdateMappingsDto,
  CreateFieldMappingDto,
  FieldMappingResponseDto,
} from './dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private supabaseService: SupabaseService,
    @Inject(forwardRef(() => GoogleSheetsService))
    private googleSheetsService: GoogleSheetsService,
  ) {}

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
    // Wymagana rola: owner (updateSettings)
    await this.validateProjectRole(projectId, userId, 'owner');
    const role = await this.getUserProjectRole(projectId, userId);

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

    return this.mapProjectToResponse(data, role || undefined);
  }

  /**
   * Deletes a project (only owner can delete)
   */
  async deleteProject(projectId: string, userId: string): Promise<void> {
    // Wymagana rola: owner (deleteProject)
    await this.validateProjectRole(projectId, userId, 'owner');

    const supabase = this.supabaseService.getClient();

    // Sprawdź czy projekt istnieje
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    if (!project) {
      throw new NotFoundException('Projekt nie został znaleziony');
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
    // Wymagana rola: owner (manageMembers)
    await this.validateProjectRole(projectId, userId, 'owner');

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
        role: addMemberDto.role || ProjectMemberRole.VIEWER,
      })
      .select('*')
      .single();

    if (error || !data) {
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
    // Wymagana rola: viewer (dostęp do odczytu)
    await this.validateProjectRole(projectId, userId, 'viewer');

    const supabase = this.supabaseService.getAdminClient();

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

    // Pobierz emaile użytkowników
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const userMap = new Map<string, string>(
      ((authUsers?.users as any[]) || [])
        .filter((u: any) => u.id && u.email)
        .map((u: any) => [u.id, u.email] as [string, string]),
    );

    return (data || []).map((m) => {
      const response = this.mapMemberToResponse(m);
      const email = userMap.get(m.user_id);
      if (email) {
        response.user = { email };
      }
      return response;
    });
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
    // Wymagana rola: owner (manageMembers)
    await this.validateProjectRole(projectId, userId, 'owner');

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
    // Wymagana rola: owner (manageMembers)
    await this.validateProjectRole(projectId, userId, 'owner');

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

  /**
   * Adds a member to a project by email
   */
  async addProjectMemberByEmail(
    projectId: string,
    userId: string,
    addMemberDto: AddProjectMemberByEmailDto,
  ): Promise<ProjectMemberResponseDto> {
    // Wymagana rola: owner (manageMembers)
    await this.validateProjectRole(projectId, userId, 'owner');

    // Cannot add someone as owner through this method
    if (addMemberDto.role === ProjectMemberRole.OWNER) {
      throw new BadRequestException(
        'Nie można dodać użytkownika jako właściciela',
      );
    }

    const supabase = this.supabaseService.getAdminClient();

    // Find user by email
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) {
      this.logger.error('Failed to list users:', authError);
      throw new InternalServerErrorException('Nie udało się znaleźć użytkownika');
    }

    const targetUser = authUsers.users.find(
      (u) => u.email?.toLowerCase() === addMemberDto.email.toLowerCase(),
    );

    if (!targetUser) {
      throw new NotFoundException(
        `Użytkownik o emailu ${addMemberDto.email} nie został znaleziony`,
      );
    }

    // Check if user is already a member
    const { data: existing } = await supabase
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', targetUser.id)
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
        user_id: targetUser.id,
        role: addMemberDto.role || ProjectMemberRole.VIEWER,
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
      `Member ${targetUser.id} (${addMemberDto.email}) added to project ${projectId}`,
    );

    return this.mapMemberToResponse(data);
  }

  /**
   * Removes a member from a project by userId
   */
  async removeProjectMemberByUserId(
    projectId: string,
    targetUserId: string,
    userId: string,
  ): Promise<void> {
    // Wymagana rola: owner (manageMembers)
    await this.validateProjectRole(projectId, userId, 'owner');

    const supabase = this.supabaseService.getClient();

    // Get member to check if it's the owner
    const { data: member } = await supabase
      .from('project_members')
      .select('role, user_id')
      .eq('project_id', projectId)
      .eq('user_id', targetUserId)
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
      .eq('project_id', projectId)
      .eq('user_id', targetUserId);

    if (error) {
      this.logger.error('Failed to remove project member:', error);
      throw new InternalServerErrorException(
        'Nie udało się usunąć członka z projektu',
      );
    }

    this.logger.log(`Member ${targetUserId} removed from project ${projectId}`);
  }

  /**
   * Gets project statistics
   */
  async getProjectStats(
    projectId: string,
    userId: string,
  ): Promise<{
    participantCount: number;
    documentCount: number;
    lastTaskErrorCount: number;
    progressPercentage: number | null;
  }> {
    // Wymagana rola: viewer (dostęp do odczytu)
    await this.validateProjectRole(projectId, userId, 'viewer');

    const supabase = this.supabaseService.getAdminClient();

    // 1. Liczba uczestników - pobierz z Google Sheets (używamy getParticipantsForProject)
    let participantCount = 0;
    try {
      const participantsResponse = await this.getParticipantsForProject(
        projectId,
        userId,
      );
      participantCount = participantsResponse.data.length;
    } catch (error: any) {
      this.logger.warn(
        `Failed to get participant count for project ${projectId}:`,
        error.message,
      );
      // Nie rzucamy błędu, po prostu zwracamy 0
    }

    // 2. Liczba wygenerowanych dokumentów - zlicz z tasków
    const { data: tasks, error: tasksError } = await supabase
      .from('document_generation_tasks')
      .select('output_files, status')
      .eq('project_id', projectId)
      .in('status', ['done', 'failed']);

    let documentCount = 0;
    if (!tasksError && tasks) {
      tasks.forEach((task) => {
        if (task.output_files && Array.isArray(task.output_files)) {
          // Zlicz tylko udane dokumenty (te z pdfFileId)
          const successfulDocs = task.output_files.filter(
            (file: any) => file.pdfFileId && !file.error,
          );
          documentCount += successfulDocs.length;
        }
      });
    }

    // 3. Liczba błędów w ostatnim tasku
    let lastTaskErrorCount = 0;
    const { data: lastTaskData, error: lastTaskError } = await supabase
      .from('document_generation_tasks')
      .select('output_files, status')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastTaskError && lastTaskData) {
      const lastTask = lastTaskData;
      if (lastTask.output_files && Array.isArray(lastTask.output_files)) {
        lastTaskErrorCount = lastTask.output_files.filter(
          (file: any) => file.error,
        ).length;
      }
    }

    // 4. Procentowy postęp (jeśli są aktywne taski)
    const { data: activeTasks } = await supabase
      .from('document_generation_tasks')
      .select('progress_total, progress_done, status')
      .eq('project_id', projectId)
      .in('status', ['pending', 'processing']);

    let progressPercentage: number | null = null;
    if (activeTasks && activeTasks.length > 0) {
      let totalProgress = 0;
      let totalDone = 0;
      activeTasks.forEach((task) => {
        totalProgress += task.progress_total || 0;
        totalDone += task.progress_done || 0;
      });
      if (totalProgress > 0) {
        progressPercentage = Math.round((totalDone / totalProgress) * 100);
      }
    }

    return {
      participantCount,
      documentCount,
      lastTaskErrorCount,
      progressPercentage,
    };
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
    // Wymagana rola: owner (updateSettings)
    await this.validateProjectRole(projectId, userId, 'owner');

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
    // Wymagana rola: owner (updateSettings)
    await this.validateProjectRole(projectId, userId, 'owner');

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
    // Wymagana rola: owner (updateSettings)
    await this.validateProjectRole(projectId, userId, 'owner');

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
    // Wymagana rola: owner (updateSettings)
    await this.validateProjectRole(projectId, userId, 'owner');

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
   * @deprecated Use validateProjectRole instead
   */
  async userHasAdminAccess(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const role = await this.getUserProjectRole(projectId, userId);
    return role !== null && ['owner', 'editor'].includes(role);
  }

  /**
   * Waliduje rolę użytkownika w projekcie i rzuca ForbiddenException jeśli rola jest za niska
   * Hierarchia ról: owner > editor > viewer
   * ADMIN ma "God Mode" - pomija sprawdzanie członkostwa w projekcie
   * @param projectId - ID projektu
   * @param userId - ID użytkownika
   * @param minRole - Minimalna wymagana rola ('owner', 'editor', 'viewer')
   * @throws ForbiddenException jeśli użytkownik nie ma dostępu lub rola jest za niska
   */
  async validateProjectRole(
    projectId: string,
    userId: string,
    minRole: 'owner' | 'editor' | 'viewer',
  ): Promise<void> {
    // God Mode: ADMIN ma pełny dostęp do wszystkich projektów
    const systemRole = await this.getUserSystemRole(userId);
    if (systemRole === Role.ADMIN) {
      return; // ADMIN ma dostęp do wszystkiego, pomijamy sprawdzanie członkostwa
    }

    const userRole = await this.getUserProjectRole(projectId, userId);

    if (!userRole) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    // Definiuj hierarchię ról (wyższa liczba = wyższe uprawnienia)
    const roleHierarchy: Record<string, number> = {
      viewer: 1,
      editor: 2,
      owner: 3,
    };

    const userRoleLevel = roleHierarchy[userRole] || 0;
    const minRoleLevel = roleHierarchy[minRole] || 0;

    if (userRoleLevel < minRoleLevel) {
      throw new ForbiddenException(
        `Wymagana rola: ${minRole}. Twoja rola: ${userRole}`,
      );
    }
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

  // =====================================================
  // PARTICIPANTS OPERATIONS
  // =====================================================

  /**
   * Converts a column letter (e.g., "A", "B", "AA") to a zero-based index
   * @param columnLetter - Column letter (e.g., "A", "B", "AA")
   * @returns Zero-based index (A=0, B=1, AA=26, etc.)
   */
  private columnLetterToIndex(columnLetter: string): number {
    let result = 0;
    const upperLetter = columnLetter.toUpperCase();
    
    for (let i = 0; i < upperLetter.length; i++) {
      const char = upperLetter.charCodeAt(i) - 64; // A=1, B=2, etc.
      result = result * 26 + char;
    }
    
    return result - 1; // Convert to zero-based index
  }

  /**
   * Gets participants data for a project by fetching from Google Sheets
   * and mapping columns according to project_field_mappings configuration
   * @param projectId - ID of the project
   * @param userId - ID of the user (for authorization)
   * @returns Mapped participants data with configuration
   */
  async getParticipantsForProject(
    projectId: string,
    userId: string,
  ): Promise<ParticipantsResponseDto> {
    // Check if user has access to project
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    const supabase = this.supabaseService.getClient();

    // Step 1: Get field mappings for the project
    const { data: mappings, error: mappingsError } = await supabase
      .from('project_field_mappings')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_visible', true)
      .order('sheet_column_letter', { ascending: true });

    if (mappingsError) {
      this.logger.error('Failed to fetch field mappings:', mappingsError);
      throw new InternalServerErrorException(
        'Nie udało się pobrać mapowania pól',
      );
    }

    if (!mappings || mappings.length === 0) {
      // Return empty response if no mappings configured
      return {
        config: [],
        data: [],
      };
    }

    // Step 2: Get sheet configuration for the project
    const sheetConfig = await this.googleSheetsService.getProjectSheetConfiguration(
      projectId,
      userId,
    );

    if (!sheetConfig) {
      throw new NotFoundException(
        'Projekt nie ma skonfigurowanego arkusza Google Sheets',
      );
    }

    // Step 3: Fetch raw data from Google Sheets (range A:Z)
    let rawSheetData: any[][];
    try {
      rawSheetData = await this.googleSheetsService.getProjectSheetData(
        projectId,
        userId,
        'A:Z',
      );
    } catch (error: any) {
      this.logger.error('Failed to fetch sheet data:', error);
      throw new InternalServerErrorException(
        'Nie udało się pobrać danych z arkusza Google Sheets',
      );
    }

    if (!rawSheetData || rawSheetData.length === 0) {
      // Return empty data if sheet is empty
      const config: ParticipantConfigDto[] = mappings.map((m) => ({
        key: m.internal_key,
        label: m.display_name,
      }));

      return {
        config,
        data: [],
      };
    }

    // Step 4: Build column index mapping
    const columnIndexMap = new Map<string, number>();
    mappings.forEach((mapping) => {
      const index = this.columnLetterToIndex(mapping.sheet_column_letter);
      columnIndexMap.set(mapping.internal_key, index);
    });

    // Step 5: Transform rows from Google Sheets to participant objects
    const participants: ParticipantDataDto[] = [];
    
    // Skip first row if it's a header (optional - you might want to make this configurable)
    const startRow = 0; // Start from first row (0-indexed)
    
    for (let rowIndex = startRow; rowIndex < rawSheetData.length; rowIndex++) {
      const row = rawSheetData[rowIndex];
      
      // Skip empty rows
      if (!row || row.length === 0 || row.every((cell) => !cell || cell.toString().trim() === '')) {
        continue;
      }

      const participant: ParticipantDataDto = {
        id: rowIndex + 1, // Use row number as ID (1-indexed)
      };

      // Map each field according to the mapping configuration
      mappings.forEach((mapping) => {
        const columnIndex = this.columnLetterToIndex(mapping.sheet_column_letter);
        const value = row[columnIndex] !== undefined ? row[columnIndex] : null;
        participant[mapping.internal_key] = value;
      });

      participants.push(participant);
    }

    // Step 6: Build configuration array
    const config: ParticipantConfigDto[] = mappings.map((m) => ({
      key: m.internal_key,
      label: m.display_name,
    }));

    this.logger.log(
      `Fetched ${participants.length} participants for project ${projectId}`,
    );

    return {
      config,
      data: participants,
    };
  }

  // =====================================================
  // FIELD MAPPING OPERATIONS
  // =====================================================

  /**
   * Converts a zero-based index to a column letter (e.g., 0 -> "A", 25 -> "Z", 26 -> "AA")
   * @param index - Zero-based column index
   * @returns Column letter
   */
  private indexToColumnLetter(index: number): string {
    let result = '';
    let num = index + 1; // Convert to 1-based
    
    while (num > 0) {
      const remainder = (num - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      num = Math.floor((num - 1) / 26);
    }
    
    return result;
  }

  /**
   * Scans headers from a Google Sheet
   * Fetches the first row (A1:Z1) and returns headers with their column letters
   * @param projectId - ID of the project
   * @param userId - ID of the user (for authorization)
   * @param spreadsheetIdOrUrl - Google Sheets spreadsheet ID or full URL
   * @returns Array of headers with column letters
   */
  async scanSheetHeaders(
    projectId: string,
    userId: string,
    spreadsheetIdOrUrl: string,
  ): Promise<ScanHeadersResponseDto> {
    // Wymagana rola: owner (updateSettings)
    await this.validateProjectRole(projectId, userId, 'owner');

    // Extract spreadsheet ID if a full URL was provided
    let spreadsheetId = spreadsheetIdOrUrl.trim();
    if (spreadsheetId.includes('/')) {
      try {
        spreadsheetId = this.googleSheetsService.extractSheetIdFromUrl(spreadsheetId);
      } catch (error: any) {
        throw new BadRequestException(
          'Nieprawidłowy format URL lub ID arkusza. Podaj pełny URL lub ID arkusza.',
        );
      }
    }

    // Fetch headers from Google Sheets (range A1:Z1)
    let rawHeaders: any[][];
    try {
      rawHeaders = await this.googleSheetsService.getSheetData(
        spreadsheetId,
        'A1:Z1',
      );
    } catch (error: any) {
      this.logger.error('Failed to fetch sheet headers:', error);
      throw new InternalServerErrorException(
        'Nie udało się pobrać nagłówków z arkusza Google Sheets',
      );
    }

    // Extract first row (headers)
    const headerRow = rawHeaders && rawHeaders.length > 0 ? rawHeaders[0] : [];

    // Build response with column letters
    // Include all columns from the sheet, even if header is empty
    const headers: SheetHeaderDto[] = [];
    const maxColumns = Math.min(headerRow.length, 26); // Up to column Z (26 columns)
    
    for (let i = 0; i < maxColumns; i++) {
      const letter = this.indexToColumnLetter(i);
      const value = headerRow[i] ? String(headerRow[i]).trim() : '';
      
      // Include all columns, even if empty (user can still map to empty columns)
      headers.push({
        letter,
        value,
      });
    }

    this.logger.log(
      `Scanned ${headers.length} headers from sheet ${spreadsheetId} for project ${projectId}`,
    );

    return { headers };
  }

  /**
   * Gets all field mappings for a project
   * @param projectId - ID of the project
   * @param userId - ID of the user (for authorization)
   * @returns Array of saved mappings
   */
  async getProjectMappings(
    projectId: string,
    userId: string,
  ): Promise<FieldMappingResponseDto[]> {
    // Check if user has access to project
    const role = await this.getUserProjectRole(projectId, userId);
    if (!role) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('project_field_mappings')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch field mappings:', error);
      throw new InternalServerErrorException(
        'Nie udało się pobrać mapowań pól',
      );
    }

    return (data || []).map((m) => this.mapFieldMappingToResponse(m));
  }

  /**
   * Updates field mappings for a project
   * Overwrites all existing mappings with the new ones
   * @param projectId - ID of the project
   * @param userId - ID of the user (for authorization)
   * @param mappings - Array of mappings to save
   * @returns Array of saved mappings
   */
  async updateProjectMappings(
    projectId: string,
    userId: string,
    mappings: CreateFieldMappingDto[],
  ): Promise<FieldMappingResponseDto[]> {
    // Wymagana rola: owner (updateSettings)
    await this.validateProjectRole(projectId, userId, 'owner');

    const supabase = this.supabaseService.getAdminClient();

    // Step 1: Delete all existing mappings for this project
    const { error: deleteError } = await supabase
      .from('project_field_mappings')
      .delete()
      .eq('project_id', projectId);

    if (deleteError) {
      this.logger.error('Failed to delete existing mappings:', deleteError);
      throw new InternalServerErrorException(
        'Nie udało się usunąć istniejących mapowań',
      );
    }

    // Step 2: Insert new mappings
    if (mappings.length === 0) {
      this.logger.log(`All mappings removed for project ${projectId}`);
      return [];
    }

    const insertData = mappings.map((mapping) => ({
      project_id: projectId,
      sheet_column_letter: mapping.sheetColumnLetter,
      internal_key: mapping.internalKey,
      display_name: mapping.displayName,
      is_visible: mapping.isVisible ?? true,
      field_type: mapping.fieldType ?? 'text',
      is_required: mapping.isRequired ?? false,
      max_length: mapping.maxLength ?? null,
      options: mapping.options && mapping.options.length > 0 ? mapping.options : null,
    }));

    const { data, error: insertError } = await supabase
      .from('project_field_mappings')
      .insert(insertData)
      .select('*');

    if (insertError) {
      this.logger.error('Failed to insert new mappings:', insertError);
      throw new InternalServerErrorException(
        'Nie udało się zapisać nowych mapowań',
      );
    }

    this.logger.log(
      `Updated ${data.length} mappings for project ${projectId}`,
    );

    return (data || []).map((m) => this.mapFieldMappingToResponse(m));
  }

  /**
   * Maps database field mapping to response DTO
   */
  private mapFieldMappingToResponse(mapping: any): FieldMappingResponseDto {
    // Parse options from JSONB if it exists
    let options: string[] | null = null;
    if (mapping.options) {
      try {
        options = typeof mapping.options === 'string' 
          ? JSON.parse(mapping.options) 
          : mapping.options;
      } catch (error) {
        this.logger.warn(`Failed to parse options for mapping ${mapping.id}:`, error);
        options = null;
      }
    }

    return {
      id: mapping.id,
      projectId: mapping.project_id,
      sheetColumnLetter: mapping.sheet_column_letter,
      internalKey: mapping.internal_key,
      displayName: mapping.display_name,
      isVisible: mapping.is_visible,
      fieldType: mapping.field_type ?? 'text',
      isRequired: mapping.is_required ?? false,
      maxLength: mapping.max_length ?? null,
      options: options,
      createdAt: mapping.created_at,
      updatedAt: mapping.updated_at,
    };
  }
}
