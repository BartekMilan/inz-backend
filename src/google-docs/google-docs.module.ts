import { Module } from '@nestjs/common';
import { GoogleDocsService } from './google-docs.service';
import { GoogleDocsController } from './google-docs.controller';

@Module({
  providers: [GoogleDocsService],
  controllers: [GoogleDocsController],
  exports: [GoogleDocsService],
})
export class GoogleDocsModule {}

