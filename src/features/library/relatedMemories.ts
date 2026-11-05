import type { MobileAtlas } from '../../nodes/atlas'

export const relatedMemories = (atlas: MobileAtlas | null, sourceId: string | null) => {
  const selected = atlas?.nodes.find(node => node.sourceId === sourceId)
  if (!selected || !atlas) return []
  const relatedIds = new Set(atlas.edges.flatMap(edge => edge.fromNodeId === selected.id ? [edge.toNodeId] : edge.toNodeId === selected.id ? [edge.fromNodeId] : []))
  return atlas.nodes.filter(node => relatedIds.has(node.id))
}
