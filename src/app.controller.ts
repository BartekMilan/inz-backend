import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';
import { Roles } from './common/decorators/roles.decorator';
import { CurrentUser } from './common/decorators/current-user.decorator';
import { Role } from './common/enums/role.enum';
import type { RequestUser } from './common/guards/auth.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @Public()
  healthCheck() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Example: Route accessible only by Admin
  @Get('admin-only')
  @Roles(Role.ADMIN)
  adminOnly(@CurrentUser() user: RequestUser) {
    return {
      message: 'Dostęp przyznany - jesteś administratorem',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  // Example: Route accessible only by Registrar
  @Get('registrar-only')
  @Roles(Role.REGISTRAR)
  registrarOnly(@CurrentUser() user: RequestUser) {
    return {
      message: 'Dostęp przyznany - jesteś rejestratorem',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  // Example: Route accessible by both Admin and Registrar
  @Get('authenticated')
  @Roles(Role.ADMIN, Role.REGISTRAR)
  authenticatedRoute(@CurrentUser() user: RequestUser) {
    return {
      message: 'Dostęp przyznany - jesteś zalogowany',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }
}
