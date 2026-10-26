import { describe, expect, it } from 'vitest';
import { communityPostError } from '../src/lib/communityErrors.js';

describe('community posting errors', () => {
  it('shows the posting function’s own member-facing messages', () => {
    expect(communityPostError({ code: 'P0001', message: 'Please wait before posting again.' })).toBe('Please wait before posting again.');
  });
  it('never shows database internals such as constraint names', () => {
    const constraint = { code: '23514', message: 'new row for relation "community_posts" violates check constraint "community_posts_display_name_check"' };
    expect(communityPostError(constraint)).toMatch(/^Check your name \(2–40 characters\)/);
    expect(communityPostError(constraint)).not.toMatch(/community_posts/);
    expect(communityPostError({ code: '42501', message: 'permission denied for table community_posts' })).toBe('Could not submit. Please try again.');
    expect(communityPostError(new TypeError('Failed to fetch'))).toBe('Could not submit. Please try again.');
    expect(communityPostError({ code: 'P0001', message: 'x'.repeat(500) })).toBe('Could not submit. Please try again.');
  });
});
