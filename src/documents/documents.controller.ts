import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  Res,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import {
  GenerateDocumentDto,
  SetTemplateMappingsDto,
  TemplateMappingResponseDto,
  CreateDocumentTaskDto,
  CreateDocumentTaskResponseDto,
  DocumentTaskListItemDto,
  DocumentTaskDetailDto,
} from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { RequestUser } from '../common/guards/auth.guard';

@Controller('projects/:projectId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Generuje pojedynczy PDF dla uczestnika
   * Endpoint: POST /projects/:projectId/documents/generate
   * Dostępne dla ról: admin i registrar
   */
  @Post('generate')
  @Roles(Role.ADMIN, Role.REGISTRAR)
  async generateDocument(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() generateDto: GenerateDocumentDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ): Promise<void> {
    // Generuj PDF
    const { buffer: pdfBuffer, fileName } =
      await this.documentsService.generateParticipantPdf(
        projectId,
        user.id,
        generateDto,
      );

    // Ustaw nagłówki HTTP
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length.toString());

    // Wyślij PDF
    res.status(HttpStatus.OK).send(pdfBuffer);
  }

  /**
   * Pobiera mapowania placeholderów dla szablonu
   * Endpoint: GET /projects/:projectId/templates/:templateId/mappings
   * Dostępne tylko dla: admin
   */
  @Get('templates/:templateId/mappings')
  @Roles(Role.ADMIN)
  async getTemplateMappings(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<TemplateMappingResponseDto[]> {
    return this.documentsService.getTemplateMappings(
      projectId,
      templateId,
      user.id,
    );
  }

  /**
   * Ustawia mapowania placeholderów dla szablonu (nadpisuje wszystkie)
   * Endpoint: PUT /projects/:projectId/templates/:templateId/mappings
   * Dostępne tylko dla: admin
   */
  @Put('templates/:templateId/mappings')
  @Roles(Role.ADMIN)
  async setTemplateMappings(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() setMappingsDto: SetTemplateMappingsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<TemplateMappingResponseDto[]> {
    return this.documentsService.setTemplateMappings(
      projectId,
      templateId,
      user.id,
      setMappingsDto,
    );
  }

  // =====================================================
  // DOCUMENT GENERATION TASKS
  // =====================================================

  /**
   * Tworzy nowy task generowania dokumentów
   * Endpoint: POST /projects/:projectId/documents/tasks
   * Dostępne dla ról: admin i registrar
   */
  @Post('tasks')
  @Roles(Role.ADMIN, Role.REGISTRAR)
  async createDocumentTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() createTaskDto: CreateDocumentTaskDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDocumentTaskResponseDto> {
    return this.documentsService.createDocumentTask(
      projectId,
      user.id,
      createTaskDto,
    );
  }

  /**
   * Pobiera listę tasków dla projektu
   * Endpoint: GET /projects/:projectId/documents/tasks
   * Dostępne dla ról: admin i registrar
   */
  @Get('tasks')
  @Roles(Role.ADMIN, Role.REGISTRAR)
  async getDocumentTasks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DocumentTaskListItemDto[]> {
    return this.documentsService.getDocumentTasks(projectId, user.id);
  }

  /**
   * Pobiera szczegóły taska
   * Endpoint: GET /projects/:projectId/documents/tasks/:taskId
   * Dostępne dla ról: admin i registrar
   */
  @Get('tasks/:taskId')
  @Roles(Role.ADMIN, Role.REGISTRAR)
  async getDocumentTaskById(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DocumentTaskDetailDto> {
    return this.documentsService.getDocumentTaskById(
      projectId,
      taskId,
      user.id,
    );
  }
}

