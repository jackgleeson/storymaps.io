import { readFileSync, readdirSync } from 'node:fs';

// A map in the shape serialize() and serializeDoc() return, using every field they support
export const fullMap = () => ({
  name: 'Coffee app',
  steps: [
    { name: 'Browse', body: 'The menu', color: '#86efac', url: 'https://example.com/browse', status: 'done', points: 3, tags: ['ux'] },
    { name: 'Order', hidden: true },
    { partialMapId: 'pm000001', partialMapOrigin: true },
  ],
  users: [[{ name: 'Customer', color: '#fca5a5' }], [], []],
  activities: [[{ name: 'Find a drink' }], [{ name: 'Pay' }], []],
  slices: [
    {
      name: 'MVP',
      stories: [[{ name: 'List drinks', status: 'in-progress', points: 0 }], [{ name: 'Card payment', tags: ['payments', 'risky'] }], []],
      goal: 'Take the first order',
      targetDate: '2026-11-14',
    },
    { name: 'Later', stories: [[], [], []], collapsed: true, closedReason: 'complete' },
  ],
  legend: [{ color: '#fef08a', label: 'Tasks' }],
  notes: 'Remember the oat milk',
  partialMaps: [{
    id: 'pm000001',
    name: 'Checkout',
    users: [[]],
    activities: [[{ name: 'Pay up' }]],
    steps: [{ name: 'Pay' }],
    stories: [[[{ name: 'Apple Pay' }]], [[]]],
  }],
});

export const smallMap = () => ({
  name: 'Small',
  steps: [{ name: 'Sign up' }, { name: 'Pay' }],
  users: [[{ name: 'Visitor' }], []],
  activities: [[{ name: 'Join' }], []],
  slices: [{ name: 'MVP', stories: [[{ name: 'Email form' }], []] }],
  legend: [{ color: '#fef08a', label: 'Tasks' }],
});

// The sample maps offered on the welcome screen
const SAMPLES_DIR = new URL('../public/samples/', import.meta.url);
export const samples = () => readdirSync(SAMPLES_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => ({ file: f, data: JSON.parse(readFileSync(new URL(f, SAMPLES_DIR), 'utf8')) }));

// Card names by position, for checking a conversion kept every card where it was
const names = (rows) => (rows || []).map(cards => (cards || []).map(c => c.name));
export const cardLayout = (map) => ({
  steps: (map.steps || []).map(s => s.partialMapId ? { partial: true } : s.name),
  users: names(map.users),
  activities: names(map.activities),
  slices: (map.slices || []).map(s => ({ name: s.name, stories: names(s.stories) })),
});
