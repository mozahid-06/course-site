import test from 'node:test';
import assert from 'node:assert/strict';
import { childDirsFromIds } from './files.js';

const IDS = [
  'Course/ক্লাস করার নিয়ম/Vedio',   // folder directly under the course
  'Course/Section/Sub/lesson',       // nested -> only the top segment
  'Course/top-level-lesson',         // directly in Course -> not a folder
  'Other/Thing/x',                   // another course -> excluded
];

test('childDirsFromIds finds folder segments under the parent', () => {
  assert.deepEqual(childDirsFromIds('Course', IDS), ['Course/ক্লাস করার নিয়ম', 'Course/Section']);
  assert.deepEqual(childDirsFromIds('Course/Section', IDS), ['Course/Section/Sub']);
  assert.deepEqual(childDirsFromIds('', IDS), ['Course', 'Other']);
});

test('childDirsFromIds never treats a lesson in place, or _resources, as a folder', () => {
  assert.deepEqual(childDirsFromIds('C', ['C/lesson', 'C/_resources/x']), []);
});
