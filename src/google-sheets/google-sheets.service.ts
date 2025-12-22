import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  OnModuleInit,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import { SupabaseService } from '../supabase/supabase.service';
import { ProjectsService } from '../projects/projects.service';

/**
 * Interface for project sheet configuration
 */
export interface ProjectSheetConfig {
  projectId: string;
  sheetId: string;
  sheetTitle: string;
  sheetUrl: string;
}

@Injectable()
export class GoogleSheetsService implements OnModuleInit {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private sheets: sheets_v4.Sheets | null = null;
  private isInitialized = false;
  private initializationError: string | null = null;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private projectsService: ProjectsService,
  ) {}

  async onModuleInit() {
    await this.initializeGoogleSheets();
  }

  /**
   * Inicjalizacja klienta Google Sheets API
   * Używamy OAuth2 (User Credentials) do autoryzacji
   */
  private async initializeGoogleSheets(): Promise<void> {
    // Pobierz wymagane zmienne środowiskowe OAuth2
    const clientId = this.configService.get<string>('GOOGLE_AUTH_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_AUTH_CLIENT_SECRET');
    const refreshToken = this.configService.get<string>('GOOGLE_AUTH_REFRESH_TOKEN');

    // Sprawdź minimalne wymagane zmienne
    if (!clientId || !clientSecret || !refreshToken) {
      const missingVars: string[] = [];
      if (!clientId) missingVars.push('GOOGLE_AUTH_CLIENT_ID');
      if (!clientSecret) missingVars.push('GOOGLE_AUTH_CLIENT_SECRET');
      if (!refreshToken) missingVars.push('GOOGLE_AUTH_REFRESH_TOKEN');
      
      this.initializationError = `Brakujące zmienne środowiskowe: ${missingVars.join(', ')}`;
      this.logger.error(`Google Sheets API initialization failed: ${this.initializationError}`);
      this.logger.warn('Google Sheets integration is disabled. Set the required OAuth2 environment variables to enable it.');
      return;
    }

    try {
      // Utwórz klienta OAuth2 z credentials
      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        'http://localhost', // Redirect URI dla Desktop App
      );

      // Ustaw refresh token (używany do automatycznego odświeżania access token)
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      this.sheets = google.sheets({ version: 'v4', auth: oauth2Client });
      this.isInitialized = true;
      this.initializationError = null;
      
      this.logger.log('Google Sheets API client initialized successfully with OAuth2');
      this.logger.log(`OAuth2 Client ID: ${clientId.substring(0, 20)}...`);
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
   * Zwraca informację o konfiguracji OAuth2 (do wyświetlenia użytkownikowi)
   * @deprecated Metoda zachowana dla kompatybilności wstecznej
   */
  getServiceAccountEmail(): string | null {
    // Dla OAuth2 nie mamy bezpośredniego dostępu do emaila użytkownika
    // Można by pobrać z Google API, ale to wymaga dodatkowego wywołania
    return null;
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
        const errorMsg = `Brak dostępu do arkusza. Arkusz musi być udostępniony (z uprawnieniami "Edytor") dla konta Google używanego do autoryzacji OAuth2.`;
        this.logger.error(errorMsg);
        throw new BadRequestException(errorMsg);
      }

      if (error.code === 404 || error.message?.includes('not found')) {
        throw new BadRequestException(
          'Arkusz nie został znaleziony. Sprawdź czy link jest poprawny.',
        );
      }

      if (error.code === 401 || error.message?.includes('unauthorized') || error.message?.includes('invalid_grant')) {
        this.logger.error('Authentication error - check OAuth2 credentials');
        throw new InternalServerErrorException(
          'Błąd autoryzacji z Google API. Sprawdź konfigurację OAuth2 (GOOGLE_AUTH_CLIENT_ID, GOOGLE_AUTH_CLIENT_SECRET, GOOGLE_AUTH_REFRESH_TOKEN).',
        );
      }

      throw new InternalServerErrorException(
        `Nie udało się połączyć z arkuszem Google Sheets: ${error.message}`,
      );
    }
  }

  // =====================================================
  // PROJECT-BASED CONFIGURATION METHODS
  // =====================================================

  /**
   * Zapisuje konfigurację połączenia z arkuszem dla projektu
   * Authorization is handled by backend logic (userHasAdminAccess check)
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param sheetId - ID arkusza Google Sheets
   * @param sheetTitle - tytuł arkusza
   * @param sheetUrl - oryginalny URL arkusza
   */
  async saveProjectSheetConfiguration(
    projectId: string,
    userId: string,
    sheetId: string,
    sheetTitle: string,
    sheetUrl: string,
  ): Promise<void> {
    // Wymagana rola: owner (updateSettings)
    await this.projectsService.validateProjectRole(projectId, userId, 'owner');

    // Use admin client to bypass RLS
    const supabase = this.supabaseService.getAdminClient();

    // Sprawdź czy istnieje już konfiguracja dla tego projektu
    const { data: existingConfig } = await supabase
      .from('sheet_configurations')
      .select('id')
      .eq('project_id', projectId)
      .single();

    if (existingConfig) {
      // Aktualizuj istniejącą konfigurację
      const { error } = await supabase
        .from('sheet_configurations')
        .update({
          sheet_id: sheetId,
          sheet_title: sheetTitle,
          sheet_url: sheetUrl,
          user_id: userId, // Track who last updated
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId);

      if (error) {
        this.logger.error('Failed to update project sheet configuration:', error);
        throw new InternalServerErrorException(
          'Nie udało się zaktualizować konfiguracji arkusza',
        );
      }
    } else {
      // Utwórz nową konfigurację
      const { error } = await supabase.from('sheet_configurations').insert({
        project_id: projectId,
        user_id: userId,
        sheet_id: sheetId,
        sheet_title: sheetTitle,
        sheet_url: sheetUrl,
      });

      if (error) {
        this.logger.error('Failed to save project sheet configuration:', error);
        throw new InternalServerErrorException(
          'Nie udało się zapisać konfiguracji arkusza',
        );
      }
    }

    this.logger.log(`Sheet configuration saved for project ${projectId}`);
  }

  /**
   * Pobiera konfigurację arkusza dla projektu
   * Authorization is handled by backend logic (userHasProjectAccess check)
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   */
  async getProjectSheetConfiguration(
    projectId: string,
    userId: string,
  ): Promise<ProjectSheetConfig | null> {
    // Verify user has access to project
    const hasAccess = await this.projectsService.userHasProjectAccess(projectId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    // Use admin client to bypass RLS
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('sheet_configurations')
      .select('project_id, sheet_id, sheet_title, sheet_url')
      .eq('project_id', projectId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      projectId: data.project_id,
      sheetId: data.sheet_id,
      sheetTitle: data.sheet_title,
      sheetUrl: data.sheet_url,
    };
  }

  /**
   * Pobiera konfigurację arkusza dla projektu (wersja wewnętrzna bez sprawdzania uprawnień)
   * Używane przez inne metody serwisu
   * @param projectId - ID projektu
   */
  private async getProjectSheetConfigInternal(
    projectId: string,
  ): Promise<ProjectSheetConfig | null> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('sheet_configurations')
      .select('project_id, sheet_id, sheet_title, sheet_url')
      .eq('project_id', projectId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      projectId: data.project_id,
      sheetId: data.sheet_id,
      sheetTitle: data.sheet_title,
      sheetUrl: data.sheet_url,
    };
  }

  /**
   * Usuwa konfigurację arkusza dla projektu
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   */
  async deleteProjectSheetConfiguration(
    projectId: string,
    userId: string,
  ): Promise<void> {
    // Wymagana rola: owner (updateSettings)
    await this.projectsService.validateProjectRole(projectId, userId, 'owner');

    const supabase = this.supabaseService.getClient();

    const { error } = await supabase
      .from('sheet_configurations')
      .delete()
      .eq('project_id', projectId);

    if (error) {
      this.logger.error('Failed to delete project sheet configuration:', error);
      throw new InternalServerErrorException(
        'Nie udało się usunąć konfiguracji arkusza',
      );
    }

    this.logger.log(`Sheet configuration deleted for project ${projectId}`);
  }

  // =====================================================
  // PROJECT-BASED SHEET OPERATIONS
  // =====================================================

  /**
   * Pobiera dane z arkusza dla projektu
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param range - zakres danych (np. 'Sheet1!A1:Z100')
   */
  async getProjectSheetData(
    projectId: string,
    userId: string,
    range: string,
  ): Promise<any[][]> {
    // Verify user has access to project
    const hasAccess = await this.projectsService.userHasProjectAccess(projectId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    const config = await this.getProjectSheetConfigInternal(projectId);
    if (!config) {
      throw new NotFoundException('Projekt nie ma skonfigurowanego arkusza');
    }

    return this.getSheetData(config.sheetId, range);
  }

  /**
   * Zapisuje dane do arkusza dla projektu
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param range - zakres danych
   * @param values - dane do zapisania
   */
  async updateProjectSheetData(
    projectId: string,
    userId: string,
    range: string,
    values: any[][],
  ): Promise<void> {
    // Wymagana rola: editor (syncData)
    await this.projectsService.validateProjectRole(projectId, userId, 'editor');

    const config = await this.getProjectSheetConfigInternal(projectId);
    if (!config) {
      throw new NotFoundException('Projekt nie ma skonfigurowanego arkusza');
    }

    return this.updateSheetData(config.sheetId, range, values);
  }

  /**
   * Dodaje wiersz do arkusza dla projektu
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param sheetName - nazwa zakładki
   * @param values - dane do dodania
   */
  async appendProjectRow(
    projectId: string,
    userId: string,
    sheetName: string,
    values: any[],
  ): Promise<void> {
    // Wymagana rola: editor (syncData)
    await this.projectsService.validateProjectRole(projectId, userId, 'editor');

    const config = await this.getProjectSheetConfigInternal(projectId);
    if (!config) {
      throw new NotFoundException('Projekt nie ma skonfigurowanego arkusza');
    }

    return this.appendRow(config.sheetId, sheetName, values);
  }

  // =====================================================
  // LEGACY METHODS (kept for backward compatibility)
  // These methods work with direct sheetId - consider deprecating
  // =====================================================

  /**
   * @deprecated Use saveProjectSheetConfiguration instead
   * Zapisuje konfigurację połączenia z arkuszem w bazie danych
   */
  async saveSheetConfiguration(
    userId: string,
    sheetId: string,
    sheetTitle: string,
    sheetUrl: string,
  ): Promise<void> {
    this.logger.warn('saveSheetConfiguration is deprecated. Use saveProjectSheetConfiguration instead.');
    
    const supabase = this.supabaseService.getClient();

    // Sprawdź czy istnieje już konfiguracja
    const { data: existingConfig } = await supabase
      .from('sheet_configurations')
      .select('id')
      .eq('user_id', userId)
      .is('project_id', null)
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
        .eq('user_id', userId)
        .is('project_id', null);

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
   * @deprecated Use getProjectSheetConfiguration instead
   * Pobiera zapisaną konfigurację arkusza dla użytkownika
   */
  async getSheetConfiguration(userId: string): Promise<{
    sheetId: string;
    sheetTitle: string;
    sheetUrl: string;
  } | null> {
    this.logger.warn('getSheetConfiguration is deprecated. Use getProjectSheetConfiguration instead.');
    
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('sheet_configurations')
      .select('sheet_id, sheet_title, sheet_url')
      .eq('user_id', userId)
      .is('project_id', null)
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
    if (error.code === 403) {
      throw new BadRequestException(
        `Brak uprawnień do ${action}. Upewnij się, że arkusz jest udostępniony dla konta Google używanego do autoryzacji OAuth2.`,
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

  // =====================================================
  // DOCUMENT TEMPLATE METHODS
  // =====================================================

  /**
   * Pobiera wszystkie szablony dokumentów dla projektu
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   */
  async getProjectDocumentTemplates(
    projectId: string,
    userId: string,
  ): Promise<Array<{ id: string; name: string; docId: string }>> {
    // Verify user has access to project
    const hasAccess = await this.projectsService.userHasProjectAccess(projectId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('Brak dostępu do tego projektu');
    }

    // Use admin client to bypass RLS
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('document_templates')
      .select('id, name, doc_id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to get document templates:', error);
      throw new InternalServerErrorException('Nie udało się pobrać szablonów dokumentów');
    }

    return (data || []).map((template) => ({
      id: template.id,
      name: template.name,
      docId: template.doc_id,
    }));
  }

  /**
   * Tworzy nowy szablon dokumentu dla projektu
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param name - Nazwa szablonu
   * @param docId - Google Doc ID
   */
  async createDocumentTemplate(
    projectId: string,
    userId: string,
    name: string,
    docId: string,
  ): Promise<{ id: string; name: string; docId: string }> {
    // Wymagana rola: owner (updateSettings)
    await this.projectsService.validateProjectRole(projectId, userId, 'owner');

    // Use admin client to bypass RLS
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('document_templates')
      .insert({
        project_id: projectId,
        name,
        doc_id: docId,
      })
      .select('id, name, doc_id')
      .single();

    if (error) {
      this.logger.error('Failed to create document template:', error);
      if (error.code === '23505') {
        // Unique constraint violation
        throw new BadRequestException(`Szablon o nazwie "${name}" już istnieje dla tego projektu`);
      }
      throw new InternalServerErrorException('Nie udało się utworzyć szablonu dokumentu');
    }

    this.logger.log(`Document template created for project ${projectId}: ${name}`);

    return {
      id: data.id,
      name: data.name,
      docId: data.doc_id,
    };
  }

  /**
   * Usuwa szablon dokumentu
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param templateId - ID szablonu
   */
  async deleteDocumentTemplate(
    projectId: string,
    userId: string,
    templateId: string,
  ): Promise<void> {
    // Wymagana rola: owner (updateSettings)
    await this.projectsService.validateProjectRole(projectId, userId, 'owner');

    // Use admin client to bypass RLS
    const supabase = this.supabaseService.getAdminClient();

    const { error } = await supabase
      .from('document_templates')
      .delete()
      .eq('id', templateId)
      .eq('project_id', projectId);

    if (error) {
      this.logger.error('Failed to delete document template:', error);
      throw new InternalServerErrorException('Nie udało się usunąć szablonu dokumentu');
    }

    this.logger.log(`Document template deleted: ${templateId}`);
  }
}
