export const DRILL_PIPE_FIELDS = [
  { key: 'outerDiameter', label: 'Outer Diameter', type: 'number', required: true },
  { key: 'wallThickness', label: 'Wall Thickness', type: 'number', required: true },
  { key: 'threadCondition', label: 'Thread Condition', type: 'select', options: ['GOOD', 'DAMAGED'], required: true },
  { key: 'remarks', label: 'Remarks', type: 'text', required: false }
];
