export type InterpolatedPosition = { x: number; y: number };

type PositionSample = InterpolatedPosition & { at: number };

export class PositionInterpolator {
  private tracks = new Map<string, PositionSample[]>();
  private latestSnapshotAt = 0;
  private latestArrivalAt = 0;
  private readonly delay: number;

  constructor(delay = 100) {
    this.delay = delay;
  }

  reset() {
    this.tracks.clear();
    this.latestSnapshotAt = 0;
    this.latestArrivalAt = 0;
  }

  addSnapshot(
    players: readonly (InterpolatedPosition & { id: string; visible: boolean })[],
    snapshotAt: number,
    arrivalAt: number
  ) {
    if (!Number.isFinite(snapshotAt) || !Number.isFinite(arrivalAt)) return;

    this.latestSnapshotAt = snapshotAt;
    this.latestArrivalAt = arrivalAt;
    const present = new Set(players.map((player) => player.id));

    for (const id of this.tracks.keys()) {
      if (!present.has(id)) this.tracks.delete(id);
    }

    for (const player of players) {
      if (!player.visible) {
        // Hidden coordinates are deliberately withheld by the server. Discard the old
        // track so a player who reappears never moves from their last known location.
        this.tracks.delete(player.id);
        continue;
      }

      const sample = { x: player.x, y: player.y, at: snapshotAt };
      const track = this.tracks.get(player.id);
      if (!track || track.at(-1)!.at >= snapshotAt) {
        this.tracks.set(player.id, [sample]);
        continue;
      }

      track.push(sample);
      if (track.length > 4) track.shift();
    }
  }

  positions(arrivalAt: number, interpolate = true): Record<string, InterpolatedPosition> {
    const result: Record<string, InterpolatedPosition> = {};
    const renderAt = interpolate
      ? this.latestSnapshotAt + (arrivalAt - this.latestArrivalAt) - this.delay
      : Number.POSITIVE_INFINITY;

    for (const [id, track] of this.tracks) {
      const first = track[0];
      const last = track.at(-1)!;
      if (renderAt <= first.at) {
        result[id] = { x: first.x, y: first.y };
        continue;
      }
      if (renderAt >= last.at) {
        result[id] = { x: last.x, y: last.y };
        continue;
      }

      for (let index = 1; index < track.length; index++) {
        const next = track[index];
        if (renderAt > next.at) continue;
        const previous = track[index - 1];
        const progress = (renderAt - previous.at) / (next.at - previous.at);
        result[id] = {
          x: previous.x + (next.x - previous.x) * progress,
          y: previous.y + (next.y - previous.y) * progress
        };
        break;
      }
    }

    return result;
  }
}
