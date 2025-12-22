import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  MaxLength,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// =====================================================
// PROJECT DTOs
// =====================================================

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty({ message: 'Nazwa projektu jest wymagana' })
  @MaxLength(255, { message: 'Nazwa projektu może mieć maksymalnie 255 znaków' })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Opis może mieć maksymalnie 1000 znaków' })
  description?: string;
}

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  @MaxLength(255, { message: 'Nazwa projektu może mieć maksymalnie 255 znaków' })
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Opis może mieć maksymalnie 1000 znaków' })
  description?: string;
}

export class ProjectResponseDto {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role?: string; // User's role in this project
  memberCount?: number;
}

export class ProjectListResponseDto {
  projects: ProjectResponseDto[];
  total: number;
}

// =====================================================
// PROJECT MEMBER DTOs
// =====================================================

export enum ProjectMemberRole {
  OWNER = 'owner',
  EDITOR = 'editor',
  VIEWER = 'viewer',
}

export class AddProjectMemberDto {
  @IsUUID('4', { message: 'Nieprawidłowy format ID użytkownika' })
  @IsNotEmpty({ message: 'ID użytkownika jest wymagane' })
  userId: string;

  @IsEnum(ProjectMemberRole, { message: 'Nieprawidłowa rola' })
  @IsOptional()
  role?: ProjectMemberRole = ProjectMemberRole.VIEWER;
}

export class AddProjectMemberByEmailDto {
  @IsString()
  @IsNotEmpty({ message: 'Email jest wymagany' })
  email: string;

  @IsEnum(ProjectMemberRole, { message: 'Nieprawidłowa rola' })
  @IsOptional()
  role?: ProjectMemberRole = ProjectMemberRole.VIEWER;
}

export class AddProjectMemberByEmailDto {
  @IsString()
  @IsNotEmpty({ message: 'Email jest wymagany' })
  email: string;

  @IsEnum(ProjectMemberRole, { message: 'Nieprawidłowa rola' })
  @IsOptional()
  role?: ProjectMemberRole = ProjectMemberRole.VIEWER;
}

export class UpdateProjectMemberDto {
  @IsEnum(ProjectMemberRole, { message: 'Nieprawidłowa rola' })
  @IsNotEmpty({ message: 'Rola jest wymagana' })
  role: ProjectMemberRole;
}

export class ProjectMemberResponseDto {
  id: string;
  projectId: string;
  userId: string;
  role: string;
  createdAt: string;
  user?: {
    email: string;
  };
}

// =====================================================
// FIELD DEFINITION DTOs
// =====================================================

export enum FieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  EMAIL = 'email',
  PHONE = 'phone',
  SELECT = 'select',
  CHECKBOX = 'checkbox',
  TEXTAREA = 'textarea',
}

export class CreateFieldDefinitionDto {
  @IsString()
  @IsNotEmpty({ message: 'Nazwa pola jest wymagana' })
  @MaxLength(255)
  fieldName: string;

  @IsString()
  @IsNotEmpty({ message: 'Etykieta pola jest wymagana' })
  @MaxLength(255)
  fieldLabel: string;

  @IsEnum(FieldType, { message: 'Nieprawidłowy typ pola' })
  @IsOptional()
  fieldType?: FieldType = FieldType.TEXT;

  @IsInt()
  @Min(0)
  columnIndex: number;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean = false;

  @IsArray()
  @IsOptional()
  options?: string[]; // For select fields

  @IsOptional()
  validationRules?: Record<string, any>;

  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number = 0;

  @IsBoolean()
  @IsOptional()
  isVisible?: boolean = true;
}

export class UpdateFieldDefinitionDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  fieldLabel?: string;

  @IsEnum(FieldType, { message: 'Nieprawidłowy typ pola' })
  @IsOptional()
  fieldType?: FieldType;

  @IsInt()
  @Min(0)
  @IsOptional()
  columnIndex?: number;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @IsArray()
  @IsOptional()
  options?: string[];

  @IsOptional()
  validationRules?: Record<string, any>;

  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @IsBoolean()
  @IsOptional()
  isVisible?: boolean;
}

export class FieldDefinitionResponseDto {
  id: string;
  projectId: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  columnIndex: number;
  isRequired: boolean;
  options: string[] | null;
  validationRules: Record<string, any> | null;
  displayOrder: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export class BulkCreateFieldDefinitionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFieldDefinitionDto)
  fields: CreateFieldDefinitionDto[];
}

// =====================================================
// FIELD MAPPING DTOs
// =====================================================

export enum FieldMappingType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  SELECT = 'select',
  EMAIL = 'email',
  CHECKBOX = 'checkbox',
}

export class CreateFieldMappingDto {
  @IsString()
  @IsNotEmpty({ message: 'Litera kolumny jest wymagana' })
  @MaxLength(10)
  sheetColumnLetter: string; // e.g., "A", "B", "AA"

  @IsString()
  @IsNotEmpty({ message: 'Klucz wewnętrzny jest wymagany' })
  @MaxLength(255)
  internalKey: string; // e.g., "firstName", "status"

  @IsString()
  @IsNotEmpty({ message: 'Nazwa wyświetlana jest wymagana' })
  @MaxLength(255)
  displayName: string; // e.g., "Imię", "Czy opłacono"

  @IsBoolean()
  @IsOptional()
  isVisible?: boolean = true;

  @IsEnum(FieldMappingType, { message: 'Nieprawidłowy typ pola' })
  @IsOptional()
  fieldType?: FieldMappingType = FieldMappingType.TEXT;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean = false;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxLength?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  options?: string[]; // For select fields
}

export class UpdateFieldMappingDto {
  @IsString()
  @IsOptional()
  @MaxLength(10)
  sheetColumnLetter?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  internalKey?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayName?: string;

  @IsBoolean()
  @IsOptional()
  isVisible?: boolean;

  @IsEnum(FieldMappingType, { message: 'Nieprawidłowy typ pola' })
  @IsOptional()
  fieldType?: FieldMappingType;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxLength?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  options?: string[];
}

export class FieldMappingResponseDto {
  id: string;
  projectId: string;
  sheetColumnLetter: string;
  internalKey: string;
  displayName: string;
  isVisible: boolean;
  fieldType: string;
  isRequired: boolean;
  maxLength: number | null;
  options: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export class BulkCreateFieldMappingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFieldMappingDto)
  mappings: CreateFieldMappingDto[];
}

// =====================================================
// PARTICIPANTS DTOs
// =====================================================

export class ParticipantConfigDto {
  key: string;
  label: string;
}

export class ParticipantDataDto {
  id: number;
  [key: string]: any; // Dynamic fields based on mappings
}

export class ParticipantsResponseDto {
  config: ParticipantConfigDto[];
  data: ParticipantDataDto[];
}

// =====================================================
// SCAN HEADERS DTOs
// =====================================================

export class ScanHeadersDto {
  @IsString()
  @IsNotEmpty({ message: 'ID arkusza jest wymagane' })
  spreadsheetId: string;
}

export class SheetHeaderDto {
  letter: string; // e.g., "A", "B", "AA"
  value: string; // Header value from the sheet
}

export class ScanHeadersResponseDto {
  headers: SheetHeaderDto[];
}

// =====================================================
// UPDATE MAPPINGS DTOs
// =====================================================

export class UpdateMappingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFieldMappingDto)
  mappings: CreateFieldMappingDto[];
}
