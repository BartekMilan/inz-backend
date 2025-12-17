import { Controller, Post, UseGuards } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { ProcessDocumentTasksResponseDto } from './dto';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { Public } from '../common/decorators/public.decorator';

@Controller('internal/documents')
export class InternalDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Endpoint do przetwarzania tasków generowania dokumentów (wywoływany przez cron)
   * Endpoint: POST /internal/documents/tasks/run
   * Autoryzacja: X-CRON-SECRET header (pomija standardową autoryzację)
   */
  @Post('tasks/run')
  @Public()
  @UseGuards(CronSecretGuard)
  async runDocumentTasks(): Promise<ProcessDocumentTasksResponseDto> {
    return this.documentsService.processDocumentTasks();
  }
}

