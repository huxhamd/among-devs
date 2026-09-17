// Page-local office layouts. Fixtures use the same footprint for drawing and collision.
export type Rect = { x: number; y: number; w: number; h: number };
export const FIXTURE_TYPES = {
  desk: { name: 'Desk', w: 110, h: 54, blocking: true, opaque: false },
  table: { name: 'Meeting table', w: 160, h: 80, blocking: true, opaque: false },
  bookcase: { name: 'Bookcase', w: 110, h: 36, blocking: true, opaque: true },
  rack: { name: 'Server rack', w: 76, h: 100, blocking: true, opaque: true },
  counter: { name: 'Kitchen counter', w: 160, h: 54, blocking: true, opaque: false },
  sofa: { name: 'Sofa', w: 110, h: 48, blocking: true, opaque: false },
  plant: { name: 'Pot plant', w: 36, h: 36, blocking: false, opaque: false },
  printer: { name: 'Printer', w: 44, h: 40, blocking: false, opaque: false },
  chair: { name: 'Office chair', w: 32, h: 32, blocking: false, opaque: false },
  board: { name: 'Whiteboard', w: 120, h: 32, blocking: false, opaque: false }
} as const;
export type FixtureKind = keyof typeof FIXTURE_TYPES;
export type Fixture = Rect & { id: string; kind: FixtureKind; blocking: boolean; opaque: boolean };
type Placement = { kind: FixtureKind; x: number; y: number };
type Zone = Rect & { label: string };
type Layout = { walls: Rect[]; fixtures: Placement[]; zones: Zone[] };
const fixture = (kind: FixtureKind, x: number, y: number): Placement => ({ kind, x, y });

export const OFFICE_LAYOUTS: Record<'centre' | 'north' | 'east' | 'south' | 'west', Layout> = {
  centre: {
    // Four open corners surround an uninterrupted east/west concourse and central spawn area.
    walls: [
      { x: 315, y: 60, w: 18, h: 125 },
      { x: 667, y: 60, w: 18, h: 125 },
      { x: 315, y: 440, w: 18, h: 120 },
      { x: 667, y: 440, w: 18, h: 120 },
      { x: 80, y: 410, w: 180, h: 18 }
    ],
    zones: [
      { x: 55, y: 65, w: 235, h: 175, label: 'HOT DESKS' },
      { x: 710, y: 65, w: 235, h: 175, label: 'PRINT POINT' },
      { x: 55, y: 450, w: 235, h: 125, label: 'RECEPTION' },
      { x: 710, y: 400, w: 235, h: 175, label: 'BREAKOUT' }
    ],
    fixtures: [
      fixture('desk', 80, 190),
      fixture('chair', 120, 155),
      fixture('plant', 255, 210),
      fixture('printer', 875, 135),
      fixture('bookcase', 850, 80),
      fixture('plant', 920, 205),
      fixture('desk', 90, 480),
      fixture('chair', 125, 540),
      fixture('plant', 240, 530),
      fixture('sofa', 730, 435),
      fixture('plant', 915, 430),
      fixture('board', 730, 540)
    ]
  },
  north: {
    // Two side doors and an open northern edge give the development pod a full loop.
    walls: [
      { x: 220, y: 170, w: 18, h: 240 },
      { x: 220, y: 410, w: 210, h: 18 },
      { x: 560, y: 410, w: 148, h: 18 },
      { x: 690, y: 170, w: 18, h: 100 },
      { x: 690, y: 390, w: 18, h: 38 }
    ],
    zones: [
      { x: 265, y: 175, w: 390, h: 215, label: 'PAIR PROGRAMMING' },
      { x: 745, y: 170, w: 200, h: 310, label: 'QUIET CORNER' }
    ],
    fixtures: [
      fixture('desk', 290, 195),
      fixture('desk', 510, 195),
      fixture('chair', 330, 255),
      fixture('chair', 550, 255),
      fixture('desk', 290, 335),
      fixture('desk', 550, 335),
      fixture('bookcase', 80, 70),
      fixture('printer', 95, 325),
      fixture('plant', 90, 520),
      fixture('board', 500, 65),
      fixture('sofa', 815, 215),
      fixture('plant', 900, 460)
    ]
  },
  east: {
    // Opposing doors replace the old dead-end server bay; outer service aisles connect around it.
    walls: [
      { x: 280, y: 140, w: 440, h: 18 },
      { x: 280, y: 480, w: 440, h: 18 },
      { x: 280, y: 140, w: 18, h: 100 },
      { x: 280, y: 380, w: 18, h: 118 },
      { x: 720, y: 140, w: 18, h: 100 },
      { x: 720, y: 380, w: 18, h: 118 }
    ],
    zones: [
      { x: 320, y: 160, w: 360, h: 285, label: 'SERVER OPERATIONS' },
      { x: 65, y: 390, w: 165, h: 165, label: 'IT SUPPORT' }
    ],
    fixtures: [
      fixture('rack', 360, 180),
      fixture('rack', 585, 180),
      fixture('rack', 360, 355),
      fixture('rack', 585, 355),
      fixture('desk', 90, 410),
      fixture('chair', 130, 475),
      fixture('printer', 90, 530),
      fixture('bookcase', 810, 60),
      fixture('plant', 925, 540),
      fixture('board', 440, 60)
    ]
  },
  south: {
    // The island splits circulation; both ends of the lounge partition stay open.
    walls: [
      { x: 270, y: 160, w: 18, h: 170 },
      { x: 90, y: 420, w: 240, h: 18 },
      { x: 650, y: 420, w: 200, h: 18 }
    ],
    zones: [
      { x: 335, y: 170, w: 275, h: 215, label: 'KITCHEN ISLAND' },
      { x: 670, y: 140, w: 270, h: 250, label: 'COFFEE BAR' },
      { x: 370, y: 460, w: 245, h: 110, label: 'LUNCH CLUB' }
    ],
    fixtures: [
      fixture('counter', 390, 255),
      fixture('counter', 720, 170),
      fixture('table', 70, 235),
      fixture('chair', 120, 195),
      fixture('chair', 120, 330),
      fixture('sofa', 405, 500),
      fixture('plant', 570, 525),
      fixture('plant', 910, 360),
      fixture('board', 290, 65),
      fixture('printer', 110, 505),
      fixture('bookcase', 730, 535)
    ]
  },
  west: {
    // Two entrances into the planning room plus a perimeter route past the archive.
    walls: [
      { x: 280, y: 160, w: 360, h: 18 },
      { x: 280, y: 440, w: 360, h: 18 },
      { x: 280, y: 160, w: 18, h: 80 },
      { x: 280, y: 370, w: 18, h: 70 },
      { x: 640, y: 160, w: 18, h: 80 },
      { x: 640, y: 370, w: 18, h: 88 }
    ],
    zones: [
      { x: 330, y: 180, w: 260, h: 225, label: 'SPRINT PLANNING' },
      { x: 70, y: 90, w: 160, h: 320, label: 'REFERENCE LIBRARY' },
      { x: 720, y: 390, w: 215, h: 160, label: 'DESIGN NOOK' }
    ],
    fixtures: [
      fixture('table', 380, 205),
      fixture('chair', 340, 225),
      fixture('chair', 555, 225),
      fixture('board', 740, 100),
      fixture('bookcase', 85, 110),
      fixture('bookcase', 85, 350),
      fixture('desk', 770, 410),
      fixture('chair', 810, 475),
      fixture('printer', 875, 520),
      fixture('plant', 920, 90),
      fixture('plant', 80, 530),
      fixture('sofa', 435, 520)
    ]
  }
};
