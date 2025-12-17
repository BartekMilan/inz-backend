import {
  Injectable,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
   * Używamy Service Account z JWT do autoryzacji
   */
  private async initializeGoogleDocs(): Promise<void> {
    // Pobierz wymagane zmienne środowiskowe
    const clientEmail = this.configService.get<string>('GOOGLE_CLIENT_EMAIL');
    const rawPrivateKey = this.configService.get<string>('GOOGLE_PRIVATE_KEY');

    // Sprawdź minimalne wymagane zmienne
    if (!clientEmail || !rawPrivateKey) {
      const missingVars: string[] = [];
      if (!clientEmail) missingVars.push('GOOGLE_CLIENT_EMAIL');
      if (!rawPrivateKey) missingVars.push('GOOGLE_PRIVATE_KEY');

      this.initializationError = `Brakujące zmienne środowiskowe: ${missingVars.join(', ')}`;
      this.logger.error(
        `Google Docs API initialization failed: ${this.initializationError}`,
      );
      this.logger.warn(
        'Google Docs integration is disabled. Set the required environment variables to enable it.',
      );
      return;
    }

    try {
      // Krytyczna poprawka: zamień \\n na rzeczywiste znaki nowej linii
      // Zmienne z .env często mają błędnie interpretowane znaki nowej linii
      const privateKey = (this.configService.get('GOOGLE_PRIVATE_KEY') || '').replace(
        /\\n/g,
        '\n',
      );

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

      // Utwórz klienta GoogleAuth z credentials
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
        scopes,
      });

      // Pobierz klienta autoryzacji
      await auth.getClient();

      // Inicjalizuj klientów Drive i Docs API
      this.drive = google.drive({ version: 'v3', auth });
      this.docs = google.docs({ version: 'v1', auth });
      this.isInitialized = true;
      this.initializationError = null;

      this.logger.log('Google Docs API clients initialized successfully');
      this.logger.log(`Service Account Email: ${clientEmail}`);
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
          `Brak uprawnień do skopiowania dokumentu. Dokument musi być udostępniony (z uprawnieniami "Edytor") dla Service Account.`,
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
          `Brak uprawnień do edycji dokumentu. Dokument musi być udostępniony (z uprawnieniami "Edytor") dla Service Account.`,
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
          `Brak uprawnień do eksportu dokumentu. Dokument musi być udostępniony (z uprawnieniami "Wyświetlanie" lub wyżej) dla Service Account.`,
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

      const response = await this.drive!.files.create({
        requestBody,
        media: {
          mimeType: 'application/pdf',
          body: pdfBuffer,
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
          `Brak uprawnień do wrzucenia pliku do Drive. Service Account musi mieć uprawnienia do zapisu w folderze.`,
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
   * Usuwa plik z Google Drive
   * @param fileId - ID pliku do usunięcia
   */
  async deleteFile(fileId: string): Promise<void> {
    this.ensureInitialized();

    try {
      this.logger.log(`Deleting file ${fileId} from Google Drive`);

      await this.drive!.files.delete({
        fileId,
      });

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

