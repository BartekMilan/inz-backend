import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { GoogleSheetsService } from './google-sheets.service';
import {
  ConnectSheetDto,
  SheetConnectionResponseDto,
  TestConnectionResponseDto,
} from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { RequestUser } from '../common/guards/auth.guard';

@Controller('google-sheets')
export class GoogleSheetsController {
  constructor(private readonly googleSheetsService: GoogleSheetsService) {}

  /**
   * Pobiera informacje o Service Account (do wyświetlenia użytkownikowi)
   * Dostępne tylko dla administratorów
   */
  @Get('service-account')
  @Roles(Role.ADMIN)
  getServiceAccountInfo(): { 
    configured: boolean; 
    email: string | null;
    message: string;
  } {
    const email = this.googleSheetsService.getServiceAccountEmail();
    
    if (!email) {
      return {
        configured: false,
        email: null,
        message: 'Google Sheets API nie jest skonfigurowane. Ustaw zmienne GOOGLE_CLIENT_EMAIL i GOOGLE_PRIVATE_KEY w pliku .env',
      };
    }

    return {
      configured: true,
      email,
      message: `Udostępnij arkusz dla adresu: ${email}`,
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

  /**
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

    // Zapisujemy konfigurację
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
