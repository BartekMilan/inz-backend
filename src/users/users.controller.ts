import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import {
  UpdateUserApprovalDto,
  UserResponseDto,
  UserListResponseDto,
} from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/guards/auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Get all users (admin only)
   */
  @Get()
  @Roles(Role.ADMIN)
  async getAllUsers(
    @CurrentUser() user: RequestUser,
  ): Promise<UserListResponseDto> {
    return this.usersService.getAllUsers(user.id);
  }

  /**
   * Update user approval status and/or project assignment (admin only)
   */
  @Put(':userId/approval')
  @Roles(Role.ADMIN)
  async updateUserApproval(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() updateDto: UpdateUserApprovalDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UserResponseDto> {
    return this.usersService.updateUserApproval(user.id, targetUserId, updateDto);
  }

  /**
   * Delete a user (admin only)
   * Prevents self-deletion
   */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  async deleteUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.usersService.deleteUser(user.id, targetUserId);
  }
}

