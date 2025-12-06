import { IsString, IsNotEmpty, IsUrl, Matches, IsUUID, IsOptional, IsArray } from 'class-validator';

export class ConnectSheetDto {
  @IsString()
  @IsNotEmpty({ message: 'Link do arkusza Google Sheets jest wymagany' })
  @IsUrl({}, { message: 'Podaj prawidłowy URL' })
  @Matches(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/,
    { message: 'Podaj prawidłowy link do arkusza Google Sheets' }
  )
  sheetUrl: string;
}

export class ConnectProjectSheetDto {
  @IsUUID('4', { message: 'Nieprawidłowy format ID projektu' })
  @IsNotEmpty({ message: 'ID projektu jest wymagane' })
  projectId: string;

  @IsString()
  @IsNotEmpty({ message: 'Link do arkusza Google Sheets jest wymagany' })
  @IsUrl({}, { message: 'Podaj prawidłowy URL' })
  @Matches(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/,
    { message: 'Podaj prawidłowy link do arkusza Google Sheets' }
  )
  sheetUrl: string;
}

export class GetSheetDataDto {
  @IsUUID('4', { message: 'Nieprawidłowy format ID projektu' })
  @IsNotEmpty({ message: 'ID projektu jest wymagane' })
  projectId: string;

  @IsString()
  @IsNotEmpty({ message: 'Zakres danych jest wymagany' })
  range: string;
}

export class UpdateSheetDataDto {
  @IsUUID('4', { message: 'Nieprawidłowy format ID projektu' })
  @IsNotEmpty({ message: 'ID projektu jest wymagane' })
  projectId: string;

  @IsString()
  @IsNotEmpty({ message: 'Zakres danych jest wymagany' })
  range: string;

  @IsArray()
  @IsNotEmpty({ message: 'Dane są wymagane' })
  values: any[][];
}

export class AppendRowDto {
  @IsUUID('4', { message: 'Nieprawidłowy format ID projektu' })
  @IsNotEmpty({ message: 'ID projektu jest wymagane' })
  projectId: string;

  @IsString()
  @IsNotEmpty({ message: 'Nazwa arkusza jest wymagana' })
  sheetName: string;

  @IsArray()
  @IsNotEmpty({ message: 'Dane są wymagane' })
  values: any[];
}

export class SheetConnectionResponseDto {
  success: boolean;
  message: string;
  sheetId?: string;
  sheetTitle?: string;
  sheetsCount?: number;
  sheetNames?: string[];
  projectId?: string;
}

export class TestConnectionResponseDto {
  connected: boolean;
  message: string;
  sheetInfo?: {
    sheetId: string;
    title: string;
    sheetsCount: number;
    sheetNames: string[];
  };
}

export class ProjectSheetConfigurationResponseDto {
  configured: boolean;
  projectId?: string;
  config?: {
    sheetId: string;
    sheetTitle: string;
    sheetUrl: string;
    connected: boolean;
    sheetsCount?: number;
    sheetNames?: string[];
    error?: string;
  };
}

// =====================================================
// DOCUMENT TEMPLATE DTOs
// =====================================================

export class CreateDocumentTemplateDto {
  @IsString()
  @IsNotEmpty({ message: 'Nazwa szablonu jest wymagana' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Google Doc ID jest wymagane' })
  docId: string;
}

export class UpdateDocumentTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  docId?: string;
}

export class DocumentTemplateResponseDto {
  id: string;
  projectId: string;
  name: string;
  docId: string;
  createdAt: string;
  updatedAt: string;
}

