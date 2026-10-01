import { FACEBOOK_PRESETS } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';

// Facebook does not expose the real preset assets, so we approximate each
// background's color from its descriptive name (e.g. "Solid purple",
// "Gradient, dark orange-red", "Light blue illustration"). Solids/gradients end
// up close; illustrations collapse to a representative flat tint.

const PALETTE: Record<string, string> = {
  purple: '#8a3ffc',
  magenta: '#d6249f',
  pink: '#ec4899',
  red: '#e0294b',
  orange: '#f97316',
  yellow: '#f4c430',
  green: '#2fbf71',
  teal: '#17a2a2',
  blue: '#2d88ff',
  grey: '#65676b',
  brown: '#8b5e34',
  beige: '#d9c7a7',
  black: '#18191a',
};

// Order colors are searched/emitted in (name order isn't reliable).
const ORDER = Object.keys(PALETTE);

// For names without an explicit color word, key off the subject.
const SUBJECTS: Record<string, string> = {
  heart: 'red',
  flame: 'orange',
  rose: 'pink',
  'heart-eyes': 'yellow',
  laughter: 'yellow',
  smiling: 'yellow',
  emoji: 'yellow',
  rocket: 'blue',
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(hex: string, target: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = hexToRgb(target);
  return rgbToHex(
    r + (tr - r) * amount,
    g + (tg - g) * amount,
    b + (tb - b) * amount
  );
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface PresetBackground {
  background: string;
  text: string;
}

export function getPresetBackground(
  id: string | undefined
): PresetBackground | undefined {
  if (!id) return undefined;
  const preset = FACEBOOK_PRESETS.find((p) => p.id === id);
  if (!preset) return undefined;

  const name = preset.name.toLowerCase();
  const isLight = /light/.test(name);
  const isDark = /\bdark\b|dark-/.test(name);

  let colors = ORDER.filter((c) => name.includes(c)).map((c) => PALETTE[c]);
  if (!colors.length) {
    const subject = Object.keys(SUBJECTS).find((k) => name.includes(k));
    colors = [PALETTE[subject ? SUBJECTS[subject] : 'grey']];
  }

  colors = colors.map((c) =>
    isLight ? mix(c, '#ffffff', 0.5) : isDark ? mix(c, '#000000', 0.32) : c
  );

  const background =
    name.includes('gradient') && colors.length >= 2
      ? `linear-gradient(135deg, ${colors.join(', ')})`
      : colors[0];

  const text = luminance(colors[0]) > 0.5 ? '#1c1e21' : '#ffffff';
  return { background, text };
}

// Chinese names for the preset list (the DTO keeps Facebook's English names).
const PRESET_NAMES_ZH: Record<string, string> = {
  '3D crying-laughter emoji': '3D 笑哭表情',
  '3D flame emojis': '3D 火焰表情',
  '3D heart-eyes emojis': '3D 花痴表情',
  '3D hearts': '3D 爱心',
  '3D rose emojis': '3D 玫瑰表情',
  '3D smiling emoji': '3D 微笑表情',
  'Apple red illustration': '红色苹果插画',
  'Ball green illustration': '绿色球体插画',
  'Balloon light-grey illustration': '浅灰色气球插画',
  'Blue clouds on dark blue': '深蓝底蓝色云朵',
  'Blue illustration': '蓝色插画',
  'Brown illustration': '棕色插画',
  'Cat dark-orange illustration': '深橙色猫咪插画',
  'Cat light-blue illustration': '浅蓝色猫咪插画',
  'Cube beige illustration': '米色立方体插画',
  'Dark blue illustration': '深蓝色插画',
  'Deep sea blue illustration': '深海蓝插画',
  'Donut light-purple illustration': '浅紫色甜甜圈插画',
  'Egg light-yellow illustration': '浅黄色鸡蛋插画',
  'Eye pink illustration': '粉色眼睛插画',
  'Flower teal illustration': '青色花朵插画',
  'Glasses light-grey illustration': '浅灰色眼镜插画',
  'Gradient, dark orange-red': '深橙红渐变',
  'Gradient, dark-grey-black': '深灰黑渐变',
  'Gradient, grey dark-grey': '灰色到深灰渐变',
  'Gradient, purple-magenta': '紫色到洋红渐变',
  'Gradient, red-blue': '红蓝渐变',
  'Gradient, red': '红色渐变',
  'Gradient, teal light-green': '青色到浅绿渐变',
  'Grey heart pattern on black': '黑底灰色爱心图案',
  Illustration: '插画',
  'Lemon yellow illustration': '柠檬黄插画',
  'Light blue illustration': '浅蓝色插画',
  'Light grey illustration': '浅灰色插画',
  'Light purple 3D cube pattern': '浅紫色 3D 立方体图案',
  'Orange with pink illustration': '橙粉插画',
  'Pink and purple hearts on pink': '粉底粉紫爱心',
  'Pink and purple hearts on purple': '紫底粉紫爱心',
  'Pink and yellow gradient': '粉黄渐变',
  'Pink heart pattern on pink': '粉底粉色爱心图案',
  'Pink illustration': '粉色插画',
  'Pink tropical plants': '粉色热带植物',
  'Rain black illustration': '黑色雨天插画',
  'Red illustration': '红色插画',
  'Rocket ship makes heart in sky': '火箭在天空划出爱心',
  'Solid black': '纯黑',
  'Solid blue': '纯蓝',
  'Solid dark purple': '纯深紫',
  'Solid dark red': '纯深红',
  'Solid magenta': '纯洋红',
  'Solid purple': '纯紫',
  'Solid red': '纯红',
  'Solid teal': '纯青',
  'Spiral beige illustration': '米色螺旋插画',
  'Spiral purple illustration': '紫色螺旋插画',
  'Stairs beige illustration': '米色楼梯插画',
  'Sunset red illustration': '红色日落插画',
  'Tree red illustration': '红色树木插画',
  'Tulip light-orange illustration': '浅橙色郁金香插画',
  'Unicorn red illustration': '红色独角兽插画',
  'Walking yellow illustration': '黄色行走插画',
  'Watermelon light-purple illustration': '浅紫色西瓜插画',
  'Wave blue illustration': '蓝色海浪插画',
  'Yellow/orange/pink gradient': '黄橙粉渐变',
};

export const presetNameZh = (name: string) => PRESET_NAMES_ZH[name] || name;
