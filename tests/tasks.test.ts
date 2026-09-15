import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_VARIANTS, taskView } from '../src/lib/tasks.ts';
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
