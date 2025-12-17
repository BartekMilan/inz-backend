import { Module } from '@nestjs/common';
import { GoogleDocsService } from './google-docs.service';

@Module({
  providers: [GoogleDocsService],
  exports: [GoogleDocsService],
})
export class GoogleDocsModule {}

