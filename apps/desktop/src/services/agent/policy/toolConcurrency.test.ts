import { describe, expect, it } from 'vitest';
import { isConcurrencySafe, MAX_PARALLEL_TOOL_CALLS } from './toolConcurrency';

describe('toolConcurrency', () => {
  it('parallélise les lectures et recherches, pas les effets de bord', () => {
    for (const name of ['read_file', 'list_dir', 'glob', 'search_files', 'get_diagnostics', 'web_search', 'read_url']) {
      expect(isConcurrencySafe(name), name).toBe(true);
    }
    for (const name of ['write_file', 'edit_file', 'apply_patch', 'bash', 'run_command', 'task_done', 'ask_user', 'spawn_agent', 'capture_page', 'check_page', 'job_kill', 'start_dev_server']) {
      expect(isConcurrencySafe(name), name).toBe(false);
    }
    expect(MAX_PARALLEL_TOOL_CALLS).toBe(10);
  });
});
