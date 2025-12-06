import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private supabase: SupabaseClient;
  private supabaseAdmin: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase URL and Service Role Key must be provided');
    }

    // Use service role key for all operations since RLS is disabled
    // The backend is responsible for all authorization logic
    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Admin client is now the same as regular client (both use service role key)
    this.supabaseAdmin = this.supabase;
  }

  /**
   * Returns Supabase client using service role key.
   * Since RLS is disabled, all authorization is handled by the backend.
   */
  getClient(): SupabaseClient {
    return this.supabase;
  }

  /**
   * Returns admin client (same as getClient since RLS is disabled).
   * Kept for backward compatibility.
   */
  getAdminClient(): SupabaseClient {
    return this.supabase;
  }

  // Helper method to get client with user's access token (for RLS)
  getClientWithAuth(accessToken: string): SupabaseClient {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_ANON_KEY');

    return createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });
  }
}
