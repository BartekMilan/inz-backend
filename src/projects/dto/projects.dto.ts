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
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

export class AddProjectMemberDto {
  @IsUUID('4', { message: 'Nieprawidłowy format ID użytkownika' })
  @IsNotEmpty({ message: 'ID użytkownika jest wymagane' })
  userId: string;

  @IsEnum(ProjectMemberRole, { message: 'Nieprawidłowa rola' })
  @IsOptional()
  role?: ProjectMemberRole = ProjectMemberRole.MEMBER;
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
