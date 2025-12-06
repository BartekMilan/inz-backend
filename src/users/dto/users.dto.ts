import { IsBoolean, IsOptional, IsUUID, ValidateIf } from 'class-validator';

// =====================================================
// USER MANAGEMENT DTOs
// =====================================================

export class UpdateUserApprovalDto {
  @IsBoolean()
  @IsOptional()
  isApproved?: boolean;

  @ValidateIf((o) => o.assignedProjectId !== null)
  @IsUUID()
  @IsOptional()
  assignedProjectId?: string | null;
}

export class UserResponseDto {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  isApproved: boolean;
  assignedProjectId?: string | null;
  assignedProjectName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export class UserListResponseDto {
  users: UserResponseDto[];
  total: number;
}

