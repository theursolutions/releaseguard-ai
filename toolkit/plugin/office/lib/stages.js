// Which room of the office each agent works in, and the name shown above its head.
// The pipeline order is: triage → plan → build → qa → regression → review.

const ROOMS = [
  { id: 'triage', label: 'Reception', hint: 'The router reads the request and picks the crew' },
  { id: 'plan', label: 'Planning room', hint: 'Requirements and the implementation plan' },
  { id: 'build', label: 'Dev floor', hint: 'Backend, frontend and 3D developers' },
  { id: 'qa', label: 'QA lab', hint: 'Unit, feature and end-to-end tests' },
  { id: 'regression', label: 'Regression bay', hint: 'Full test suite against the starting point' },
  { id: 'review', label: 'Review desk', hint: 'Code review before hand-back' },
];

const AGENTS = {
  router: { stage: 'triage', label: 'Router' },
  planner: { stage: 'plan', label: 'Planner' },
  'prd-analyst': { stage: 'plan', label: 'PRD Analyst' },
  Plan: { stage: 'plan', label: 'Planner' },
  Explore: { stage: 'plan', label: 'Explorer' },
  developer: { stage: 'build', label: 'Developer' },
  'frontend-developer': { stage: 'build', label: 'Frontend Dev' },
  'frontend-3d-developer': { stage: 'build', label: '3D Dev' },
  'test-engineer': { stage: 'qa', label: 'Test Engineer' },
  'qa-automation': { stage: 'qa', label: 'QA Automation' },
  'regression-tester': { stage: 'regression', label: 'Regression' },
  'code-reviewer': { stage: 'review', label: 'Reviewer' },
};

/** "devcrew:frontend-developer" → "frontend-developer". Plugin agents arrive with their plugin prefix. */
function baseType(type) {
  const value = String(type || '');
  return value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value;
}

function stageFor(type) {
  return AGENTS[baseType(type)]?.stage || 'build';
}

function labelFor(type) {
  const base = baseType(type);
  if (AGENTS[base]) return AGENTS[base].label;
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Agent';
}

module.exports = { ROOMS, AGENTS, baseType, stageFor, labelFor };
