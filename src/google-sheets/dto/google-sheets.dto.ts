import { IsString, IsNotEmpty, IsUrl, Matches } from 'class-validator';

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

export class SheetConnectionResponseDto {
  success: boolean;
  message: string;
  sheetId?: string;
  sheetTitle?: string;
  sheetsCount?: number;
  sheetNames?: string[];
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
