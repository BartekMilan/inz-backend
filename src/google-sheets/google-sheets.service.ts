import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class GoogleSheetsService implements OnModuleInit {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private sheets: sheets_v4.Sheets | null = null;
  private isInitialized = false;
  private initializationError: string | null = null;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
  ) {}

  async onModuleInit() {
    await this.initializeGoogleSheets();
  }

  /**
   * Inicjalizacja klienta Google Sheets API
   * Używamy Service Account z JWT do autoryzacji
   */
  private async initializeGoogleSheets(): Promise<void> {
    // Pobierz wymagane zmienne środowiskowe
    const clientEmail = this.configService.get<string>('GOOGLE_CLIENT_EMAIL');
    const rawPrivateKey = this.configService.get<string>('GOOGLE_PRIVATE_KEY');

    // Sprawdź minimalne wymagane zmienne
    if (!clientEmail || !rawPrivateKey) {
      const missingVars: string[] = [];
      if (!clientEmail) missingVars.push('GOOGLE_CLIENT_EMAIL');
      if (!rawPrivateKey) missingVars.push('GOOGLE_PRIVATE_KEY');
      
      this.initializationError = `Brakujące zmienne środowiskowe: ${missingVars.join(', ')}`;
      this.logger.error(`Google Sheets API initialization failed: ${this.initializationError}`);
      this.logger.warn('Google Sheets integration is disabled. Set the required environment variables to enable it.');
      return;
    }

    try {
      // Krytyczna poprawka: zamień \\n na rzeczywiste znaki nowej linii
      // Zmienne z .env często mają błędnie interpretowane znaki nowej linii
      const privateKey = (this.configService.get('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n');

      // Utwórz klienta GoogleAuth z credentials
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      // Pobierz klienta autoryzacji
      await auth.getClient();

      this.sheets = google.sheets({ version: 'v4', auth });
      this.isInitialized = true;
      this.initializationError = null;
      
      this.logger.log('Google Sheets API client initialized successfully');
      this.logger.log(`Service Account Email: ${clientEmail}`);
    } catch (error: any) {
      this.initializationError = error.message || 'Unknown initialization error';
      this.logger.error('Failed to initialize Google Sheets API client:', error.message);
      this.logger.error('Stack trace:', error.stack);
    }
  }

  /**
   * Sprawdza czy serwis jest zainicjalizowany i gotowy do użycia
   */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.sheets) {
      const errorMessage = this.initializationError 
        ? `Google Sheets API nie jest skonfigurowane: ${this.initializationError}`
        : 'Google Sheets API nie jest zainicjalizowane';
      
      this.logger.error(errorMessage);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * Zwraca adres email Service Account (do wyświetlenia użytkownikowi)
   */
  getServiceAccountEmail(): string | null {
    return this.configService.get<string>('GOOGLE_CLIENT_EMAIL') || null;
  }

  /**
   * Wyodrębnia ID arkusza z URL-a Google Sheets
   * @param sheetUrl - pełny URL do arkusza Google Sheets
   * @returns ID arkusza
   */
  extractSheetIdFromUrl(sheetUrl: string): string {
    const regex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const match = sheetUrl.match(regex);

    if (!match || !match[1]) {
      throw new BadRequestException(
        'Nie można wyodrębnić ID arkusza z podanego URL',
      );
    }

    return match[1];
  }

  /**
   * Testuje połączenie z arkuszem Google Sheets
   * @param sheetUrl - URL arkusza do przetestowania
   * @returns informacje o arkuszu jeśli połączenie udane
   */
  async testConnection(sheetUrl: string): Promise<{
    connected: boolean;
    sheetId: string;
    title: string;
    sheetsCount: number;
    sheetNames: string[];
  }> {
    // Sprawdź czy serwis jest zainicjalizowany
    this.ensureInitialized();
    
    const sheetId = this.extractSheetIdFromUrl(sheetUrl);
    const serviceAccountEmail = this.getServiceAccountEmail();

    try {
      this.logger.log(`Testing connection to sheet: ${sheetId}`);
      
      const response = await this.sheets!.spreadsheets.get({
        spreadsheetId: sheetId,
        fields: 'properties.title,sheets.properties.title',
      });

      const title = response.data.properties?.title || 'Bez tytułu';
      const sheets = response.data.sheets || [];
      const sheetNames = sheets.map(
        (sheet) => sheet.properties?.title || 'Bez nazwy',
      );

      this.logger.log(`Successfully connected to sheet: ${title} (${sheetId})`);

      return {
        connected: true,
        sheetId,
        title,
        sheetsCount: sheets.length,
        sheetNames,
      };
    } catch (error: any) {
      // Szczegółowe logowanie błędu
      this.logger.error(`Failed to connect to sheet ${sheetId}`);
      this.logger.error(`Error code: ${error.code}`);
      this.logger.error(`Error message: ${error.message}`);
      
      if (error.response?.data) {
        this.logger.error(`API Response: ${JSON.stringify(error.response.data)}`);
      }

      // Obsługa specyficznych błędów
      if (error.code === 403 || error.message?.includes('permission')) {
        const errorMsg = `Brak dostępu do arkusza. Arkusz musi być udostępniony (z uprawnieniami "Edytor") dla adresu: ${serviceAccountEmail}`;
        this.logger.error(errorMsg);
        throw new BadRequestException(errorMsg);
      }

      if (error.code === 404 || error.message?.includes('not found')) {
        throw new BadRequestException(
          'Arkusz nie został znaleziony. Sprawdź czy link jest poprawny.',
        );
      }

      if (error.code === 401 || error.message?.includes('unauthorized') || error.message?.includes('invalid_grant')) {
        this.logger.error('Authentication error - check Service Account credentials');
        throw new InternalServerErrorException(
          'Błąd autoryzacji z Google API. Sprawdź konfigurację Service Account.',
        );
      }

      if (error.message?.includes('invalid_key') || error.message?.includes('private key')) {
        this.logger.error('Invalid private key format');
        throw new InternalServerErrorException(
          'Nieprawidłowy format klucza prywatnego. Sprawdź zmienną GOOGLE_PRIVATE_KEY.',
        );
      }

      throw new InternalServerErrorException(
        `Nie udało się połączyć z arkuszem Google Sheets: ${error.message}`,
      );
    }
  }

  /**
   * Zapisuje konfigurację połączenia z arkuszem w bazie danych
   * @param userId - ID użytkownika (administratora)
   * @param sheetId - ID arkusza Google Sheets
   * @param sheetTitle - tytuł arkusza
   * @param sheetUrl - oryginalny URL arkusza
   */
  async saveSheetConfiguration(
    userId: string,
    sheetId: string,
    sheetTitle: string,
    sheetUrl: string,
  ): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Sprawdź czy istnieje już konfiguracja
    const { data: existingConfig } = await supabase
      .from('sheet_configurations')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existingConfig) {
      // Aktualizuj istniejącą konfigurację
      const { error } = await supabase
        .from('sheet_configurations')
        .update({
          sheet_id: sheetId,
          sheet_title: sheetTitle,
          sheet_url: sheetUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (error) {
        this.logger.error('Failed to update sheet configuration:', error);
        throw new InternalServerErrorException(
          'Nie udało się zaktualizować konfiguracji arkusza',
        );
      }
    } else {
      // Utwórz nową konfigurację
      const { error } = await supabase.from('sheet_configurations').insert({
        user_id: userId,
        sheet_id: sheetId,
        sheet_title: sheetTitle,
        sheet_url: sheetUrl,
      });

      if (error) {
        this.logger.error('Failed to save sheet configuration:', error);
        throw new InternalServerErrorException(
          'Nie udało się zapisać konfiguracji arkusza',
        );
      }
    }

    this.logger.log(`Sheet configuration saved for user ${userId}`);
  }

  /**
   * Pobiera zapisaną konfigurację arkusza dla użytkownika
   * @param userId - ID użytkownika
   */
  async getSheetConfiguration(userId: string): Promise<{
    sheetId: string;
    sheetTitle: string;
    sheetUrl: string;
  } | null> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('sheet_configurations')
      .select('sheet_id, sheet_title, sheet_url')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      sheetId: data.sheet_id,
      sheetTitle: data.sheet_title,
      sheetUrl: data.sheet_url,
    };
  }

  /**
   * Pobiera dane z określonego zakresu arkusza
   * @param sheetId - ID arkusza
   * @param range - zakres danych (np. 'Sheet1!A1:Z100')
   */
  async getSheetData(sheetId: string, range: string): Promise<any[][]> {
    this.ensureInitialized();
    
    try {
      const response = await this.sheets!.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range,
      });

      return response.data.values || [];
    } catch (error: any) {
      this.logger.error(`Failed to get sheet data from ${sheetId}:`, error.message);
      this.handleSheetError(error, 'pobrać danych z arkusza');
      throw new InternalServerErrorException('Nie udało się pobrać danych z arkusza');
    }
  }

  /**
   * Zapisuje dane do określonego zakresu arkusza
   * @param sheetId - ID arkusza
   * @param range - zakres danych (np. 'Sheet1!A1')
   * @param values - dane do zapisania
   */
  async updateSheetData(
    sheetId: string,
    range: string,
    values: any[][],
  ): Promise<void> {
    this.ensureInitialized();
    
    try {
      await this.sheets!.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values,
        },
      });

      this.logger.log(`Data updated in sheet ${sheetId} at range ${range}`);
    } catch (error: any) {
      this.logger.error(`Failed to update sheet data:`, error.message);
      this.handleSheetError(error, 'zapisać danych do arkusza');
      throw new InternalServerErrorException('Nie udało się zapisać danych do arkusza');
    }
  }

  /**
   * Dodaje nowy wiersz na końcu arkusza
   * @param sheetId - ID arkusza
   * @param sheetName - nazwa zakładki
   * @param values - dane do dodania (jeden wiersz)
   */
  async appendRow(
    sheetId: string,
    sheetName: string,
    values: any[],
  ): Promise<void> {
    this.ensureInitialized();
    
    try {
      await this.sheets!.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [values],
        },
      });

      this.logger.log(`Row appended to sheet ${sheetId}`);
    } catch (error: any) {
      this.logger.error(`Failed to append row:`, error.message);
      this.handleSheetError(error, 'dodać wiersza do arkusza');
      throw new InternalServerErrorException('Nie udało się dodać wiersza do arkusza');
    }
  }

  /**
   * Wspólna obsługa błędów Google Sheets API
   */
  private handleSheetError(error: any, action: string): never {
    const serviceAccountEmail = this.getServiceAccountEmail();
    
    if (error.code === 403) {
      throw new BadRequestException(
        `Brak uprawnień do ${action}. Upewnij się, że arkusz jest udostępniony dla: ${serviceAccountEmail}`,
      );
    }

    if (error.code === 404) {
      throw new BadRequestException('Arkusz nie został znaleziony.');
    }

    if (error.code === 401) {
      throw new InternalServerErrorException('Błąd autoryzacji z Google API.');
    }

    throw new InternalServerErrorException(`Nie udało się ${action}: ${error.message}`);
  }
}
