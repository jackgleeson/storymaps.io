// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Projects: maps grouped under one name and shown as tabs, reached at /p/<project id>.
//
// A project lives only in these two tables, next to the map index. Nothing here reads or
// writes the data inside a map, so a project can't change what is on a map. A map can be in any
// number of projects, and a plain map link never shows them: only a project link does. Like a
// map ID, a project ID is a public link, and anyone who has the link can change the tabs. A
// project only goes when it is deleted on purpose: removing the last map leaves the project empty.

export const MAX_PROJECT_MAPS = 20;
export const MAX_PROJECT_NAME = 100;
// The name a new project starts with, until someone renames it
export const DEFAULT_PROJECT_NAME = 'Untitled project';

// Same characters the router allows in an ID
const ID = /^[a-zA-Z0-9_-]{1,64}$/;

export class ProjectError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Trim, drop control characters and collapse runs of spaces
const cleanName = (name) => (typeof name === 'string' ? name : '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const createProjects = (sqlite, { generateId }) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_maps (
      project_id TEXT NOT NULL,
      map_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (project_id, map_id)
    );
    CREATE INDEX IF NOT EXISTS project_maps_by_map ON project_maps (map_id);
  `);

  const q = {
    mapExists: sqlite.prepare('SELECT 1 FROM maps WHERE id = ?'),
    project: sqlite.prepare('SELECT name FROM projects WHERE id = ?'),
    members: sqlite.prepare(`
      SELECT pm.map_id AS id, m.name AS name FROM project_maps pm
      LEFT JOIN maps m ON m.id = pm.map_id
      WHERE pm.project_id = ? ORDER BY pm.position, pm.added_at
    `),
    isMember: sqlite.prepare('SELECT 1 FROM project_maps WHERE project_id = ? AND map_id = ?'),
    count: sqlite.prepare('SELECT COUNT(*) AS n FROM project_maps WHERE project_id = ?'),
    lastPosition: sqlite.prepare('SELECT MAX(position) AS p FROM project_maps WHERE project_id = ?'),
    projectsOfMap: sqlite.prepare('SELECT project_id FROM project_maps WHERE map_id = ?'),
    insertProject: sqlite.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'),
    touch: sqlite.prepare('UPDATE projects SET updated_at = ? WHERE id = ?'),
    rename: sqlite.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?'),
    insertMember: sqlite.prepare('INSERT INTO project_maps (project_id, map_id, position, added_at) VALUES (?, ?, ?, ?)'),
    removeMember: sqlite.prepare('DELETE FROM project_maps WHERE project_id = ? AND map_id = ?'),
    removeMapEverywhere: sqlite.prepare('DELETE FROM project_maps WHERE map_id = ?'),
    removeAllMaps: sqlite.prepare('DELETE FROM project_maps WHERE project_id = ?'),
    setPosition: sqlite.prepare('UPDATE project_maps SET position = ? WHERE project_id = ? AND map_id = ?'),
    position: sqlite.prepare('SELECT position FROM project_maps WHERE project_id = ? AND map_id = ?'),
    makeRoomAfter: sqlite.prepare('UPDATE project_maps SET position = position + 1 WHERE project_id = ? AND position > ?'),
    deleteProject: sqlite.prepare('DELETE FROM projects WHERE id = ?'),
  };

  const checkId = (id, what) => {
    if (typeof id !== 'string' || !ID.test(id)) throw new ProjectError(400, `Not a ${what} ID`);
  };

  // A map the server has never seen can't join a project
  const checkMap = (mapId) => {
    checkId(mapId, 'map');
    if (!q.mapExists.get(mapId)) throw new ProjectError(404, 'Map not found');
  };

  // A name given when a project starts or is renamed: cleaned, and not empty or too long
  const checkName = (name) => {
    const clean = cleanName(name);
    if (!clean) throw new ProjectError(400, 'Enter a project name');
    if (clean.length > MAX_PROJECT_NAME) throw new ProjectError(400, `Use up to ${MAX_PROJECT_NAME} characters`);
    return clean;
  };

  const requireProject = (projectId) => {
    checkId(projectId, 'project');
    if (!q.project.get(projectId)) throw new ProjectError(404, 'Project not found');
  };

  const view = (projectId) => {
    const project = q.project.get(projectId);
    if (!project) return null;
    return {
      id: projectId,
      name: project.name,
      maps: q.members.all(projectId).map(({ id, name }) => ({ id, name: name && name !== 'untitled' ? name : '' })),
    };
  };

  const newProjectId = () => {
    for (let i = 0; i < 10; i++) {
      const id = generateId();
      if (!q.project.get(id)) return id;
    }
    throw new Error('Failed to generate unique project ID');
  };

  // A map joins at the end, or straight after another map in the project when one is named
  const addMember = (projectId, mapId, now, after) => {
    if (q.isMember.get(projectId, mapId)) throw new ProjectError(409, 'That map is already in this project');
    if (q.count.get(projectId).n >= MAX_PROJECT_MAPS) {
      throw new ProjectError(400, `A project holds up to ${MAX_PROJECT_MAPS} maps`);
    }
    const before = after == null ? null : q.position.get(projectId, after);
    if (after != null && !before) throw new ProjectError(404, 'That map is not in this project');
    if (before) q.makeRoomAfter.run(projectId, before.position);
    q.insertMember.run(projectId, mapId, before ? before.position + 1 : (q.lastPosition.get(projectId).p ?? -1) + 1, now);
  };

  // The project, or null when there is no project with that ID
  const get = (projectId) => {
    checkId(projectId, 'project');
    return view(projectId);
  };

  // Start a project with the given maps, in that order. With no name it starts untitled.
  const create = sqlite.transaction((mapIds, name) => {
    if (!Array.isArray(mapIds) || mapIds.length === 0) throw new ProjectError(400, 'A project starts with at least one map');
    if (mapIds.length > MAX_PROJECT_MAPS) throw new ProjectError(400, `A project holds up to ${MAX_PROJECT_MAPS} maps`);
    if (new Set(mapIds).size !== mapIds.length) throw new ProjectError(400, 'A map can be in a project once');
    mapIds.forEach(checkMap);
    const projectName = cleanName(name) ? checkName(name) : DEFAULT_PROJECT_NAME;
    const now = new Date().toISOString();
    const projectId = newProjectId();
    q.insertProject.run(projectId, projectName, now, now);
    mapIds.forEach(mapId => addMember(projectId, mapId, now));
    return view(projectId);
  });

  // Add a map, at the end or after the map named in after (a copy goes next to the original)
  const add = sqlite.transaction((projectId, mapId, after) => {
    requireProject(projectId);
    checkMap(mapId);
    if (after != null) checkId(after, 'map');
    const now = new Date().toISOString();
    addMember(projectId, mapId, now, after);
    q.touch.run(now, projectId);
    return view(projectId);
  });

  // Take a map out of the project. The map itself is untouched, and a project left with no
  // maps stays until it is deleted.
  const remove = sqlite.transaction((projectId, mapId) => {
    requireProject(projectId);
    checkId(mapId, 'map');
    if (!q.isMember.get(projectId, mapId)) throw new ProjectError(404, 'That map is not in this project');
    q.removeMember.run(projectId, mapId);
    q.touch.run(new Date().toISOString(), projectId);
    return view(projectId);
  });

  // Delete the project. The maps that were in it are untouched.
  const destroy = sqlite.transaction((projectId) => {
    requireProject(projectId);
    q.removeAllMaps.run(projectId);
    q.deleteProject.run(projectId);
    return null;
  });

  // Put the maps in the given order. The list has to name every map in the project once.
  const reorder = sqlite.transaction((projectId, mapIds) => {
    requireProject(projectId);
    const current = q.members.all(projectId).map(m => m.id);
    const same = Array.isArray(mapIds)
      && mapIds.length === current.length
      && new Set(mapIds).size === mapIds.length
      && mapIds.every(id => current.includes(id));
    if (!same) throw new ProjectError(409, 'The maps in this project have changed. Try again.');
    mapIds.forEach((id, i) => q.setPosition.run(i, projectId, id));
    q.touch.run(new Date().toISOString(), projectId);
    return view(projectId);
  });

  const rename = sqlite.transaction((projectId, name) => {
    requireProject(projectId);
    q.rename.run(checkName(name), new Date().toISOString(), projectId);
    return view(projectId);
  });

  // For deleting a map from the server: take it out of every project it's in, leaving the
  // projects in place. Returns how many.
  const forget = sqlite.transaction((mapId) => q.removeMapEverywhere.run(mapId).changes);

  // How many projects a map is in, for the report from the delete script
  const countForMap = (mapId) => q.projectsOfMap.all(mapId).length;

  return { get, create, add, remove, destroy, reorder, rename, forget, countForMap };
};
