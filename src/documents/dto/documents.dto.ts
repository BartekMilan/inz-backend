import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsUUID,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO dla żądania generowania pojedynczego PDF dla uczestnika
 */
export class GenerateDocumentDto {
  @IsUUID('4', { message: 'templateId musi być prawidłowym UUID' })
  @IsNotEmpty({ message: 'templateId jest wymagane' })
  templateId: string;

  @IsNumber({}, { message: 'participantId musi być liczbą' })
  @IsNotEmpty({ message: 'participantId jest wymagane' })
  participantId: number;
}

/**
 * DTO dla pojedynczego mapowania placeholder -> participant_key
 */
export class TemplateMappingDto {
  @IsString({ message: 'placeholder musi być stringiem' })
  @IsNotEmpty({ message: 'placeholder jest wymagane' })
  placeholder: string;

  @IsString({ message: 'participantKey musi być stringiem' })
  @IsNotEmpty({ message: 'participantKey jest wymagane' })
  participantKey: string;
}

/**
 * DTO dla żądania ustawienia mapowań (PUT)
 */
export class SetTemplateMappingsDto {
  @IsArray({ message: 'mappings musi być tablicą' })
  @ArrayMinSize(0, { message: 'mappings nie może być puste (użyj pustej tablicy aby usunąć wszystkie mapowania)' })
  @ValidateNested({ each: true })
  @Type(() => TemplateMappingDto)
  mappings: TemplateMappingDto[];
}

/**
 * DTO dla odpowiedzi z mapowaniami (GET)
 */
export class TemplateMappingResponseDto {
  id: string;
  templateId: string;
  placeholder: string;
  participantKey: string;
  createdAt: string;
}

/**
 * DTO dla żądania utworzenia taska generowania dokumentów
 */
export class CreateDocumentTaskDto {
  @IsUUID('4', { message: 'templateId musi być prawidłowym UUID' })
  @IsNotEmpty({ message: 'templateId jest wymagane' })
  templateId: string;

  @IsArray({ message: 'participantIds musi być tablicą' })
  @ArrayMinSize(1, { message: 'participantIds musi zawierać co najmniej jeden element' })
  @IsInt({ each: true, message: 'Każdy participantId musi być liczbą całkowitą' })
  @Min(1, { each: true, message: 'Każdy participantId musi być większy od 0' })
  participantIds: number[];

  @IsString({ message: 'outputDriveFolderId musi być stringiem' })
  @IsOptional()
  outputDriveFolderId?: string;
}

/**
 * DTO dla odpowiedzi z utworzenia taska
 */
export class CreateDocumentTaskResponseDto {
  taskId: string;
}

/**
 * DTO dla odpowiedzi z listą tasków
 */
export class DocumentTaskListItemDto {
  id: string;
  projectId: string;
  templateId: string;
  requestedBy: string | null;
  participantIds: number[];
  status: 'pending' | 'processing' | 'done' | 'failed';
  progressTotal: number;
  progressDone: number;
  outputDriveFolderId: string | null;
  outputFiles: Array<{
    participantId: number;
    docFileId?: string; // Opcjonalne - może nie być jeśli wystąpił błąd przed utworzeniem doc
    pdfFileId: string; // Może być pusty string jeśli wystąpił błąd
    name: string;
    error?: string; // Opcjonalne - informacja o błędzie dla tego uczestnika
  }> | null;
  error: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO dla odpowiedzi ze szczegółami taska
 */
export class DocumentTaskDetailDto extends DocumentTaskListItemDto {}

/**
 * DTO dla odpowiedzi z przetwarzania tasków przez cron runner
 */
export class ProcessDocumentTasksResponseDto {
  claimed: number;
  processed: number;
  taskIds: string[];
}

