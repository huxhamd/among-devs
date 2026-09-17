export type TaskStep = {
  label: string;
  options: string[];
  answer: string;
  clue?: string;
  recovered?: string;
};
export type TaskDefinition = {
  kind: 'sequence' | 'matching' | 'repair' | 'incident';
  title: string;
  instructions: string;
  steps: TaskStep[];
};
export type TaskView = Omit<TaskDefinition, 'steps'> & {
  id: string;
  step: number;
  steps: (Omit<TaskStep, 'answer'> & { completedAction?: string })[];
};

const sequence = (title: string, steps: string[]): TaskDefinition => ({
  kind: 'sequence',
  title,
  instructions: 'Follow the runbook from top to bottom. Select each operation in order.',
  steps: steps.map((answer) => ({ label: answer, options: [...steps], answer }))
});
const repair = (title: string, rows: [string, string, string[]][]): TaskDefinition => ({
  kind: 'repair',
  title,
  instructions:
    'Configure each control to match its requested setting. Apply one setting at a time.',
  steps: rows.map(([label, answer, options]) => ({
    label: `${label}: set to ${answer}`,
    answer,
    options
  }))
});
const matching = (title: string, rows: [string, string][]): TaskDefinition => ({
  kind: 'matching',
  title,
  instructions: 'Match each acceptance criterion to the ticket it describes.',
  steps: rows.map(([label, answer]) => ({ label, answer, options: rows.map((row) => row[1]) }))
});

const incident = (
  title: string,
  rows: [label: string, answer: string, clue: string, recovered: string][]
): TaskDefinition => {
  const options = rows.map(([, answer]) => answer);
  return {
    kind: 'incident',
    title,
    instructions:
      'Read the incident clues. Select a recovery action, then select its destination on the board, or drag it there. Recover from left to right; everyone shares this board.',
    steps: rows.map(([label, answer, clue, recovered]) => ({
      label,
      answer,
      clue,
      recovered,
      options
    }))
  };
};

export const CI_REPAIR_VARIANTS: TaskDefinition[] = [
  incident('Deployment failure', [
    [
      'Pipeline',
      'Pause pipeline',
      'New jobs keep sending the broken release. Stop incoming work first.',
      'Pipeline paused'
    ],
    [
      'Deployment',
      'Clear bad deployment',
      'The failed release is still deployed. Remove it once incoming work has stopped.',
      'Bad deployment cleared'
    ],
    [
      'Health',
      'Run health check',
      'Service recovery is unverified. Test it after removing the failed release.',
      'Health verified'
    ]
  ]),
  incident('Faulty release rollout', [
    [
      'Rollout',
      'Stop rollout',
      'More instances are receiving the faulty version. Halt the rollout first.',
      'Rollout stopped'
    ],
    [
      'Release',
      'Roll back release',
      'The faulty version is still serving traffic. Restore the previous release.',
      'Previous release restored'
    ],
    [
      'Smoke tests',
      'Run smoke tests',
      'The restored release has not been exercised. Test its critical paths.',
      'Smoke tests passed'
    ]
  ]),
  incident('Corrupted build artifact', [
    [
      'Deploy job',
      'Disable deploy job',
      'The job can publish the corrupted artifact again. Disable it first.',
      'Deploy job disabled'
    ],
    [
      'Artifact',
      'Remove failed artifact',
      'The corrupted package remains available to deploy. Remove it from storage.',
      'Failed artifact removed'
    ],
    [
      'Service',
      'Verify service health',
      'The running service needs validation after the bad package is removed.',
      'Service health verified'
    ]
  ]),
  incident('Configuration regression', [
    [
      'Deployments',
      'Freeze deployments',
      'Further releases could spread the bad configuration. Freeze them first.',
      'Deployments frozen'
    ],
    [
      'Configuration',
      'Restore known-good config',
      'The regressed values are still active. Restore the last known-good set.',
      'Known-good config restored'
    ],
    [
      'Validation',
      'Validate configuration',
      'The restored values have not been checked against the running service.',
      'Configuration validated'
    ]
  ]),
  incident('Unhealthy canary release', [
    [
      'Traffic',
      'Drain canary traffic',
      'Users are still reaching the unhealthy canary. Drain its traffic first.',
      'Canary traffic drained'
    ],
    [
      'Canary',
      'Revert canary release',
      'The unhealthy version remains on the canary instances. Revert it.',
      'Canary release reverted'
    ],
    [
      'Monitoring',
      'Check error rates',
      'Recovery is not confirmed until production errors return to normal.',
      'Error rates normal'
    ]
  ]),
  incident('Stuck deployment runner', [
    [
      'Queue',
      'Pause deployment queue',
      'Queued releases keep reaching the stuck runner. Pause the queue first.',
      'Deployment queue paused'
    ],
    [
      'Runner',
      'Restart deploy runner',
      'The runner remains wedged after its queue is paused. Restart it safely.',
      'Deploy runner restarted'
    ],
    [
      'Pipeline',
      'Run deployment probe',
      'The restarted runner has not processed a safe probe deployment yet.',
      'Deployment probe passed'
    ]
  ])
];

// Retained as the original runbook for callers that need a representative incident.
export const CI_REPAIR = CI_REPAIR_VARIANTS[0];

export const TASK_VARIANTS: Record<string, TaskDefinition[]> = {
  merge: [
    sequence('Merge the profile changes', [
      'Fetch both branches',
      'Keep the new avatar and display name',
      'Run profile tests',
      'Commit the resolved merge'
    ]),
    sequence('Merge the checkout changes', [
      'Fetch both branches',
      'Keep the basket and discount changes',
      'Run checkout tests',
      'Commit the resolved merge'
    ])
  ],
  build: [
    repair('Recover the office server', [
      ['Traffic', 'Drained', ['Live', 'Drained']],
      ['Power', 'Restart', ['Sleep', 'Restart', 'Off']],
      ['Health check', 'HTTP', ['HTTP', 'Disk']],
      ['Traffic', 'Live', ['Live', 'Drained']]
    ]),
    repair('Recover the build worker', [
      ['Queue', 'Paused', ['Running', 'Paused']],
      ['Cache', 'Clear', ['Keep', 'Clear']],
      ['Worker', 'Restart', ['Off', 'Restart']],
      ['Queue', 'Running', ['Running', 'Paused']]
    ])
  ],
  coffee: [
    repair('Prepare the morning coffee', [
      ['Water', 'Full', ['Empty', 'Half', 'Full']],
      ['Beans', 'Regular', ['Regular', 'Decaf']],
      ['Strength', 'Medium', ['Mild', 'Medium', 'Strong']],
      ['Cups', 'Three', ['One', 'Two', 'Three']]
    ]),
    repair('Prepare the afternoon coffee', [
      ['Water', 'Half', ['Empty', 'Half', 'Full']],
      ['Beans', 'Decaf', ['Regular', 'Decaf']],
      ['Strength', 'Mild', ['Mild', 'Medium', 'Strong']],
      ['Cups', 'Two', ['One', 'Two', 'Three']]
    ])
  ],
  ticket: [
    matching('Triage the customer backlog', [
      ['A reset link expires after 15 minutes.', 'Password reset'],
      ['Items remain after refreshing the page.', 'Saved basket'],
      ['The downloaded file includes column headings.', 'CSV export'],
      ['A receipt arrives after successful payment.', 'Payment email']
    ]),
    matching('Triage the office backlog', [
      ['A colleague can choose a new profile picture.', 'Avatar upload'],
      ['Only available desks can be reserved.', 'Desk booking'],
      ['Unread messages show a count.', 'Inbox badge'],
      ['Results narrow as a name is entered.', 'People search']
    ])
  ]
};

export function taskView(
  definition: TaskDefinition,
  id: string,
  step: number,
  order: number[]
): TaskView {
  return {
    id,
    kind: definition.kind,
    title: definition.title,
    instructions: definition.instructions,
    step,
    steps: definition.steps.map(({ label, options, clue, recovered, answer }, index) => ({
      label,
      options: order.filter((i) => i < options.length).map((i) => options[i]),
      ...(clue ? { clue } : {}),
      ...(recovered ? { recovered } : {}),
      ...(index < step ? { completedAction: answer } : {})
    }))
  };
}
