// Values of the wrong kind in a stored story map: a colour, slice name or legend label that is not
// text, or a name that is a set of fields. The browser cannot draw a map that holds one. New files
// with these are refused (validateYaml in src/transfer/yaml.js), so this finds maps stored before
// that check. It returns where each one is and never the value, so nothing a person typed is logged.
const isObject = (v) => v !== null && typeof v === 'object';

export const findBadValues = (data) => {
  const found = [];
  const card = (where, c) => {
    if (!isObject(c)) return;
    if (c.color != null && typeof c.color !== 'string') found.push(`${where}.color`);
    if (isObject(c.name)) found.push(`${where}.name`);
  };
  const columns = (where, cols) => (Array.isArray(cols) ? cols : []).forEach((col, i) =>
    (Array.isArray(col) ? col : []).forEach((c, j) => card(`${where}[${i}][${j}]`, c)));

  if (isObject(data.name)) found.push('name');
  (data.steps || []).forEach((step, i) => card(`steps[${i}]`, step));
  columns('users', data.users);
  columns('activities', data.activities);
  (data.slices || []).forEach((slice, i) => {
    if (slice.name != null && typeof slice.name !== 'string') found.push(`slices[${i}].name`);
    columns(`slices[${i}].stories`, slice.stories);
  });
  (data.legend || []).forEach((entry, i) => {
    if (entry?.color != null && typeof entry.color !== 'string') found.push(`legend[${i}].color`);
    if (entry?.label != null && typeof entry.label !== 'string') found.push(`legend[${i}].label`);
  });
  (data.partialMaps || []).forEach((pm, i) => {
    const where = `partialMaps[${i}]`;
    (pm.steps || []).forEach((step, j) => card(`${where}.steps[${j}]`, step));
    columns(`${where}.users`, pm.users);
    columns(`${where}.activities`, pm.activities);
    (pm.stories || []).forEach((slice, j) => columns(`${where}.stories[${j}]`, slice));
  });
  return found;
};

// One log line for a map that holds any, with the map link and the fields, at most 10 of them
export const badValuesLine = (mapId, data) => {
  const found = findBadValues(data);
  if (!found.length) return null;
  const shown = found.slice(0, 10).join(', ') + (found.length > 10 ? `, and ${found.length - 10} more` : '');
  return `[${new Date().toISOString()}] [bad-values] ${mapId}: ${found.length} not text: ${shown}`;
};
