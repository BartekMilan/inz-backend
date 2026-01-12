import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedSecret = request.headers['x-cron-secret'];

    const expectedSecret = process.env.CRON_RUNNER_SECRET;

    if (!expectedSecret) {
      throw new UnauthorizedException(
        'CRON_RUNNER_SECRET nie jest skonfigurowany w zmiennych środowiskowych',
      );
    }

    if (!providedSecret || providedSecret !== expectedSecret) {
      throw new UnauthorizedException('Nieprawidłowy secret cron');
    }

    return true;
  }
}









