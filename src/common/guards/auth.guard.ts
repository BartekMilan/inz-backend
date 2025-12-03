import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Role } from '../enums/role.enum';

export interface RequestUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: Role;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token nie został dostarczony');
    }

    const token = authHeader.substring(7);

    try {
      const user = await this.authService.validateToken(token);

      if (!user) {
        throw new UnauthorizedException('Nieprawidłowy token');
      }

      // Validate and set user role (default to REGISTRAR if not set)
      const userRole = this.validateRole(user.user_metadata?.role);

      // Attach user to request for use in controllers
      const requestUser: RequestUser = {
        id: user.id,
        email: user.email!,
        firstName: user.user_metadata?.first_name,
        lastName: user.user_metadata?.last_name,
        role: userRole,
      };

      request.user = requestUser;

      return true;
    } catch {
      throw new UnauthorizedException('Nieprawidłowy token');
    }
  }

  private validateRole(role: string | undefined): Role {
    if (role && Object.values(Role).includes(role as Role)) {
      return role as Role;
    }
    return Role.REGISTRAR; // Default role
  }
}
