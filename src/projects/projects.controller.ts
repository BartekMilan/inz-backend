import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectResponseDto,
  ProjectListResponseDto,
  AddProjectMemberDto,
  UpdateProjectMemberDto,
  ProjectMemberResponseDto,
  CreateFieldDefinitionDto,
  UpdateFieldDefinitionDto,
  FieldDefinitionResponseDto,
  BulkCreateFieldDefinitionsDto,
  ParticipantsResponseDto,
  ScanHeadersDto,
  ScanHeadersResponseDto,
  UpdateMappingsDto,
  FieldMappingResponseDto,
} from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/guards/auth.guard';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // =====================================================
  // USER ROLE ENDPOINT
  // =====================================================

  /**
   * Get the current user's system role
   */
  @Get('me/role')
  async getUserRole(
    @CurrentUser() user: RequestUser,
  ): Promise<{ role: string }> {
    const role = await this.projectsService.getUserSystemRole(user.id);
    return { role };
  }

  // =====================================================
  // PROJECT ENDPOINTS
  // =====================================================

  /**
   * Create a new project
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProject(
    @Body() createProjectDto: CreateProjectDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.createProject(user.id, createProjectDto);
  }

  /**
   * Get all projects for the current user
   */
  @Get()
  async getUserProjects(
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectListResponseDto> {
    const projects = await this.projectsService.getUserProjects(user.id);
    return {
      projects,
      total: projects.length,
    };
  }

  /**
   * Get a single project by ID
   */
  @Get(':projectId')
  async getProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.getProjectById(projectId, user.id);
  }

  /**
   * Update a project
   */
  @Put(':projectId')
  async updateProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.updateProject(
      projectId,
      user.id,
      updateProjectDto,
    );
  }

  /**
   * Delete a project
   */
  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.projectsService.deleteProject(projectId, user.id);
  }

  // =====================================================
  // PROJECT MEMBERS ENDPOINTS
  // =====================================================

  /**
   * Get all members of a project
   */
  @Get(':projectId/members')
  async getProjectMembers(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectMemberResponseDto[]> {
    return this.projectsService.getProjectMembers(projectId, user.id);
  }

  /**
   * Add a member to a project
   */
  @Post(':projectId/members')
  @HttpCode(HttpStatus.CREATED)
  async addProjectMember(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() addMemberDto: AddProjectMemberDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectMemberResponseDto> {
    return this.projectsService.addProjectMember(
      projectId,
      user.id,
      addMemberDto,
    );
  }

  /**
   * Update a member's role
   */
  @Put(':projectId/members/:memberId')
  async updateProjectMember(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() updateMemberDto: UpdateProjectMemberDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectMemberResponseDto> {
    return this.projectsService.updateProjectMember(
      projectId,
      memberId,
      user.id,
      updateMemberDto,
    );
  }

  /**
   * Remove a member from a project
   */
  @Delete(':projectId/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeProjectMember(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.projectsService.removeProjectMember(
      projectId,
      memberId,
      user.id,
    );
  }

  // =====================================================
  // FIELD DEFINITIONS ENDPOINTS
  // =====================================================

  /**
   * Get all field definitions for a project
   */
  @Get(':projectId/fields')
  async getProjectFields(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<FieldDefinitionResponseDto[]> {
    return this.projectsService.getProjectFieldDefinitions(projectId, user.id);
  }

  /**
   * Create a field definition
   */
  @Post(':projectId/fields')
  @HttpCode(HttpStatus.CREATED)
  async createFieldDefinition(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() createFieldDto: CreateFieldDefinitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<FieldDefinitionResponseDto> {
    return this.projectsService.createFieldDefinition(
      projectId,
      user.id,
      createFieldDto,
    );
  }

  /**
   * Bulk create field definitions
   */
  @Post(':projectId/fields/bulk')
  @HttpCode(HttpStatus.CREATED)
  async bulkCreateFieldDefinitions(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() bulkDto: BulkCreateFieldDefinitionsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<FieldDefinitionResponseDto[]> {
    return this.projectsService.bulkCreateFieldDefinitions(
      projectId,
      user.id,
      bulkDto.fields,
    );
  }

  /**
   * Update a field definition
   */
  @Put(':projectId/fields/:fieldId')
  async updateFieldDefinition(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() updateFieldDto: UpdateFieldDefinitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<FieldDefinitionResponseDto> {
    return this.projectsService.updateFieldDefinition(
      projectId,
      fieldId,
      user.id,
      updateFieldDto,
    );
  }

  /**
   * Delete a field definition
   */
  @Delete(':projectId/fields/:fieldId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFieldDefinition(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.projectsService.deleteFieldDefinition(
      projectId,
      fieldId,
      user.id,
    );
  }

  // =====================================================
  // PARTICIPANTS ENDPOINTS
  // =====================================================

  /**
   * Get participants data for a project
   * Fetches data from Google Sheets and maps columns according to project_field_mappings
   */
  @Get(':projectId/participants')
  async getParticipants(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ParticipantsResponseDto> {
    return this.projectsService.getParticipantsForProject(projectId, user.id);
  }

  // =====================================================
  // FIELD MAPPING ENDPOINTS
  // =====================================================

  /**
   * Get all field mappings for a project
   */
  @Get(':projectId/mappings')
  async getMappings(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<FieldMappingResponseDto[]> {
    return this.projectsService.getProjectMappings(projectId, user.id);
  }

  /**
   * Scan headers from a Google Sheet
   * Fetches the first row (A1:Z1) and returns headers with column letters
   */
  @Post(':projectId/scan-headers')
  async scanHeaders(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() scanHeadersDto: ScanHeadersDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ScanHeadersResponseDto> {
    return this.projectsService.scanSheetHeaders(
      projectId,
      user.id,
      scanHeadersDto.spreadsheetId,
    );
  }

  /**
   * Update field mappings for a project
   * Overwrites all existing mappings with the new ones
   */
  @Put(':projectId/mappings')
  async updateMappings(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() updateMappingsDto: UpdateMappingsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<FieldMappingResponseDto[]> {
    return this.projectsService.updateProjectMappings(
      projectId,
      user.id,
      updateMappingsDto.mappings,
    );
  }
}
