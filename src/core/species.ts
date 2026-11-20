import type { SpeciesId, SpeciesInfo, WireGauge, WireMaterial } from './types';

export const SPECIES: Record<SpeciesId, SpeciesInfo> = {
  goyomatsu: {
    id: 'goyomatsu',
    name: '五针松',
    latin: 'Pinus parviflora',
    flexibility: 8,
    foliage: 'pine',
    growthRate: 0.045,
    maxWireYearsAl: 1.5,
    maxWireYearsCu: 2.5,
    repotYears: 4,
    wireSeason: [10, 11],
    pruneSeason: [4, 9],
    barkColor: 0x6b5a48,
    deadwoodCapable: false,
  },
  shimpaku: {
    id: 'shimpaku',
    name: '真柏',
    latin: 'Juniperus chinensis',
    flexibility: 6,
    foliage: 'juniper',
    growthRate: 0.05,
    maxWireYearsAl: 2,
    maxWireYearsCu: 3,
    repotYears: 3,
    wireSeason: [3, 10],
    pruneSeason: [5, 6],
    barkColor: 0x7a5c43,
    deadwoodCapable: true,
  },
  elm: {
    id: 'elm',
    name: '榆树',
    latin: 'Ulmus parvifolia',
    flexibility: 10,
    foliage: 'elm',
    growthRate: 0.08,
    maxWireYearsAl: 1,
    maxWireYearsCu: 1.5,
    repotYears: 2,
    wireSeason: [3, 4],
    pruneSeason: [6, 9],
    barkColor: 0x8a7a68,
    deadwoodCapable: false,
  },
  bougainvillea: {
    id: 'bougainvillea',
    name: '三角梅',
    latin: 'Bougainvillea spectabilis',
    flexibility: 7,
    foliage: 'bougainvillea',
    growthRate: 0.09,
    maxWireYearsAl: 1,
    maxWireYearsCu: 1.5,
    repotYears: 2,
    wireSeason: [4, 5],
    pruneSeason: [3, 10],
    barkColor: 0x74594a,
    deadwoodCapable: false,
  },
};

export const SPECIES_LIST = Object.values(SPECIES);

/** 日式番线常用号数表（毫米） */
export const WIRE_GAUGES: WireGauge[] = [
  { gauge: 1, mm: 6.0 },
  { gauge: 2, mm: 5.0 },
  { gauge: 3, mm: 4.0 },
  { gauge: 4, mm: 3.2 },
  { gauge: 5, mm: 2.6 },
  { gauge: 6, mm: 2.0 },
  { gauge: 7, mm: 1.6 },
  { gauge: 8, mm: 1.2 },
  { gauge: 9, mm: 1.0 },
  { gauge: 10, mm: 0.8 },
  { gauge: 12, mm: 0.6 },
  { gauge: 14, mm: 0.45 },
];

export function gaugeMm(gauge: number): number {
  return WIRE_GAUGES.find((g) => g.gauge === gauge)?.mm ?? 2.0;
}

/** 经验法则：丝径 ≈ 枝基部直径的 1/3（枝径以直径计） */
export function recommendGauge(radiusCm: number, material: WireMaterial): number {
  const diameterMm = radiusCm * 20; // cm -> mm 直径
  const targetMm = diameterMm / 3;
  const copperFactor = material === 'copper' ? 0.85 : 1; // 铜丝强度高可细一档
  const want = targetMm * copperFactor;
  let best = WIRE_GAUGES[0];
  for (const g of WIRE_GAUGES) {
    if (g.mm <= want) {
      best = g;
      break;
    }
    best = g;
  }
  return best.gauge;
}
