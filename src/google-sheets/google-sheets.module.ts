import { Module, forwardRef } from '@nestjs/common';
import { GoogleSheetsController } from './google-sheets.controller';
import { GoogleSheetsService } from './google-sheets.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [SupabaseModule, forwardRef(() => ProjectsModule)],
  controllers: [GoogleSheetsController],
  providers: [GoogleSheetsService],
  exports: [GoogleSheetsService],
})
export class GoogleSheetsModule {}
