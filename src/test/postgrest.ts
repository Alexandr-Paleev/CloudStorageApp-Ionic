import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let answer: () => Promise<Response> = () => Promise.reject(new Error('no answer set'));
let client: SupabaseClient | null = null;

/**
 * A failed query, as the app is handed one.
 *
 * A real supabase-js client asks, and `respond` answers in PostgREST's place.
 * What comes back is the object postgrest-js builds, not a copy of it written
 * by hand, which could agree with the code under test and with nothing else.
 * The request is an insert: postgrest-js asks again when the network fails on
 * a read, and not on an insert.
 *
 * One client for every call: a second one in the same page makes supabase-js
 * warn that two of them share a session.
 */
export async function failedQuery(respond: () => Promise<Response>): Promise<unknown> {
  answer = respond;
  client ??= createClient('https://project.supabase.co', 'test-anon-key', {
    global: { fetch: () => answer() },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.from('files').insert({ name: 'report.pdf' }).select().single();
  return error;
}

/** PostgREST's answer when the database refused a statement. */
export function refused(code: string, message: string, status = 400): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ code, details: null, hint: null, message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    );
}
