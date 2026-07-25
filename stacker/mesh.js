export function createMaskMesh(mask) {
  const topRects = [];
  for (let z = 0; z < mask.length; z += 1) {
    for (let x = 0; x < mask[z].length; x += 1) {
      if (mask[z][x] === "#") topRects.push(Object.freeze({ x, z, width: 1, depth: 1 }));
    }
  }
  const edges = extractVisibleEdges(topRects);
  return Object.freeze({
    topRects: Object.freeze(topRects),
    xEdges: edges.x,
    zEdges: edges.z,
  });
}

export function extractVisibleEdges(rects) {
  const xEdges = [];
  const zEdges = [];

  for (const rect of rects) {
    const x = rect.x + rect.width;
    const z = rect.z + rect.depth;
    const xBlockers = rects
      .filter((other) => other.x === x)
      .map((other) => [other.z, other.z + other.depth]);
    const zBlockers = rects
      .filter((other) => other.z === z)
      .map((other) => [other.x, other.x + other.width]);

    for (const [start, end] of subtractIntervals(rect.z, z, xBlockers)) {
      xEdges.push({ constant: x, start, end });
    }
    for (const [start, end] of subtractIntervals(rect.x, x, zBlockers)) {
      zEdges.push({ constant: z, start, end });
    }
  }

  return Object.freeze({
    x: Object.freeze(mergeCollinear(xEdges).map(freezeEdge)),
    z: Object.freeze(mergeCollinear(zEdges).map(freezeEdge)),
  });
}

function subtractIntervals(start, end, blockers) {
  let visible = [[start, end]];
  for (const [blockStart, blockEnd] of blockers) {
    const next = [];
    for (const [visibleStart, visibleEnd] of visible) {
      if (blockEnd <= visibleStart || blockStart >= visibleEnd) {
        next.push([visibleStart, visibleEnd]);
        continue;
      }
      if (blockStart > visibleStart) next.push([visibleStart, Math.min(blockStart, visibleEnd)]);
      if (blockEnd < visibleEnd) next.push([Math.max(blockEnd, visibleStart), visibleEnd]);
    }
    visible = next;
  }
  return visible;
}

function mergeCollinear(edges) {
  const ordered = edges
    .filter((edge) => edge.end > edge.start)
    .sort((a, b) => a.constant - b.constant || a.start - b.start || a.end - b.end);
  const merged = [];
  for (const edge of ordered) {
    const previous = merged.at(-1);
    if (previous && previous.constant === edge.constant && edge.start <= previous.end) {
      previous.end = Math.max(previous.end, edge.end);
    } else {
      merged.push({ ...edge });
    }
  }
  return merged;
}

function freezeEdge(edge) {
  return Object.freeze({ constant: edge.constant, start: edge.start, end: edge.end });
}
