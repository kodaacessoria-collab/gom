interface PointSector { operationId: string; sectorId: string }
interface SectorReference { id: string; operationId: string; name: string }
const nameKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

// Older registrations can retain another operation's sector ID. Resolve only
// an equivalent, unique sector within the point's own operation.
export function resolveDeliveryPointSectors<T extends PointSector>(points: T[], sectors: SectorReference[]): T[] {
  const byId = new Map(sectors.map(sector => [sector.id, sector]));
  return points.map(point => {
    const current = byId.get(point.sectorId);
    if (current?.operationId === point.operationId) return point;
    const candidates = sectors.filter(sector => sector.operationId === point.operationId &&
      (current ? nameKey(sector.name) === nameKey(current.name) :
        /^.+_setor_01$/.test(point.sectorId) && sector.id === `${point.operationId}_setor_01`));
    return candidates.length === 1 ? { ...point, sectorId: candidates[0].id } : point;
  });
}
