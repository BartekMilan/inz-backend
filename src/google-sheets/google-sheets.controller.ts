import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { GoogleSheetsService } from './google-sheets.service';
import {
  ConnectSheetDto,
  SheetConnectionResponseDto,
  TestConnectionResponseDto,
  ProjectSheetConfigurationResponseDto,
  CreateDocumentTemplateDto,
  DocumentTemplateResponseDto,
} from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { RequestUser } from '../common/guards/auth.guard';

@Controller('google-sheets')
export class GoogleSheetsController {
  constructor(private readonly googleSheetsService: GoogleSheetsService) {}

  /**
   * Pobiera informacje o konfiguracji OAuth2 (do wyświetlenia użytkownikowi)
   * Dostępne tylko dla administratorów
   */
  @Get('service-account')
  @Roles(Role.ADMIN)
  getServiceAccountInfo(): { 
    configured: boolean; 
    email: string | null;
    message: string;
  } {
    // Dla OAuth2 nie mamy bezpośredniego dostępu do emaila użytkownika
    // Sprawdzamy czy serwis jest zainicjalizowany (czy są ustawione zmienne OAuth2)
    const isConfigured = this.googleSheetsService['isInitialized'] || false;
    
    if (!isConfigured) {
      return {
        configured: false,
        email: null,
        message: 'Google Sheets API nie jest skonfigurowane. Ustaw zmienne GOOGLE_AUTH_CLIENT_ID, GOOGLE_AUTH_CLIENT_SECRET i GOOGLE_AUTH_REFRESH_TOKEN w pliku .env',
      };
    }

    return {
      configured: true,
      email: null, // Dla OAuth2 email nie jest dostępny bez dodatkowego wywołania API
      message: 'Google Sheets API jest skonfigurowane z OAuth2. Udostępnij arkusz dla konta Google używanego do autoryzacji.',
    };
  }

  /**
   * Testuje połączenie z arkuszem Google Sheets bez zapisywania
   * Dostępne dla wszystkich zalogowanych użytkowników
   */
  @Post('test-connection')
  @HttpCode(HttpStatus.OK)
  async testConnection(
    @Body() connectSheetDto: ConnectSheetDto,
  ): Promise<TestConnectionResponseDto> {
    const result = await this.googleSheetsService.testConnection(
      connectSheetDto.sheetUrl,
    );

    return {
      connected: result.connected,
      message: 'Połączenie z arkuszem zostało nawiązane pomyślnie',
      sheetInfo: {
        sheetId: result.sheetId,
        title: result.title,
        sheetsCount: result.sheetsCount,
        sheetNames: result.sheetNames,
      },
    };
  }

  // =====================================================
  // PROJECT-BASED ENDPOINTS
  // =====================================================

  /**
   * Podłącza arkusz Google Sheets do projektu
   * Zapisuje konfigurację w bazie danych
   * Dostępne tylko dla administratorów projektu
   */
  @Post('projects/:projectId/connect')
  @HttpCode(HttpStatus.OK)
  async connectProjectSheet(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() connectSheetDto: ConnectSheetDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SheetConnectionResponseDto> {
    // Najpierw testujemy połączenie
    const connectionResult = await this.googleSheetsService.testConnection(
      connectSheetDto.sheetUrl,
    );

    // Zapisujemy konfigurację dla projektu
    await this.googleSheetsService.saveProjectSheetConfiguration(
      projectId,
      user.id,
      connectionResult.sheetId,
      connectionResult.title,
      connectSheetDto.sheetUrl,
    );

    return {
      success: true,
      message: 'Arkusz został pomyślnie podłączony do projektu',
      projectId,
      sheetId: connectionResult.sheetId,
      sheetTitle: connectionResult.title,
      sheetsCount: connectionResult.sheetsCount,
      sheetNames: connectionResult.sheetNames,
    };
  }

  /**
   * Pobiera konfigurację arkusza dla projektu
   */
  @Get('projects/:projectId/configuration')
  async getProjectConfiguration(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectSheetConfigurationResponseDto> {
    const config = await this.googleSheetsService.getProjectSheetConfiguration(
      projectId,
      user.id,
    );

    if (!config) {
      return {
        configured: false,
        projectId,
      };
    }

    // Testujemy czy połączenie nadal działa
    try {
      const connectionTest = await this.googleSheetsService.testConnection(
        config.sheetUrl,
      );

      return {
        configured: true,
        projectId,
        config: {
          sheetId: config.sheetId,
          sheetTitle: config.sheetTitle,
          sheetUrl: config.sheetUrl,
          connected: connectionTest.connected,
          sheetsCount: connectionTest.sheetsCount,
          sheetNames: connectionTest.sheetNames,
        },
      };
    } catch {
      // Połączenie nie działa, ale konfiguracja istnieje
      return {
        configured: true,
        projectId,
        config: {
          sheetId: config.sheetId,
          sheetTitle: config.sheetTitle,
          sheetUrl: config.sheetUrl,
          connected: false,
          error: 'Nie można nawiązać połączenia z arkuszem',
        },
      };
    }
  }

  /**
   * Sprawdza status połączenia z arkuszem projektu
   */
  @Get('projects/:projectId/status')
  async getProjectConnectionStatus(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ connected: boolean; message: string; projectId: string }> {
    const config = await this.googleSheetsService.getProjectSheetConfiguration(
      projectId,
      user.id,
    );

    if (!config) {
      return {
        connected: false,
        message: 'Brak skonfigurowanego arkusza dla tego projektu',
        projectId,
      };
    }

    try {
      await this.googleSheetsService.testConnection(config.sheetUrl);
      return {
        connected: true,
        message: 'Połączenie z arkuszem jest aktywne',
        projectId,
      };
    } catch {
      return {
        connected: false,
        message: 'Nie można nawiązać połączenia z arkuszem',
        projectId,
      };
    }
  }

  /**
   * Usuwa konfigurację arkusza dla projektu
   */
  @Delete('projects/:projectId/configuration')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProjectConfiguration(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.googleSheetsService.deleteProjectSheetConfiguration(
      projectId,
      user.id,
    );
  }

  /**
   * Pobiera dane z arkusza projektu
   */
  @Post('projects/:projectId/data')
  @HttpCode(HttpStatus.OK)
  async getProjectSheetData(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { range: string },
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: any[][] }> {
    const data = await this.googleSheetsService.getProjectSheetData(
      projectId,
      user.id,
      body.range,
    );

    return { data };
  }

  /**
   * Aktualizuje dane w arkuszu projektu
   */
  @Post('projects/:projectId/data/update')
  @HttpCode(HttpStatus.OK)
  async updateProjectSheetData(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { range: string; values: any[][] },
    @CurrentUser() user: RequestUser,
  ): Promise<{ success: boolean; message: string }> {
    await this.googleSheetsService.updateProjectSheetData(
      projectId,
      user.id,
      body.range,
      body.values,
    );

    return {
      success: true,
      message: 'Dane zostały zaktualizowane',
    };
  }

  /**
   * Dodaje wiersz do arkusza projektu
   */
  @Post('projects/:projectId/data/append')
  @HttpCode(HttpStatus.CREATED)
  async appendProjectRow(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { sheetName: string; values: any[] },
    @CurrentUser() user: RequestUser,
  ): Promise<{ success: boolean; message: string }> {
    await this.googleSheetsService.appendProjectRow(
      projectId,
      user.id,
      body.sheetName,
      body.values,
    );

    return {
      success: true,
      message: 'Wiersz został dodany',
    };
  }

  // =====================================================
  // DOCUMENT TEMPLATE ENDPOINTS
  // =====================================================

  /**
   * Pobiera wszystkie szablony dokumentów dla projektu
   */
  @Get('projects/:projectId/templates')
  async getProjectTemplates(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DocumentTemplateResponseDto[]> {
    const templates = await this.googleSheetsService.getProjectDocumentTemplates(
      projectId,
      user.id,
    );

    return templates.map((template) => ({
      id: template.id,
      projectId,
      name: template.name,
      docId: template.docId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  /**
   * Tworzy nowy szablon dokumentu dla projektu
   */
  @Post('projects/:projectId/templates')
  @HttpCode(HttpStatus.CREATED)
  async createProjectTemplate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() createTemplateDto: CreateDocumentTemplateDto,
    @CurrentUser() user: RequestUser,
  ): Promise<DocumentTemplateResponseDto> {
    const template = await this.googleSheetsService.createDocumentTemplate(
      projectId,
      user.id,
      createTemplateDto.name,
      createTemplateDto.docId,
    );

    return {
      id: template.id,
      projectId,
      name: template.name,
      docId: template.docId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Usuwa szablon dokumentu
   */
  @Delete('projects/:projectId/templates/:templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProjectTemplate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.googleSheetsService.deleteDocumentTemplate(
      projectId,
      user.id,
      templateId,
    );
  }

  // =====================================================
  // LEGACY ENDPOINTS (kept for backward compatibility)
  // Consider deprecating these in future versions
  // =====================================================

  /**
   * @deprecated Use POST /projects/:projectId/connect instead
   * Podłącza arkusz Google Sheets do aplikacji
   * Zapisuje konfigurację w bazie danych
   * Dostępne tylko dla administratorów
   */
  @Post('connect')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async connectSheet(
    @Body() connectSheetDto: ConnectSheetDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SheetConnectionResponseDto> {
    // Najpierw testujemy połączenie
    const connectionResult = await this.googleSheetsService.testConnection(
      connectSheetDto.sheetUrl,
    );

    // Zapisujemy konfigurację (legacy - per user)
    await this.googleSheetsService.saveSheetConfiguration(
      user.id,
      connectionResult.sheetId,
      connectionResult.title,
      connectSheetDto.sheetUrl,
    );

    return {
      success: true,
      message: 'Arkusz został pomyślnie podłączony do aplikacji',
      sheetId: connectionResult.sheetId,
      sheetTitle: connectionResult.title,
      sheetsCount: connectionResult.sheetsCount,
      sheetNames: connectionResult.sheetNames,
    };
  }

  /**
   * @deprecated Use GET /projects/:projectId/configuration instead
   * Pobiera aktualną konfigurację połączonego arkusza
   * Dostępne dla wszystkich zalogowanych użytkowników
   */
  @Get('configuration')
  async getConfiguration(
    @CurrentUser() user: RequestUser,
  ): Promise<{ configured: boolean; config?: any }> {
    const config = await this.googleSheetsService.getSheetConfiguration(
      user.id,
    );

    if (!config) {
      return {
        configured: false,
      };
    }

    // Testujemy czy połączenie nadal działa
    try {
      const connectionTest = await this.googleSheetsService.testConnection(
        config.sheetUrl,
      );

      return {
        configured: true,
        config: {
          sheetId: config.sheetId,
          sheetTitle: config.sheetTitle,
          sheetUrl: config.sheetUrl,
          connected: connectionTest.connected,
          sheetsCount: connectionTest.sheetsCount,
          sheetNames: connectionTest.sheetNames,
        },
      };
    } catch {
      // Połączenie nie działa, ale konfiguracja istnieje
      return {
        configured: true,
        config: {
          sheetId: config.sheetId,
          sheetTitle: config.sheetTitle,
          sheetUrl: config.sheetUrl,
          connected: false,
          error: 'Nie można nawiązać połączenia z arkuszem',
        },
      };
    }
  }

  /**
   * @deprecated Use GET /projects/:projectId/status instead
   * Sprawdza status połączenia z aktualnie skonfigurowanym arkuszem
   */
  @Get('status')
  async getConnectionStatus(
    @CurrentUser() user: RequestUser,
  ): Promise<{ connected: boolean; message: string }> {
    const config = await this.googleSheetsService.getSheetConfiguration(
      user.id,
    );

    if (!config) {
      return {
        connected: false,
        message: 'Brak skonfigurowanego arkusza',
      };
    }

    try {
      await this.googleSheetsService.testConnection(config.sheetUrl);
      return {
        connected: true,
        message: 'Połączenie z arkuszem jest aktywne',
      };
    } catch {
      return {
        connected: false,
        message: 'Nie można nawiązać połączenia z arkuszem',
      };
    }
  }
}
