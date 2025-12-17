import { Module, forwardRef } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { InternalDocumentsController } from './internal-documents.controller';
import { DocumentsService } from './documents.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { ProjectsModule } from '../projects/projects.module';
import { GoogleDocsModule } from '../google-docs/google-docs.module';

@Module({
  imports: [
    SupabaseModule,
    forwardRef(() => ProjectsModule),
    GoogleDocsModule,
  ],
  controllers: [DocumentsController, InternalDocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}

