import { ArenaTheme } from '@aerial-arena/shared';

/**
 * Visual-only theme palettes. Every theme uses the exact same arena geometry,
 * collision, pads and spawns; only colors, lights and backdrop change.
 */
export interface ThemePalette {
  displayName: string;
  // Turf
  grassA: string; // stripe color 1
  grassB: string; // stripe color 2
  grassNoise: number; // 0..1 speckle strength
  lineColor: string;
  lineAlpha: number;
  gridLines: boolean; // neon-style glowing grid instead of mown stripes
  blueTint: string; // overlay on the blue half
  orangeTint: string;
  tintAlpha: number;
  // Walls
  wallTint: number;
  wallAlpha: number;
  hexAlpha: number;
  rampColor: number;
  // Team colors
  blue: number;
  orange: number;
  // Sky + lighting
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  stars: boolean;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  exposure: number;
  // Stadium
  standColor: number;
  roofColor: number;
  floodlightIntensity: number; // emissive strength of the light panels
  crowdBrightness: number;
}

export const THEMES: Record<ArenaTheme, ThemePalette> = {
  coastal_dome: {
    displayName: 'Champions Field',
    grassA: '#3f8f2f',
    grassB: '#357d27',
    grassNoise: 0.5,
    lineColor: '#ffffff',
    lineAlpha: 0.85,
    gridLines: false,
    blueTint: '#2f6bff',
    orangeTint: '#ff8a1f',
    tintAlpha: 0.1,
    wallTint: 0xdbeafe,
    wallAlpha: 0.08,
    hexAlpha: 0.22,
    rampColor: 0x2d4a2a,
    blue: 0x1f6bff,
    orange: 0xff7a14,
    skyTop: 0x2f7fe0,
    skyHorizon: 0xbfe0ff,
    skyBottom: 0x6a8aa8,
    stars: false,
    fog: 0xb9d6f2,
    hemiSky: 0xdff0ff,
    hemiGround: 0x4a6b3a,
    hemiIntensity: 1.1,
    sunColor: 0xfff4e0,
    sunIntensity: 2.4,
    exposure: 1.0,
    standColor: 0xc9d1dc,
    roofColor: 0x9aa6b5,
    floodlightIntensity: 0.6,
    crowdBrightness: 0.9,
  },
  foundry: {
    displayName: 'Foundry Night',
    grassA: '#2f6e2a',
    grassB: '#285f24',
    grassNoise: 0.55,
    lineColor: '#fff6e6',
    lineAlpha: 0.85,
    gridLines: false,
    blueTint: '#2a5cff',
    orangeTint: '#ff7a1a',
    tintAlpha: 0.14,
    wallTint: 0xffe4c4,
    wallAlpha: 0.07,
    hexAlpha: 0.28,
    rampColor: 0x1f2a22,
    blue: 0x2a6bff,
    orange: 0xff7a1a,
    skyTop: 0x05070f,
    skyHorizon: 0x2b1d1a,
    skyBottom: 0x0a0a0c,
    stars: true,
    fog: 0x120e10,
    hemiSky: 0xffe2c0,
    hemiGround: 0x1d2a1b,
    hemiIntensity: 0.8,
    sunColor: 0xfff0dd,
    sunIntensity: 2.2,
    exposure: 1.05,
    standColor: 0x3b3f47,
    roofColor: 0x23262c,
    floodlightIntensity: 3.0,
    crowdBrightness: 0.55,
  },
  neon_grid: {
    displayName: 'Neon Grid',
    grassA: '#14102a',
    grassB: '#181433',
    grassNoise: 0.15,
    lineColor: '#7df9ff',
    lineAlpha: 0.95,
    gridLines: true,
    blueTint: '#1f6bff',
    orangeTint: '#ff3d8b',
    tintAlpha: 0.16,
    wallTint: 0xd8b4fe,
    wallAlpha: 0.06,
    hexAlpha: 0.4,
    rampColor: 0x1a1236,
    blue: 0x29a3ff,
    orange: 0xff5a2a,
    skyTop: 0x04020c,
    skyHorizon: 0x2a0d45,
    skyBottom: 0x05030a,
    stars: true,
    fog: 0x0d0618,
    hemiSky: 0xb48cff,
    hemiGround: 0x150b2a,
    hemiIntensity: 0.9,
    sunColor: 0xc7b8ff,
    sunIntensity: 1.6,
    exposure: 1.1,
    standColor: 0x1b1530,
    roofColor: 0x120d22,
    floodlightIntensity: 2.2,
    crowdBrightness: 0.45,
  },
};
