import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [SupabaseModule, ProjectsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

