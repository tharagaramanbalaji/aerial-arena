/** Player car customization (visual only; the hitbox and physics never change). */
export type PaintFinish = 'gloss' | 'matte' | 'metallic' | 'pearl';
export type RimStyle = 'sport' | 'mesh' | 'turbine' | 'dish';
export type TireStyle = 'street' | 'offroad' | 'slick';
export type DecalStyle = 'stripe' | 'racing' | 'none';
export type BoostStyle = 'team' | 'inferno' | 'neon' | 'synthwave' | 'toxic' | 'ice';

export interface CarLook {
  accent: string; // hex, trim / hub / caliper / decal color
  finish: PaintFinish;
  rimStyle: RimStyle;
  rimColor: string; // hex
  tire: TireStyle;
  decal: DecalStyle;
  boost: BoostStyle;
}

export const DEFAULT_LOOK: CarLook = {
  accent: '#7fd3ff',
  finish: 'gloss',
  rimStyle: 'sport',
  rimColor: '#c9ced6',
  tire: 'street',
  decal: 'stripe',
  boost: 'team',
};

export const LOOK_OPTIONS = {
  accent: ['#7fd3ff', '#ffd166', '#ffffff', '#ff4d6d', '#3ddc84', '#b388ff', '#ff9a3c', '#1b1d24'],
  rimColor: ['#c9ced6', '#1b1d24', '#ffd166', '#ff4d6d', '#7fd3ff', '#ffffff'],
  finish: ['gloss', 'matte', 'metallic', 'pearl'] as PaintFinish[],
  rimStyle: ['sport', 'mesh', 'turbine', 'dish'] as RimStyle[],
  tire: ['street', 'offroad', 'slick'] as TireStyle[],
  decal: ['stripe', 'racing', 'none'] as DecalStyle[],
  boost: ['team', 'inferno', 'neon', 'synthwave', 'toxic', 'ice'] as BoostStyle[],
};

/** Neon boost gradients: [white-hot core, mid, outer]. 'team' is filled from team colors. */
export const BOOST_GRADIENTS: Record<Exclude<BoostStyle, 'team'>, [string, string, string]> = {
  inferno: ['#fff6c8', '#ffb020', '#ff2a00'],
  neon: ['#ffffff', '#36f9ff', '#2a4bff'],
  synthwave: ['#ffe6ff', '#ff3df2', '#6a2bff'],
  toxic: ['#f4ffd0', '#7dff3a', '#00b35f'],
  ice: ['#ffffff', '#b6f0ff', '#4aa0ff'],
};

export const TEAM_BOOST: Record<'blue' | 'orange', [string, string, string]> = {
  blue: ['#ffffff', '#59b8ff', '#1d4dff'],
  orange: ['#fff3d6', '#ffb040', '#ff5a0f'],
};
