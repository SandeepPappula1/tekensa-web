// Public client configuration. The anon key is designed to ship to browsers;
// every wall is RLS on the server (packages/server/migrations/0007).
window.DUMP_CONFIG = {
  supabaseUrl: 'https://mahlfdtxrnrrqgyhzjhs.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1haGxmZHR4cm5ycnFneWh6amhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTU2NzAsImV4cCI6MjEwNDQzMTY3MH0.ool1fXX0_d2aaTGi0rZD7zhN6qlec-euDM79-HfrK0A',
  ingestUrl: 'https://mahlfdtxrnrrqgyhzjhs.supabase.co/functions/v1/ingest',
  eraseUrl: 'https://mahlfdtxrnrrqgyhzjhs.supabase.co/functions/v1/erase-account',
  linkedNoticeUrl: 'https://mahlfdtxrnrrqgyhzjhs.supabase.co/functions/v1/linked-notice',
};
