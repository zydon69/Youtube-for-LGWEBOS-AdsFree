export const SPONSORBLOCK_CATEGORY_OPTIONS = Object.freeze([
  {
    category: 'sponsor',
    configKey: 'enableSponsorBlockSponsor',
    default: true,
    description: 'Skip sponsor segments',
    color: '#00d400',
    name: 'sponsored segment'
  },
  {
    category: 'intro',
    configKey: 'enableSponsorBlockIntro',
    default: true,
    description: 'Skip intro segments',
    color: '#00ffff',
    name: 'intro'
  },
  {
    category: 'outro',
    configKey: 'enableSponsorBlockOutro',
    default: true,
    description: 'Skip outro segments',
    color: '#0202ed',
    name: 'outro'
  },
  {
    category: 'interaction',
    configKey: 'enableSponsorBlockInteraction',
    default: true,
    description: 'Skip interaction reminder segments',
    color: '#cc00ff',
    name: 'interaction reminder'
  },
  {
    category: 'selfpromo',
    configKey: 'enableSponsorBlockSelfPromo',
    default: true,
    description: 'Skip self promotion segments',
    color: '#ffff00',
    name: 'self-promotion'
  },
  {
    category: 'music_offtopic',
    configKey: 'enableSponsorBlockMusicOfftopic',
    default: true,
    description: 'Skip non-music segments in music videos',
    color: '#ff9900',
    name: 'non-music part'
  },
  {
    category: 'preview',
    configKey: 'enableSponsorBlockPreview',
    default: false,
    description: 'Skip recaps and previews',
    color: '#008fd6',
    name: 'recap or preview'
  }
]);

export const SPONSORBLOCK_CATEGORIES = Object.freeze(
  SPONSORBLOCK_CATEGORY_OPTIONS.map(({ category }) => category)
);

export const SPONSORBLOCK_CATEGORY_BY_NAME = Object.freeze(
  Object.fromEntries(
    SPONSORBLOCK_CATEGORY_OPTIONS.map((option) => [option.category, option])
  )
);
