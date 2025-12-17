import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { ProjectsService } from '../projects/projects.service';
import { GoogleDocsService } from '../google-docs/google-docs.service';
import {
  GenerateDocumentDto,
  SetTemplateMappingsDto,
  TemplateMappingResponseDto,
  CreateDocumentTaskDto,
  CreateDocumentTaskResponseDto,
  DocumentTaskListItemDto,
  DocumentTaskDetailDto,
  ProcessDocumentTasksResponseDto,
} from './dto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private projectsService: ProjectsService,
    private googleDocsService: GoogleDocsService,
    private configService: ConfigService,
  ) {}

  /**
   * Generuje pojedynczy PDF dla uczestnika
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param generateDto - DTO z templateId i participantId
   * @returns Obiekt z bufferem PDF i nazwą pliku
   */
  async generateParticipantPdf(
    projectId: string,
    userId: string,
    generateDto: GenerateDocumentDto,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    // Step 1: Pobierz szablon z DB i zweryfikuj, że należy do projektu
    const template = await this.getTemplateForProject(
      projectId,
      generateDto.templateId,
      userId,
    );

    // Step 2: Pobierz dane uczestnika
    const participant = await this.getParticipantById(
      projectId,
      generateDto.participantId,
      userId,
    );

    // Step 3: Przygotuj replacements z danych uczestnika
    const replacements = await this.buildReplacements(
      participant,
      generateDto.templateId,
    );

    // Step 4: Generuj nazwę pliku
    const fileName = this.generateFileName(participant, generateDto.participantId);

    // Step 5: Kopiuj szablon, podstaw placeholdery i eksportuj do PDF
    // Pobierz domyślny folder Drive (opcjonalny)
    const defaultFolderId = this.configService.get<string>(
      'DEFAULT_OUTPUT_DRIVE_FOLDER_ID',
    );

    let copiedFileId: string | undefined;

    try {
      this.logger.log(
        `Generating PDF for participant ${generateDto.participantId} using template ${generateDto.templateId}`,
      );


      // Kopiuj szablon (z folderem jeśli ustawiony)
      const copied = await this.googleDocsService.copyTemplateDoc(
        template.doc_id,
        fileName,
        defaultFolderId,
      );
      copiedFileId = copied.fileId;

      // Podstaw placeholdery
      await this.googleDocsService.replacePlaceholders(
        copied.fileId,
        replacements,
      );

      // Eksportuj do PDF
      const pdfBuffer = await this.googleDocsService.exportPdf(copied.fileId);

      this.logger.log(
        `PDF generated successfully for participant ${generateDto.participantId} (${pdfBuffer.length} bytes)`,
      );

      return {
        buffer: pdfBuffer,
        fileName,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to generate PDF for participant ${generateDto.participantId}:`,
        error.message,
      );

      // Jeśli błąd pochodzi z GoogleDocsService, przekaż go dalej
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Nie udało się wygenerować PDF: ${error.message}`,
      );
    } finally {
      // Usuń tymczasowy dokument z Drive (jeśli został utworzony)
      if (copiedFileId) {
        try {
          await this.googleDocsService.deleteFile(copiedFileId);
        } catch (error: any) {
          // deleteFile już loguje warning, więc nie musimy nic robić
          // Nie rzucamy wyjątku - usuwanie jest opcjonalne
        }
      }
    }
  }

  /**
   * Pobiera szablon z DB i weryfikuje, że należy do projektu
   */
  private async getTemplateForProject(
    projectId: string,
    templateId: string,
    userId: string,
  ): Promise<{ id: string; name: string; doc_id: string }> {
    // Weryfikuj dostęp użytkownika do projektu
    const hasAccess = await this.projectsService.userHasProjectAccess(
      projectId,
      userId,
    );
    if (!hasAccess) {
      throw new NotFoundException('Projekt nie został znaleziony');
    }

    // Pobierz szablon z DB (używamy admin client do bypass RLS)
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('document_templates')
      .select('id, name, doc_id')
      .eq('id', templateId)
      .eq('project_id', projectId)
      .single();

    if (error || !data) {
      this.logger.warn(
        `Template ${templateId} not found for project ${projectId}`,
      );
      throw new NotFoundException(
        'Szablon nie został znaleziony lub nie należy do tego projektu',
      );
    }

    return {
      id: data.id,
      name: data.name,
      doc_id: data.doc_id,
    };
  }

  /**
   * Pobiera dane uczestnika po ID
   */
  private async getParticipantById(
    projectId: string,
    participantId: number,
    userId: string,
  ): Promise<Record<string, any>> {
    // Pobierz wszystkich uczestników
    const participantsResponse = await this.projectsService.getParticipantsForProject(
      projectId,
      userId,
    );

    // Znajdź uczestnika o danym ID
    const participant = participantsResponse.data.find(
      (p) => p.id === participantId,
    );

    if (!participant) {
      throw new NotFoundException(
        `Uczestnik o ID ${participantId} nie został znaleziony`,
      );
    }

    return participant;
  }

  /**
   * Buduje obiekt replacements z danych uczestnika
   * Jeśli dla template istnieją mapowania, używa ich; w przeciwnym razie używa wszystkich pól uczestnika
   * Wszystkie wartości są rzutowane na string, null/undefined → pusty string
   * @param participant - Dane uczestnika
   * @param templateId - ID szablonu (do sprawdzenia mapowań)
   * @returns Obiekt replacements gdzie klucz to placeholder (bez nawiasów {{}})
   */
  private async buildReplacements(
    participant: Record<string, any>,
    templateId: string,
  ): Promise<Record<string, string>> {
    const replacements: Record<string, string> = {};

    // Pobierz mapowania dla tego szablonu
    const mappings = await this.getMappingsForTemplate(templateId);

    if (mappings && mappings.length > 0) {
      // Użyj mapowań: placeholder -> participant[participantKey]
      this.logger.log(
        `Using ${mappings.length} custom mapping(s) for template ${templateId}`,
      );

      for (const mapping of mappings) {
        const value = participant[mapping.participantKey];
        // Placeholder w DB jest bez nawiasów, ale replacePlaceholders oczekuje klucza bez nawiasów
        // więc używamy placeholder bezpośrednio
        replacements[mapping.placeholder] =
          value === null || value === undefined ? '' : String(value);
      }
    } else {
      // Fallback: użyj wszystkich pól uczestnika (zachowanie jak wcześniej)
      this.logger.log(
        `No custom mappings found for template ${templateId}, using all participant fields`,
      );

      for (const [key, value] of Object.entries(participant)) {
        if (value === null || value === undefined) {
          replacements[key] = '';
        } else {
          replacements[key] = String(value);
        }
      }
    }

    return replacements;
  }

  /**
   * Pobiera mapowania placeholderów dla szablonu
   * @param templateId - ID szablonu
   * @returns Tablica mapowań lub null jeśli brak
   */
  private async getMappingsForTemplate(
    templateId: string,
  ): Promise<Array<{ placeholder: string; participantKey: string }> | null> {
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('document_template_mappings')
      .select('placeholder, participant_key')
      .eq('template_id', templateId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.warn(
        `Failed to get mappings for template ${templateId}:`,
        error.message,
      );
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return data.map((m) => ({
      placeholder: m.placeholder,
      participantKey: m.participant_key,
    }));
  }

  /**
   * Pobiera mapowania dla szablonu (endpoint GET)
   * @param projectId - ID projektu
   * @param templateId - ID szablonu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @returns Tablica mapowań
   */
  async getTemplateMappings(
    projectId: string,
    templateId: string,
    userId: string,
  ): Promise<TemplateMappingResponseDto[]> {
    // Weryfikuj, że template należy do projektu
    await this.getTemplateForProject(projectId, templateId, userId);

    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('document_template_mappings')
      .select('id, template_id, placeholder, participant_key, created_at')
      .eq('template_id', templateId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(
        `Failed to get mappings for template ${templateId}:`,
        error.message,
      );
      throw new InternalServerErrorException(
        'Nie udało się pobrać mapowań szablonu',
      );
    }

    return (data || []).map((m) => ({
      id: m.id,
      templateId: m.template_id,
      placeholder: m.placeholder,
      participantKey: m.participant_key,
      createdAt: m.created_at,
    }));
  }

  /**
   * Ustawia mapowania dla szablonu (endpoint PUT - nadpisuje wszystkie)
   * @param projectId - ID projektu
   * @param templateId - ID szablonu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param setMappingsDto - DTO z tablicą mapowań
   * @returns Tablica zapisanych mapowań
   */
  async setTemplateMappings(
    projectId: string,
    templateId: string,
    userId: string,
    setMappingsDto: SetTemplateMappingsDto,
  ): Promise<TemplateMappingResponseDto[]> {
    // Weryfikuj, że template należy do projektu
    await this.getTemplateForProject(projectId, templateId, userId);

    // Walidacja: sprawdź duplikaty placeholderów
    const placeholders = setMappingsDto.mappings.map((m) => m.placeholder);
    const uniquePlaceholders = new Set(placeholders);
    if (placeholders.length !== uniquePlaceholders.size) {
      throw new BadRequestException(
        'Mapowania zawierają duplikaty placeholderów. Każdy placeholder może wystąpić tylko raz.',
      );
    }

    // Walidacja: sprawdź puste wartości
    for (const mapping of setMappingsDto.mappings) {
      if (!mapping.placeholder || mapping.placeholder.trim() === '') {
        throw new BadRequestException(
          'Placeholder nie może być pusty',
        );
      }
      if (!mapping.participantKey || mapping.participantKey.trim() === '') {
        throw new BadRequestException(
          'participantKey nie może być pusty',
        );
      }
    }

    const supabase = this.supabaseService.getAdminClient();

    // Rozpocznij transakcję: usuń wszystkie istniejące mapowania, potem dodaj nowe
    try {
      // Usuń wszystkie istniejące mapowania dla tego szablonu
      const { error: deleteError } = await supabase
        .from('document_template_mappings')
        .delete()
        .eq('template_id', templateId);

      if (deleteError) {
        this.logger.error(
          `Failed to delete existing mappings for template ${templateId}:`,
          deleteError.message,
        );
        throw new InternalServerErrorException(
          'Nie udało się usunąć istniejących mapowań',
        );
      }

      // Jeśli nie ma nowych mapowań, zwróć pustą tablicę
      if (setMappingsDto.mappings.length === 0) {
        this.logger.log(
          `All mappings removed for template ${templateId}`,
        );
        return [];
      }

      // Dodaj nowe mapowania
      const mappingsToInsert = setMappingsDto.mappings.map((m) => ({
        template_id: templateId,
        placeholder: m.placeholder.trim(),
        participant_key: m.participantKey.trim(),
      }));

      const { data, error: insertError } = await supabase
        .from('document_template_mappings')
        .insert(mappingsToInsert)
        .select('id, template_id, placeholder, participant_key, created_at');

      if (insertError) {
        this.logger.error(
          `Failed to insert mappings for template ${templateId}:`,
          insertError.message,
        );
        throw new InternalServerErrorException(
          'Nie udało się zapisać mapowań',
        );
      }

      this.logger.log(
        `Successfully set ${data.length} mapping(s) for template ${templateId}`,
      );

      return (data || []).map((m) => ({
        id: m.id,
        templateId: m.template_id,
        placeholder: m.placeholder,
        participantKey: m.participant_key,
        createdAt: m.created_at,
      }));
    } catch (error: any) {
      // Jeśli błąd został już rzucony jako BadRequestException lub InternalServerErrorException, przekaż go dalej
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      // Dla innych błędów, rzuć InternalServerErrorException
      this.logger.error(
        `Unexpected error while setting mappings for template ${templateId}:`,
        error.message,
      );
      throw new InternalServerErrorException(
        `Nie udało się ustawić mapowań: ${error.message}`,
      );
    }
  }

  /**
   * Generuje nazwę pliku PDF na podstawie danych uczestnika
   */
  private generateFileName(
    participant: Record<string, any>,
    participantId: number,
  ): string {
    // Spróbuj użyć imienia i nazwiska jeśli są dostępne
    const firstName = participant.first_name || participant.firstName || '';
    const lastName = participant.last_name || participant.lastName || '';

    if (firstName && lastName) {
      // Usuń znaki specjalne z nazwy pliku
      const safeFirstName = firstName.replace(/[^a-zA-Z0-9]/g, '_');
      const safeLastName = lastName.replace(/[^a-zA-Z0-9]/g, '_');
      return `${safeFirstName}_${safeLastName}_${participantId}.pdf`;
    }

    // Fallback: użyj tylko participantId
    return `participant-${participantId}.pdf`;
  }

  // =====================================================
  // DOCUMENT GENERATION TASKS
  // =====================================================

  /**
   * Tworzy nowy task generowania dokumentów
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @param createTaskDto - DTO z templateId i participantIds
   * @returns ID utworzonego taska
   */
  async createDocumentTask(
    projectId: string,
    userId: string,
    createTaskDto: CreateDocumentTaskDto,
  ): Promise<CreateDocumentTaskResponseDto> {
    // Weryfikuj dostęp użytkownika do projektu
    const hasAccess = await this.projectsService.userHasProjectAccess(
      projectId,
      userId,
    );
    if (!hasAccess) {
      throw new NotFoundException('Projekt nie został znaleziony');
    }

    // Weryfikuj, że template należy do projektu
    await this.getTemplateForProject(projectId, createTaskDto.templateId, userId);

    // Walidacja: sprawdź duplikaty w participantIds
    const uniqueIds = new Set(createTaskDto.participantIds);
    if (createTaskDto.participantIds.length !== uniqueIds.size) {
      throw new BadRequestException(
        'participantIds zawiera duplikaty. Każdy participantId może wystąpić tylko raz.',
      );
    }

    const supabase = this.supabaseService.getAdminClient();

    // Utwórz task w DB
    const { data, error } = await supabase
      .from('document_generation_tasks')
      .insert({
        project_id: projectId,
        template_id: createTaskDto.templateId,
        requested_by: userId,
        participant_ids: createTaskDto.participantIds,
        status: 'pending',
        progress_total: createTaskDto.participantIds.length,
        progress_done: 0,
        output_drive_folder_id: createTaskDto.outputDriveFolderId || null,
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error(
        `Failed to create document task for project ${projectId}:`,
        error.message,
      );
      throw new InternalServerErrorException(
        'Nie udało się utworzyć taska generowania dokumentów',
      );
    }

    this.logger.log(
      `Document task created: ${data.id} for project ${projectId} with ${createTaskDto.participantIds.length} participants`,
    );

    return {
      taskId: data.id,
    };
  }

  /**
   * Pobiera listę tasków dla projektu
   * @param projectId - ID projektu
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @returns Lista tasków (ostatnie 50, sort desc po created_at)
   */
  async getDocumentTasks(
    projectId: string,
    userId: string,
  ): Promise<DocumentTaskListItemDto[]> {
    // Weryfikuj dostęp użytkownika do projektu
    const hasAccess = await this.projectsService.userHasProjectAccess(
      projectId,
      userId,
    );
    if (!hasAccess) {
      throw new NotFoundException('Projekt nie został znaleziony');
    }

    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('document_generation_tasks')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      this.logger.error(
        `Failed to get document tasks for project ${projectId}:`,
        error.message,
      );
      throw new InternalServerErrorException(
        'Nie udało się pobrać listy tasków',
      );
    }

    return (data || []).map((task) => this.mapTaskToResponse(task));
  }

  /**
   * Pobiera szczegóły taska
   * @param projectId - ID projektu
   * @param taskId - ID taska
   * @param userId - ID użytkownika (do weryfikacji uprawnień)
   * @returns Szczegóły taska
   */
  async getDocumentTaskById(
    projectId: string,
    taskId: string,
    userId: string,
  ): Promise<DocumentTaskDetailDto> {
    // Weryfikuj dostęp użytkownika do projektu
    const hasAccess = await this.projectsService.userHasProjectAccess(
      projectId,
      userId,
    );
    if (!hasAccess) {
      throw new NotFoundException('Projekt nie został znaleziony');
    }

    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('document_generation_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('project_id', projectId)
      .single();

    if (error || !data) {
      this.logger.warn(
        `Task ${taskId} not found for project ${projectId}`,
      );
      throw new NotFoundException(
        'Task nie został znaleziony lub nie należy do tego projektu',
      );
    }

    return this.mapTaskToResponse(data);
  }

  /**
   * Mapuje rekord z DB na DTO odpowiedzi
   */
  private mapTaskToResponse(task: any): DocumentTaskListItemDto {
    return {
      id: task.id,
      projectId: task.project_id,
      templateId: task.template_id,
      requestedBy: task.requested_by,
      participantIds: task.participant_ids,
      status: task.status,
      progressTotal: task.progress_total,
      progressDone: task.progress_done,
      outputDriveFolderId: task.output_drive_folder_id,
      outputFiles: task.output_files,
      error: task.error,
      lockedAt: task.locked_at,
      lockedBy: task.locked_by,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    };
  }

  /**
   * Przetwarza partię tasków do generowania dokumentów (używane przez cron runner)
   * Claimuje taski (pending + stale processing) i wykonuje mock processing
   * @returns Statystyki przetworzonych tasków
   */
  async processDocumentTasks(): Promise<ProcessDocumentTasksResponseDto> {
    this.logger.log('Starting document tasks processing run');

    const supabase = this.supabaseService.getAdminClient();
    const batchSize = parseInt(process.env.TASK_BATCH_SIZE || '5', 10);
    const lockTimeoutMinutes = parseInt(
      process.env.TASK_LOCK_TIMEOUT_MINUTES || '120',
      10,
    );
    const lockTimeoutMs = lockTimeoutMinutes * 60 * 1000;
    const lockTimeoutThreshold = new Date(
      Date.now() - lockTimeoutMs,
    ).toISOString();
    const lockedBy = 'cron-runner';
    const now = new Date().toISOString();

    // Pobierz kandydatów: pending lub stale processing
    // Używamy dwóch zapytań i łączymy wyniki
    const { data: pendingTasks, error: pendingError } = await supabase
      .from('document_generation_tasks')
      .select('id, status, locked_at, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batchSize * 2);

    const { data: staleTasks, error: staleError } = await supabase
      .from('document_generation_tasks')
      .select('id, status, locked_at, created_at')
      .eq('status', 'processing')
      .lt('locked_at', lockTimeoutThreshold)
      .order('created_at', { ascending: true })
      .limit(batchSize * 2);

    if (pendingError || staleError) {
      this.logger.error(
        'Failed to fetch candidate tasks:',
        pendingError?.message || staleError?.message,
      );
      throw new InternalServerErrorException(
        'Nie udało się pobrać tasków do przetworzenia',
      );
    }

    // Połącz wyniki i usuń duplikaty
    const allCandidates = [
      ...(pendingTasks || []),
      ...(staleTasks || []),
    ];
    const uniqueCandidates = Array.from(
      new Map(allCandidates.map((t) => [t.id, t])).values(),
    );
    const candidateTasks = uniqueCandidates
      .sort(
        (a, b) =>
          new Date(a.created_at || 0).getTime() -
          new Date(b.created_at || 0).getTime(),
      )
      .slice(0, batchSize * 2);

    const candidateCount = candidateTasks?.length || 0;
    this.logger.log(
      `Found ${candidateCount} candidate task(s) for processing`,
    );

    if (candidateCount === 0) {
      return {
        claimed: 0,
        processed: 0,
        taskIds: [],
      };
    }

    // Claimuj taski bezpiecznie (update z warunkiem)
    const claimedTaskIds: string[] = [];

    for (const task of candidateTasks || []) {
      if (claimedTaskIds.length >= batchSize) {
        break;
      }

      // Warunek claimowania:
      // - status='pending' LUB (status='processing' i locked_at < threshold)
      const isPending = task.status === 'pending';
      const isStale =
        task.status === 'processing' &&
        task.locked_at &&
        new Date(task.locked_at) < new Date(lockTimeoutThreshold);

      if (!isPending && !isStale) {
        continue;
      }

      // Wykonaj update z warunkiem - tylko jeśli status się nie zmienił
      let updateQuery = supabase
        .from('document_generation_tasks')
        .update({
          status: 'processing',
          locked_at: now,
          locked_by: lockedBy,
        })
        .eq('id', task.id);

      // Dodaj warunek w zależności od typu taska
      if (isPending) {
        updateQuery = updateQuery.eq('status', 'pending');
      } else {
        // Dla stale tasków: sprawdź status i locked_at
        updateQuery = updateQuery
          .eq('status', 'processing')
          .lt('locked_at', lockTimeoutThreshold);
      }

      const { data: updatedTask, error: updateError } = await updateQuery
        .select('id')
        .single();

      if (updateError) {
        this.logger.warn(
          `Failed to claim task ${task.id}:`,
          updateError.message,
        );
        continue;
      }

      if (updatedTask) {
        claimedTaskIds.push(updatedTask.id);
        this.logger.log(`Claimed task ${updatedTask.id}`);
      }
    }

    this.logger.log(`Claimed ${claimedTaskIds.length} task(s)`);

    // Przetwórz zclaimowane taski (realne przetwarzanie)
    const processedTaskIds: string[] = [];

    for (const taskId of claimedTaskIds) {
      try {
        await this.processSingleTask(taskId, supabase);
        processedTaskIds.push(taskId);
        this.logger.log(`Processed task ${taskId}`);
      } catch (error: any) {
        this.logger.error(
          `Error processing task ${taskId}:`,
          error.message,
        );
        // Nie dodajemy do processedTaskIds jeśli wystąpił błąd
      }
    }

    this.logger.log(
      `Processing run completed: claimed=${claimedTaskIds.length}, processed=${processedTaskIds.length}`,
    );

    return {
      claimed: claimedTaskIds.length,
      processed: processedTaskIds.length,
      taskIds: processedTaskIds,
    };
  }

  /**
   * Przetwarza pojedynczy task generowania dokumentów
   * @param taskId - ID taska do przetworzenia
   * @param supabase - Admin client Supabase
   */
  private async processSingleTask(
    taskId: string,
    supabase: any,
  ): Promise<void> {
    // Pobierz pełne dane taska
    const { data: task, error: fetchError } = await supabase
      .from('document_generation_tasks')
      .select(
        'id, project_id, template_id, participant_ids, output_drive_folder_id, progress_total, output_files, requested_by',
      )
      .eq('id', taskId)
      .single();

    if (fetchError || !task) {
      this.logger.warn(
        `Failed to fetch task ${taskId} for processing:`,
        fetchError?.message,
      );
      throw new Error(`Nie udało się pobrać taska: ${fetchError?.message}`);
    }

    this.logger.log(
      `Processing task ${taskId} for project ${task.project_id} with ${task.participant_ids?.length || 0} participants`,
    );

    // Pobierz template z DB
    const { data: template, error: templateError } = await supabase
      .from('document_templates')
      .select('id, name, doc_id')
      .eq('id', task.template_id)
      .single();

    if (templateError || !template) {
      this.logger.error(
        `Template ${task.template_id} not found for task ${taskId}`,
      );
      await supabase
        .from('document_generation_tasks')
        .update({
          status: 'failed',
          error: `Szablon ${task.template_id} nie został znaleziony`,
          locked_at: null,
          locked_by: null,
        })
        .eq('id', taskId);
      throw new Error(`Szablon nie został znaleziony`);
    }

    // Pobierz mapowania dla szablonu
    const mappings = await this.getMappingsForTemplate(task.template_id);

    // Pobierz dane uczestników dla projektu
    // Używamy requested_by z taska jako userId (użytkownik, który utworzył task, ma dostęp do projektu)
    let participantsData: Record<string, any>[] = [];
    try {
      if (!task.requested_by) {
        throw new Error('Task nie ma przypisanego requested_by');
      }

      // Pobierz konfigurację arkusza i dane uczestników
      const participantsResponse = await this.projectsService.getParticipantsForProject(
        task.project_id,
        task.requested_by,
      );
      participantsData = participantsResponse.data || [];
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch participants for project ${task.project_id}:`,
        error.message,
      );
      await supabase
        .from('document_generation_tasks')
        .update({
          status: 'failed',
          error: `Nie udało się pobrać danych uczestników: ${error.message}`,
          locked_at: null,
          locked_by: null,
        })
        .eq('id', taskId);
      throw error;
    }

    // Inicjalizuj output_files jeśli nie istnieje
    const outputFiles: Array<{
      participantId: number;
      docFileId?: string;
      pdfFileId: string;
      name: string;
      error?: string;
    }> = task.output_files || [];

    let progressDone = task.progress_done || 0;
    let hasErrors = false;
    const participantIds = task.participant_ids || [];

    // Przetwórz każdego uczestnika
    for (const participantId of participantIds) {
      try {
        // Znajdź uczestnika w danych
        const participant = participantsData.find((p) => p.id === participantId);

        if (!participant) {
          this.logger.warn(
            `Participant ${participantId} not found in sheet data`,
          );
          outputFiles.push({
            participantId,
            pdfFileId: '',
            name: `participant-${participantId}.pdf`,
            error: `Uczestnik o ID ${participantId} nie został znaleziony w arkuszu`,
          });
          hasErrors = true;
          progressDone++;
          continue;
        }

        // Zbuduj replacements
        const replacements = await this.buildReplacementsForParticipant(
          participant,
          mappings,
        );

        // Generuj nazwę pliku
        const fileName = this.generateFileNameForTask(
          participant,
          participantId,
          template.name,
        );

        // Pipeline: copyTemplateDoc → replacePlaceholders → exportPdf
        // Pobierz folderId: task.output_drive_folder_id lub fallback do DEFAULT_OUTPUT_DRIVE_FOLDER_ID
        const defaultFolderId = this.configService.get<string>(
          'DEFAULT_OUTPUT_DRIVE_FOLDER_ID',
        );
        const folderId = task.output_drive_folder_id || defaultFolderId;

        let docFileId: string | undefined;
        let pdfFileId: string;

        try {
          console.log('folderId', folderId);
          // 1. Kopiuj szablon (z folderem jeśli ustawiony)
          const copied = await this.googleDocsService.copyTemplateDoc(
            template.doc_id,
            `Temp_${fileName.replace('.pdf', '')}`,
            folderId,
          );
          docFileId = copied.fileId;

          // 2. Podstaw placeholdery
          await this.googleDocsService.replacePlaceholders(
            copied.fileId,
            replacements,
          );

          // 3. Eksportuj do PDF
          const pdfBuffer = await this.googleDocsService.exportPdf(
            copied.fileId,
          );

          // 4. Wrzuć PDF do Drive
          const uploaded = await this.googleDocsService.uploadPdfToDrive(
            pdfBuffer,
            fileName,
            folderId,
          );
          pdfFileId = uploaded.fileId;

          // Zapisz wynik
          outputFiles.push({
            participantId,
            docFileId,
            pdfFileId,
            name: fileName,
          });

          progressDone++;
          this.logger.log(
            `Successfully generated PDF for participant ${participantId}: ${pdfFileId}`,
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to generate PDF for participant ${participantId}:`,
            error.message,
          );
          outputFiles.push({
            participantId,
            docFileId,
            pdfFileId: '',
            name: fileName,
            error: error.message || 'Nieznany błąd podczas generowania PDF',
          });
          hasErrors = true;
          progressDone++;
        } finally {
          // Usuń tymczasowy Google Doc z Drive (nawet jeśli wystąpił błąd)
          if (docFileId) {
            try {
              await this.googleDocsService.deleteFile(docFileId);
            } catch (error: any) {
              // deleteFile już loguje warning, więc nie musimy nic robić
              // Nie rzucamy wyjątku - usuwanie jest opcjonalne
            }
          }
        }

        // Aktualizuj progress w trakcie (dla UI)
        await supabase
          .from('document_generation_tasks')
          .update({
            progress_done: progressDone,
            output_files: outputFiles,
          })
          .eq('id', taskId);
      } catch (error: any) {
        this.logger.error(
          `Error processing participant ${participantId} in task ${taskId}:`,
          error.message,
        );
        outputFiles.push({
          participantId,
          pdfFileId: '',
          name: `participant-${participantId}.pdf`,
          error: error.message || 'Nieznany błąd',
        });
        hasErrors = true;
        progressDone++;

        // Aktualizuj progress nawet przy błędzie
        await supabase
          .from('document_generation_tasks')
          .update({
            progress_done: progressDone,
            output_files: outputFiles,
          })
          .eq('id', taskId);
      }
    }

    // Ustaw finalny status
    const finalStatus = hasErrors ? 'failed' : 'done';
    const errorMessage = hasErrors
      ? 'Wystąpiły błędy podczas przetwarzania niektórych uczestników'
      : null;

    await supabase
      .from('document_generation_tasks')
      .update({
        status: finalStatus,
        progress_done: progressDone,
        output_files: outputFiles,
        error: errorMessage,
        locked_at: null,
        locked_by: null,
      })
      .eq('id', taskId);

    this.logger.log(
      `Task ${taskId} completed with status ${finalStatus} (${progressDone}/${task.progress_total} participants)`,
    );
  }

  /**
   * Buduje replacements dla uczestnika używając mapowań lub fallback
   * @param participant - Dane uczestnika
   * @param mappings - Mapowania placeholder -> participantKey (lub null)
   * @returns Obiekt replacements
   */
  private async buildReplacementsForParticipant(
    participant: Record<string, any>,
    mappings: Array<{ placeholder: string; participantKey: string }> | null,
  ): Promise<Record<string, string>> {
    const replacements: Record<string, string> = {};

    if (mappings && mappings.length > 0) {
      // Użyj mapowań
      for (const mapping of mappings) {
        const value = participant[mapping.participantKey];
        replacements[mapping.placeholder] =
          value === null || value === undefined ? '' : String(value);
      }
    } else {
      // Fallback: użyj wszystkich pól uczestnika
      for (const [key, value] of Object.entries(participant)) {
        if (value === null || value === undefined) {
          replacements[key] = '';
        } else {
          replacements[key] = String(value);
        }
      }
    }

    return replacements;
  }

  /**
   * Generuje nazwę pliku PDF dla taska
   * Format: "<TemplateName> - <LastName> <FirstName>.pdf" lub fallback: "participant-<id>.pdf"
   */
  private generateFileNameForTask(
    participant: Record<string, any>,
    participantId: number,
    templateName: string,
  ): string {
    const firstName =
      participant.first_name || participant.firstName || '';
    const lastName = participant.last_name || participant.lastName || '';

    if (firstName && lastName) {
      // Usuń znaki specjalne z nazwy pliku
      const safeFirstName = firstName.replace(/[^a-zA-Z0-9]/g, '_');
      const safeLastName = lastName.replace(/[^a-zA-Z0-9]/g, '_');
      const safeTemplateName = templateName.replace(/[^a-zA-Z0-9]/g, '_');
      return `${safeTemplateName} - ${safeLastName} ${safeFirstName}.pdf`;
    }

    // Fallback: użyj tylko participantId
    const safeTemplateName = templateName.replace(/[^a-zA-Z0-9]/g, '_');
    return `${safeTemplateName} - participant-${participantId}.pdf`;
  }
}

