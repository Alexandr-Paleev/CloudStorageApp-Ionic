import type { VercelRequest } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function authenticateUser(req: VercelRequest): Promise<string> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('Missing authorization token');

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Invalid or expired token');
  return user.id;
}

export { supabase };
