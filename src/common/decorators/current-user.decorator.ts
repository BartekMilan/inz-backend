import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestUser } from '../guards/auth.guard';

export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: RequestUser = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
