import {
  Injectable,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { google, drive_v3, docs_v1 } from 'googleapis';

@Injectable()
export class GoogleDocsService implements OnModuleInit {
  private readonly logger = new Logger(GoogleDocsService.name);
  private drive: drive_v3.Drive | null = null;
  private docs: docs_v1.Docs | null = null;
  private isInitialized = false;
  private initializationError: string | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeGoogleDocs();
  }

  /**
   * Inicjalizacja klientów Google Drive API i Google Docs API
   * Używamy OAuth2 (User Credentials) do autoryzacji
   */
  private async initializeGoogleDocs(): Promise<void> {
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
      this.logger.error(
        `Google Docs API initialization failed: ${this.initializationError}`,
      );
      this.logger.warn(
        'Google Docs integration is disabled. Set the required OAuth2 environment variables to enable it.',
      );
      return;
    }

    try {
      // Scope'y dla Google Drive i Docs API
      // Drive: pełny dostęp do kopiowania i eksportu plików
      // TODO: W przyszłości można zawęzić do konkretnych folderów używając:
      // - https://www.googleapis.com/auth/drive.file (tylko pliki utworzone przez aplikację)
      // - lub ograniczyć dostęp do konkretnego folderu w Google Drive
      // Docs: dostęp do edycji dokumentów
      const scopes = [
        'https://www.googleapis.com/auth/drive', // Pełny dostęp do Drive (kopiowanie, eksport)
        'https://www.googleapis.com/auth/documents', // Edycja dokumentów Google Docs
      ];

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

      // Inicjalizuj klientów Drive i Docs API z OAuth2
      this.drive = google.drive({ version: 'v3', auth: oauth2Client });
      this.docs = google.docs({ version: 'v1', auth: oauth2Client });
      this.isInitialized = true;
      this.initializationError = null;

      this.logger.log('Google Docs API clients initialized successfully with OAuth2');
      this.logger.log(`OAuth2 Client ID: ${clientId.substring(0, 20)}...`);
    } catch (error: any) {
      this.initializationError = error.message || 'Unknown initialization error';
      this.logger.error(
        'Failed to initialize Google Docs API clients:',
        error.message,
      );
      this.logger.error('Stack trace:', error.stack);
    }
  }

  /**
   * Sprawdza czy serwis jest zainicjalizowany i gotowy do użycia
   */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.drive || !this.docs) {
      const errorMessage = this.initializationError
        ? `Google Docs API nie jest skonfigurowane: ${this.initializationError}`
        : 'Google Docs API nie jest zainicjalizowane';

      this.logger.error(errorMessage);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableDriveError(error: any): boolean {
    const status =
      error?.code ??
      error?.response?.status ??
      error?.response?.statusCode ??
      error?.status;

    // Klasyczne transienty + rate limit
    if ([429, 500, 502, 503, 504].includes(Number(status))) {
      return true;
    }

    // Google API często zwraca 403 przy limitach w detalach błędu
    const reason =
      error?.response?.data?.error?.errors?.[0]?.reason ||
      error?.errors?.[0]?.reason;

    if (
      reason &&
      [
        'rateLimitExceeded',
        'userRateLimitExceeded',
        'dailyLimitExceeded',
        'backendError',
      ].includes(String(reason))
    ) {
      return true;
    }

    return false;
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    maxAttempts = 6,
    baseDelayMs = 500,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const retryable = this.isRetryableDriveError(error);
        const status =
          error?.code ??
          error?.response?.status ??
          error?.response?.statusCode ??
          error?.status;

        if (!retryable || attempt === maxAttempts) {
          this.logger.warn(
            `${context} - próba ${attempt}/${maxAttempts} nieudana (status=${status}). Nie ponawiam: ${error?.message}`,
          );
          throw error;
        }

        const delayMs = Math.round(baseDelayMs * Math.pow(2, attempt - 1));
        this.logger.warn(
          `${context} - próba ${attempt}/${maxAttempts} nieudana (status=${status}). Ponawiam za ${delayMs}ms: ${error?.message}`,
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private formatBytes(bytes: bigint): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(bytes);
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
  }

  /**
   * Tworzy kopię dokumentu Google Docs w Drive
   * @param templateDocId - ID dokumentu szablonu do skopiowania
   * @param name - Nazwa nowego dokumentu
   * @param folderId - Opcjonalny ID folderu w Drive (jeśli podany, kopia zostanie umieszczona w tym folderze)
   * @returns ID skopiowanego pliku
   */
  async copyTemplateDoc(
    templateDocId: string,
    name: string,
    folderId?: string,
  ): Promise<{ fileId: string }> {
    this.ensureInitialized();

    try {
      this.logger.log(
        `Copying template document ${templateDocId} as "${name}"${folderId ? ` (folder: ${folderId})` : ''}`,
      );

      const requestBody: drive_v3.Schema$File = {
        name,
      };

      // Jeśli podano folderId, ustaw parents
      if (folderId) {
        requestBody.parents = [folderId];
      }

      const response = await this.drive!.files.copy({
        fileId: templateDocId,
        requestBody,
      });

      const fileId = response.data.id;
      if (!fileId) {
        throw new InternalServerErrorException(
          'Nie udało się skopiować dokumentu - brak ID pliku w odpowiedzi',
        );
      }

      this.logger.log(`Document copied successfully: ${fileId}`);
      return { fileId };
    } catch (error: any) {
      this.logger.error(
        `Failed to copy template document ${templateDocId}:`,
        error.message,
      );

      if (error.code === 403 || error.message?.includes('permission')) {
        throw new InternalServerErrorException(
          `Brak uprawnień do skopiowania dokumentu. Dokument musi być udostępniony (z uprawnieniami "Edytor") dla konta Google używanego do autoryzacji OAuth2.`,
        );
      }

      if (error.code === 404 || error.message?.includes('not found')) {
        throw new InternalServerErrorException(
          'Dokument szablonu nie został znaleziony.',
        );
      }

      throw new InternalServerErrorException(
        `Nie udało się skopiować dokumentu: ${error.message}`,
      );
    }
  }

  /**
   * Zamienia placeholdery w dokumencie Google Docs
   * Placeholdery powinny być w formacie {{key}} (np. {{first_name}})
   * @param docId - ID dokumentu do edycji
   * @param replacements - Obiekt z mapowaniem placeholder -> wartość
   */
  async replacePlaceholders(
    docId: string,
    replacements: Record<string, string>,
  ): Promise<void> {
    this.ensureInitialized();

    try {
      this.logger.log(
        `Replacing placeholders in document ${docId}: ${Object.keys(replacements).join(', ')}`,
      );

      // Pobierz dokument, żeby znaleźć wszystkie wystąpienia placeholderów
      const document = await this.docs!.documents.get({
        documentId: docId,
      });

      // Przygotuj requesty do batchUpdate
      const requests: docs_v1.Schema$Request[] = [];

      // Dla każdego placeholder'a wykonaj replaceAllText
      for (const [key, value] of Object.entries(replacements)) {
        // Format placeholder'a: {{key}}
        const findText = `{{${key}}}`;
        const replaceText = value;

        requests.push({
          replaceAllText: {
            containsText: {
              text: findText,
              matchCase: false, // Case-insensitive matching
            },
            replaceText: replaceText,
          },
        });
      }

      if (requests.length === 0) {
        this.logger.warn('No replacements to perform');
        return;
      }

      // Wykonaj batch update
      await this.docs!.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests,
        },
      });

      this.logger.log(
        `Successfully replaced ${requests.length} placeholder(s) in document ${docId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to replace placeholders in document ${docId}:`,
        error.message,
      );

      if (error.code === 403 || error.message?.includes('permission')) {
        throw new InternalServerErrorException(
          `Brak uprawnień do edycji dokumentu. Dokument musi być udostępniony (z uprawnieniami "Edytor") dla konta Google używanego do autoryzacji OAuth2.`,
        );
      }

      if (error.code === 404 || error.message?.includes('not found')) {
        throw new InternalServerErrorException('Dokument nie został znaleziony.');
      }

      throw new InternalServerErrorException(
        `Nie udało się zamienić placeholderów: ${error.message}`,
      );
    }
  }

  /**
   * Eksportuje dokument Google Docs do formatu PDF
   * @param fileId - ID pliku do eksportu
   * @returns Buffer z zawartością PDF
   */
  async exportPdf(fileId: string): Promise<Buffer> {
    this.ensureInitialized();

    try {
      this.logger.log(`Exporting document ${fileId} to PDF`);

      const response = await this.drive!.files.export(
        {
          fileId,
          mimeType: 'application/pdf',
        },
        {
          responseType: 'arraybuffer',
        },
      );

      const buffer = Buffer.from(response.data as ArrayBuffer);
      this.logger.log(`Document ${fileId} exported to PDF (${buffer.length} bytes)`);
      return buffer;
    } catch (error: any) {
      this.logger.error(`Failed to export document ${fileId} to PDF:`, error.message);

      if (error.code === 403 || error.message?.includes('permission')) {
        throw new InternalServerErrorException(
          `Brak uprawnień do eksportu dokumentu. Dokument musi być udostępniony (z uprawnieniami "Wyświetlanie" lub wyżej) dla konta Google używanego do autoryzacji OAuth2.`,
        );
      }

      if (error.code === 404 || error.message?.includes('not found')) {
        throw new InternalServerErrorException('Dokument nie został znaleziony.');
      }

      // Sprawdź czy plik jest dokumentem Google Docs (nie można eksportować innych typów)
      if (
        error.message?.includes('export') ||
        error.message?.includes('unsupported')
      ) {
        throw new InternalServerErrorException(
          'Nie można wyeksportować tego pliku do PDF. Upewnij się, że jest to dokument Google Docs.',
        );
      }

      throw new InternalServerErrorException(
        `Nie udało się wyeksportować dokumentu do PDF: ${error.message}`,
      );
    }
  }

  /**
   * Wrzuca plik PDF do Google Drive
   * @param pdfBuffer - Buffer z zawartością PDF
   * @param name - Nazwa pliku
   * @param folderId - Opcjonalny ID folderu w Drive (jeśli podany, plik zostanie umieszczony w tym folderze)
   * @returns ID utworzonego pliku w Drive
   */
  async uploadPdfToDrive(
    pdfBuffer: Buffer,
    name: string,
    folderId?: string,
  ): Promise<{ fileId: string }> {
    this.ensureInitialized();

    try {
      this.logger.log(`Uploading PDF "${name}" to Google Drive${folderId ? ` (folder: ${folderId})` : ''}`);

      const requestBody: drive_v3.Schema$File = {
        name,
        mimeType: 'application/pdf',
      };

      // Jeśli podano folderId, ustaw parents
      if (folderId) {
        requestBody.parents = [folderId];
      }

      // Konwertuj Buffer na Readable stream (wymagane przez googleapis)
      const pdfStream = Readable.from(pdfBuffer);

      const response = await this.drive!.files.create({
        requestBody,
        media: {
          mimeType: 'application/pdf',
          body: pdfStream,
        },
      });

      const fileId = response.data.id;
      if (!fileId) {
        throw new InternalServerErrorException(
          'Nie udało się wrzucić PDF do Drive - brak ID pliku w odpowiedzi',
        );
      }

      this.logger.log(`PDF uploaded successfully to Drive: ${fileId}`);
      return { fileId };
    } catch (error: any) {
      this.logger.error(`Failed to upload PDF "${name}" to Drive:`, error.message);

      if (error.code === 403 || error.message?.includes('permission')) {
        throw new InternalServerErrorException(
          `Brak uprawnień do wrzucenia pliku do Drive. Konto Google użyte do autoryzacji OAuth2 musi mieć uprawnienia do zapisu w folderze.`,
        );
      }

      if (error.code === 404 || error.message?.includes('not found')) {
        throw new InternalServerErrorException(
          'Folder nie został znaleziony w Drive.',
        );
      }

      throw new InternalServerErrorException(
        `Nie udało się wrzucić PDF do Drive: ${error.message}`,
      );
    }
  }

  /**
   * Maintenance: czyści Google Drive zalogowanego użytkownika (opróżnia kosz i usuwa WSZYSTKIE pliki, których właścicielem jest użytkownik OAuth2)
   *
   * Uwaga: To jest operacja destrukcyjna. Usunie również pliki wynikowe (np. wygenerowane PDF-y),
   * jeśli są własnością konta Google używanego do autoryzacji OAuth2.
   */
  async cleanupServiceAccountDrive(): Promise<{
    trashedEmptied: boolean;
    totalFilesFound: number;
    deleted: number;
    failed: number;
    estimatedBytesFound: string;
    estimatedBytesFreed: string;
    unknownSizeCount: number;
    durationMs: number;
  }> {
    this.ensureInitialized();

    const startedAt = Date.now();

    this.logger.warn(
      `[MAINTENANCE] Start cleanup Drive dla zalogowanego użytkownika OAuth2`,
    );

    // 1) Opróżnij kosz
    let trashedEmptied = false;
    try {
      await this.withRetry(
        async () => this.drive!.files.emptyTrash({}),
        '[MAINTENANCE] drive.files.emptyTrash',
      );
      trashedEmptied = true;
      this.logger.log('[MAINTENANCE] Kosz opróżniony (emptyTrash)');
    } catch (error: any) {
      this.logger.warn(
        `[MAINTENANCE] Nie udało się opróżnić kosza: ${error?.message}`,
      );
      // Lecimy dalej - i tak spróbujemy skasować pliki trwale
    }

    // 2) Pobrać listę WSZYSTKICH plików owned by SA (paginacja)
    const filesToDelete: Array<{
      id: string;
      name?: string | null;
      mimeType?: string | null;
      sizeBytes: bigint;
      sizeKnown: boolean;
    }> = [];

    let pageToken: string | undefined;
    let pageIndex = 0;

    // Drive API: rozmiar jest stringiem; dla Google Docs często brak size → traktujemy jako unknown (0 do estymacji)
    let estimatedTotalBytes = 0n;
    let unknownSizeCount = 0;

    // Celowo bez filtra trashed=false: chcemy znaleźć również pliki w koszu,
    // bo one nadal potrafią zajmować quota (usageInTrash).
    const q = "'me' in owners";

    do {
      pageIndex++;
      const response = await this.withRetry(
        async () =>
          this.drive!.files.list({
            q,
            pageSize: 1000,
            pageToken,
            corpora: 'user',
            // Uwzględnij też appDataFolder - czasem "niewidzialne" pliki potrafią trzymać quota
            spaces: 'drive,appDataFolder',
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            fields: 'nextPageToken, files(id,name,mimeType,size,trashed)',
          }),
        `[MAINTENANCE] drive.files.list page=${pageIndex}`,
      );

      const files = response.data.files || [];

      for (const f of files) {
        if (!f.id) {
          continue;
        }

        const rawSize = f.size;
        let sizeBytes = 0n;
        let sizeKnown = false;
        if (rawSize !== undefined && rawSize !== null) {
          try {
            sizeBytes = BigInt(rawSize);
            sizeKnown = true;
          } catch {
            sizeBytes = 0n;
            sizeKnown = false;
          }
        }

        if (sizeKnown) {
          estimatedTotalBytes += sizeBytes;
        } else {
          unknownSizeCount++;
        }

        filesToDelete.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes,
          sizeKnown,
        });
      }

      pageToken = response.data.nextPageToken || undefined;

      this.logger.log(
        `[MAINTENANCE] Zebrano plików: ${filesToDelete.length} (strona ${pageIndex}${pageToken ? ', jest nextPageToken' : ''})`,
      );
    } while (pageToken);

    this.logger.warn(
      `[MAINTENANCE] Łącznie znaleziono ${filesToDelete.length} plików owned by SA (q=${q}). Szacowany rozmiar (tylko pliki z polem size): ${this.formatBytes(estimatedTotalBytes)}. Unknown size: ${unknownSizeCount}`,
    );

    // 3) Iteruj i trwale usuwaj (delete = hard delete, omija kosz)
    let deleted = 0;
    let failed = 0;
    let estimatedFreedBytes = 0n;

    for (let i = 0; i < filesToDelete.length; i++) {
      const file = filesToDelete[i];
      const ordinal = i + 1;

      try {
        await this.withRetry(
          async () =>
            this.drive!.files.delete({
              fileId: file.id,
              supportsAllDrives: true,
            }),
          `[MAINTENANCE] drive.files.delete (${ordinal}/${filesToDelete.length}) fileId=${file.id}`,
        );

        deleted++;
        if (file.sizeKnown) {
          estimatedFreedBytes += file.sizeBytes;
        }
      } catch (error: any) {
        const status =
          error?.code ??
          error?.response?.status ??
          error?.response?.statusCode ??
          error?.status;

        // 404 traktujemy jako "już usunięte"
        if (Number(status) === 404) {
          deleted++;
        } else {
          failed++;
          this.logger.warn(
            `[MAINTENANCE] Nie udało się usunąć fileId=${file.id} name="${file.name ?? ''}": ${error?.message}`,
          );
        }
      }

      if (ordinal % 50 === 0 || ordinal === filesToDelete.length) {
        this.logger.log(
          `[MAINTENANCE] Postęp usuwania: ${ordinal}/${filesToDelete.length} | deleted=${deleted} failed=${failed} | est. freed=${this.formatBytes(estimatedFreedBytes)}`,
        );
      }
    }

    const durationMs = Date.now() - startedAt;

    this.logger.warn(
      `[MAINTENANCE] Cleanup zakończony: total=${filesToDelete.length}, deleted=${deleted}, failed=${failed}, est. freed=${this.formatBytes(estimatedFreedBytes)}, duration=${durationMs}ms`,
    );

    return {
      trashedEmptied,
      totalFilesFound: filesToDelete.length,
      deleted,
      failed,
      estimatedBytesFound: this.formatBytes(estimatedTotalBytes),
      estimatedBytesFreed: this.formatBytes(estimatedFreedBytes),
      unknownSizeCount,
      durationMs,
    };
  }

  /**
   * Debug: zwraca informacje o koncie (Drive "about") + zużyciu quota
   * Przydatne do diagnozy błędu "Drive storage quota has been exceeded".
   */
  async getAccountUsageDebug(): Promise<{
    user: {
      emailAddress: string | null;
    };
    storageQuota: {
      limit?: string | null;
      usage?: string | null;
      usageInDrive?: string | null;
      // Alias na pole z Drive API: storageQuota.usageInDriveTrash
      usageInTrash?: string | null;
    } | null;
    raw: {
      user?: drive_v3.Schema$About['user'];
      storageQuota?: drive_v3.Schema$About['storageQuota'];
    };
  }> {
    this.ensureInitialized();

    const response = await this.withRetry(
      async () =>
        this.drive!.about.get({
          fields:
            'user(emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)',
        }),
      '[MAINTENANCE] drive.about.get',
    );

    const emailAddress = response.data.user?.emailAddress ?? null;
    const storageQuota = response.data.storageQuota ?? null;

    this.logger.warn(
      `[MAINTENANCE] Drive quota debug for ${emailAddress ?? 'unknown'}: ${JSON.stringify(storageQuota)}`,
    );

    return {
      user: {
        emailAddress,
      },
      storageQuota: storageQuota
        ? {
            limit: storageQuota.limit ?? null,
            usage: storageQuota.usage ?? null,
            usageInDrive: storageQuota.usageInDrive ?? null,
            usageInTrash: storageQuota.usageInDriveTrash ?? null,
          }
        : null,
      raw: {
        user: response.data.user,
        storageQuota: response.data.storageQuota,
      },
    };
  }

  /**
   * Usuwa plik z Google Drive
   * @param fileId - ID pliku do usunięcia
   */
  async deleteFile(fileId: string): Promise<void> {
    this.ensureInitialized();

    try {
      this.logger.log(`Deleting file ${fileId} from Google Drive`);

      await this.withRetry(
        async () =>
          this.drive!.files.delete({
            fileId,
            supportsAllDrives: true,
          }),
        `[DELETE] drive.files.delete fileId=${fileId}`,
        4,
        500,
      );

      this.logger.log(`File ${fileId} deleted successfully`);
    } catch (error: any) {
      // Loguj warning, ale nie wywalać operacji
      this.logger.warn(
        `Failed to delete file ${fileId} from Google Drive: ${error.message}`,
      );

      // Nie rzucamy wyjątku - usuwanie jest opcjonalne i nie powinno blokować głównej operacji
    }
  }
}

