export default function register(ctx) {
  const { route } = ctx;
  // The count is the maps in the index, so it can't drift from the maps that are really there
  route('GET', '/api/stats', async (req, res) => {
    const mapCount = ctx.countMaps();
    let activeUsers = 0;
    for (const [, doc] of ctx.docs) {
      activeUsers += doc.awareness.getStates().size;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ mapCount, activeUsers }));
  });

  // Pages opened before the count came from the index still post here when they make a map.
  // A new map already adds its own row, so this only answers with the count.
  route('POST', '/api/stats', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ mapCount: ctx.countMaps() }));
  });
}
