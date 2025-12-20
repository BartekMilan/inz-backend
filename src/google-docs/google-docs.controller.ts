import { Controller, Get } from '@nestjs/common';
import { GoogleDocsService } from './google-docs.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('google-docs')
export class GoogleDocsController {
  constructor(private readonly googleDocsService: GoogleDocsService) {}

  /**
   * Tymczasowy endpoint maintenance do czyszczenia Drive zalogowanego użytkownika OAuth2
   * GET /api/google-docs/maintenance/cleanup
   *
   * Uwaga: operacja destrukcyjna (usuwa wszystkie pliki owned by użytkownika OAuth2).
   */
  @Get('maintenance/cleanup')
  @Roles(Role.ADMIN)
  async cleanupServiceAccountDrive() {
    return this.googleDocsService.cleanupServiceAccountDrive();
  }

  /**
   * Tymczasowy endpoint debug do weryfikacji quota zalogowanego użytkownika OAuth2 (Drive about.get)
   * GET /api/google-docs/maintenance/debug-quota
   */
  @Get('maintenance/debug-quota')
  @Roles(Role.ADMIN)
  async debugQuota() {
    return this.googleDocsService.getAccountUsageDebug();
  }
}

