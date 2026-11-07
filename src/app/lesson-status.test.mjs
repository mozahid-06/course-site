import test from 'node:test';
import assert from 'node:assert/strict';
import { statusMark } from './lesson-status.ts';

test('a folder never gets a completion mark', () => {
  assert.equal(statusMark('folder', false), 'none');
  assert.equal(statusMark('folder', true), 'none');
});

test('a lesson is empty when not done and done when done', () => {
  assert.equal(statusMark('video', false), 'empty');
  assert.equal(statusMark('pdf', false), 'empty');
  assert.equal(statusMark('youtube', false), 'empty');
  assert.equal(statusMark('video', true), 'done');
  assert.equal(statusMark('pdf', true), 'done');
  assert.equal(statusMark('youtube', true), 'done');
});
