import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CI_REPAIR_VARIANTS, TASK_VARIANTS, taskView } from '../src/lib/tasks.ts';
import { STATIONS } from '../src/lib/shared.ts';

test('every workstation has two solvable variants with private solutions and shuffled choices', () => {
  for (const station of STATIONS) {
    assert.equal(TASK_VARIANTS[station.id].length, 2);
    for (const definition of TASK_VARIANTS[station.id]) {
      const view = taskView(definition, 'instance', 0, [3, 2, 1, 0]);
      assert.equal(view.steps.length, 4);
      definition.steps.forEach((step, index) => {
        assert.equal(step.options.filter((option) => option === step.answer).length, 1);
        assert.deepEqual(view.steps[index].options, [...step.options].reverse());
        assert.equal('answer' in view.steps[index], false);
      });
    }
  }
});

test('CI incidents expose coherent clues while keeping unresolved actions private', () => {
  assert.equal(CI_REPAIR_VARIANTS.length, 6);
  assert.equal(new Set(CI_REPAIR_VARIANTS.map((variant) => variant.title)).size, 6);
  for (const definition of CI_REPAIR_VARIANTS) {
    assert.equal(definition.kind, 'incident');
    assert.equal(definition.steps.length, 3);
    const answers = definition.steps.map((step) => step.answer);
    assert.equal(new Set(answers).size, 3);
    for (const step of definition.steps) {
      assert.ok(step.clue);
      assert.ok(step.recovered);
      assert.deepEqual(step.options, answers);
    }
    const view = taskView(definition, 'incident', 1, [2, 0, 1]);
    assert.deepEqual(view.steps[0].options, [answers[2], answers[0], answers[1]]);
    assert.equal(view.steps[0].completedAction, answers[0]);
    assert.equal('completedAction' in view.steps[1], false);
    assert.ok(view.steps.every((step) => !('answer' in step)));
  }
});
