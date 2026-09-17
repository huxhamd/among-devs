export type TaskStep = { label: string; options: string[]; answer: string };
export type TaskDefinition = {
  kind: 'sequence' | 'matching' | 'repair' | 'incident';
  title: string;
  instructions: string;
  steps: TaskStep[];
};
export type TaskView = Omit<TaskDefinition, 'steps'> & {
  id: string;
  step: number;
  steps: Omit<TaskStep, 'answer'>[];
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
  instructions: 'Attach each acceptance criterion to the ticket it describes.',
  steps: rows.map(([label, answer]) => ({ label, answer, options: rows.map((row) => row[1]) }))
});

export const CI_REPAIR: TaskDefinition = {
  kind: 'incident',
  title: 'Deployment failure',
  instructions:
    'Read the incident clues. Select a recovery action, then select its destination on the board, or drag it there. Recover from left to right; everyone shares this board.',
  steps: [
    {
      label: 'Pipeline',
      answer: 'Pause pipeline',
      options: ['Clear bad deployment', 'Run health check', 'Pause pipeline']
    },
    {
      label: 'Deployment',
      answer: 'Clear bad deployment',
      options: ['Clear bad deployment', 'Run health check', 'Pause pipeline']
    },
    {
      label: 'Health',
      answer: 'Run health check',
      options: ['Clear bad deployment', 'Run health check', 'Pause pipeline']
    }
  ]
};

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
    steps: definition.steps.map(({ label, options }) => ({
      label,
      options: order.filter((i) => i < options.length).map((i) => options[i])
    }))
  };
}
