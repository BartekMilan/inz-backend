import { Module } from '@nestjs/common';
import { GoogleSheetsController } from './google-sheets.controller';
import { GoogleSheetsService } from './google-sheets.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [GoogleSheetsController],
  providers: [GoogleSheetsService],
  exports: [GoogleSheetsService],
})
export class GoogleSheetsModule {}
